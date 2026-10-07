import { renderHook, act } from "@testing-library/react-native";
import { InteractionManager } from "react-native";

const mockRequestPermissions = jest.fn(async () => {});
jest.mock("../../services/notificationService", () => ({
  notificationService: { requestPermissions: () => mockRequestPermissions(), clearTokenFromBackend: jest.fn() },
}));
jest.mock("../../services/api", () => ({ postLogout: jest.fn() }));

import { useAuthStore } from "../../store/authStore";
import { usePushNotificationPrompt } from "../usePushNotificationPrompt";

jest.useFakeTimers();
jest.spyOn(InteractionManager, "runAfterInteractions").mockImplementation((cb: any) => {
  cb();
  return { then: jest.fn(), done: jest.fn(), cancel: jest.fn() } as any;
});

async function signInAndMount(id: string) {
  await act(async () => useAuthStore.setState({ user: { id } as any, isAuthenticated: true }));
  const hook = await renderHook(() => usePushNotificationPrompt());
  await act(async () => jest.runAllTimers());
  await hook.unmount();
}

it("registers push once per account, again after switching accounts", async () => {
  await signInAndMount("u1");
  await signInAndMount("u1"); // same account, home screen mounted again
  expect(mockRequestPermissions).toHaveBeenCalledTimes(1);

  await signInAndMount("u2");
  expect(mockRequestPermissions).toHaveBeenCalledTimes(2);
});
