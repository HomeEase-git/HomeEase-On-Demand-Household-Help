import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

jest.mock("react-native", () => ({ Platform: { OS: "android" } }));

jest.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItem: jest.fn(async (k: string) => store.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    removeItem: jest.fn(async (k: string) => void store.delete(k)),
    multiRemove: jest.fn(async (ks: string[]) => ks.forEach((k) => store.delete(k))),
  };
});

jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
  };
});

const asyncStore = (AsyncStorage as unknown as { __store: Map<string, string> }).__store;
const secureStore = (SecureStore as unknown as { __store: Map<string, string> }).__store;

// storage.ts caches the access token per app session, so each test loads a
// fresh copy of the module, like a fresh app launch.
const freshAuthStorage = () => {
  let mod: typeof import("../storage") | undefined;
  jest.isolateModules(() => {
    mod = require("../storage");
  });
  return mod!.authStorage;
};

describe("authStorage (Android Keystore)", () => {
  beforeEach(() => {
    asyncStore.clear();
    secureStore.clear();
  });

  it("keeps the access token, refresh token and user in SecureStore, not AsyncStorage", async () => {
    const auth = freshAuthStorage();
    await auth.saveToken("access-1");
    await auth.saveRefreshToken("refresh-1");
    await auth.saveUser({ id: "u1", email: "a@b.c" });

    expect([...secureStore.keys()].sort()).toEqual(
      ["homeease_access_token", "homeease_auth_user", "homeease_refresh_token"].sort(),
    );
    expect(asyncStore.size).toBe(0);

    const relaunched = freshAuthStorage();
    expect(await relaunched.getToken()).toBe("access-1");
    expect(await relaunched.getUser()).toEqual({ id: "u1", email: "a@b.c" });
  });

  it("carries a sign-in from the old AsyncStorage keys over, then deletes them", async () => {
    asyncStore.set("@homeease_auth_token", "old-access");
    asyncStore.set("@homeease_auth_user", JSON.stringify({ id: "u2" }));

    const auth = freshAuthStorage();
    expect(await auth.getToken()).toBe("old-access");
    expect(await auth.getUser()).toEqual({ id: "u2" });

    expect(secureStore.get("homeease_access_token")).toBe("old-access");
    expect(secureStore.get("homeease_auth_user")).toBe(JSON.stringify({ id: "u2" }));
    expect(asyncStore.has("@homeease_auth_token")).toBe(false);
    expect(asyncStore.has("@homeease_auth_user")).toBe(false);
  });

  it("clears every copy on sign-out, old keys included", async () => {
    asyncStore.set("@homeease_auth_token", "stale");
    const auth = freshAuthStorage();
    await auth.saveToken("access-3");
    await auth.saveRefreshToken("refresh-3");
    await auth.saveUser({ id: "u3" });

    await auth.clearAuth();

    expect(secureStore.size).toBe(0);
    expect(asyncStore.size).toBe(0);
    expect(await auth.getToken()).toBeNull();
  });
});
