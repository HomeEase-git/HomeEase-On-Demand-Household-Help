import AsyncStorage from "@react-native-async-storage/async-storage";
import { addressStorage, certificationStorage } from "../storage";

jest.mock("@react-native-async-storage/async-storage", () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
  multiRemove: jest.fn(),
  getAllKeys: jest.fn(),
  clear: jest.fn(),
}));

const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

describe("CRUD storage helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAsyncStorage.getItem.mockResolvedValue(null);
    mockedAsyncStorage.setItem.mockResolvedValue();
    mockedAsyncStorage.removeItem.mockResolvedValue();
  });

  it("creates, updates, and deletes addresses", async () => {
    const created = await addressStorage.create({
      label: "Home",
      address: "123 Main Street",
    });
    if (!created) throw new Error("expected address to be created");

    expect(created.id).toBeDefined();
    expect(created.label).toBe("Home");

    const listAfterCreate = await addressStorage.list();
    expect(listAfterCreate).toHaveLength(1);

    await addressStorage.update(created.id, { label: "Work" });
    const updated = await addressStorage.get(created.id);
    expect(updated?.label).toBe("Work");

    await addressStorage.remove(created.id);
    const listAfterDelete = await addressStorage.list();
    expect(listAfterDelete).toHaveLength(0);
  });

  it("creates, updates, and deletes certifications", async () => {
    const created = await certificationStorage.create({
      name: "Plumbing License",
      issuer: "PRC",
      issueDate: "2024-01-01",
      expiryDate: "2026-01-01",
      status: "Pending",
    });
    if (!created) throw new Error("expected certification to be created");

    expect(created.id).toBeDefined();

    await certificationStorage.update(created.id, { status: "Verified" });
    const updated = await certificationStorage.get(created.id);
    expect(updated?.status).toBe("Verified");

    await certificationStorage.remove(created.id);
    const listAfterDelete = await certificationStorage.list();
    expect(listAfterDelete).toHaveLength(0);
  });
});
