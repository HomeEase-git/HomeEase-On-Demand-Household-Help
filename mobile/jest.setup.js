// Jest setup file
// Configure testing environment

// Suppress console errors/warnings in tests (optional)
global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn(),
  log: jest.fn(),
  // Keep these methods for debugging
  info: console.info,
  debug: console.debug,
};

// Mock AsyncStorage
jest.mock("@react-native-async-storage/async-storage", () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve()),
  getAllKeys: jest.fn(() => Promise.resolve([])),
  multiRemove: jest.fn(() => Promise.resolve()),
}));

// Mock NetInfo
jest.mock("@react-native-community/netinfo", () => ({
  fetch: jest.fn(() =>
    Promise.resolve({
      isConnected: true,
      type: "wifi",
    }),
  ),
  addEventListener: jest.fn(() => jest.fn()),
}));

// Mock Expo modules with error handling for optional modules
try {
  jest.mock("expo-font", () => ({
    loadAsync: jest.fn(() => Promise.resolve()),
  }));
} catch (e) {
  // Module not required for tests
}

try {
  jest.mock("expo-image-picker", () => ({
    requestCameraPermissionsAsync: jest.fn(() =>
      Promise.resolve({ granted: true }),
    ),
    launchCameraAsync: jest.fn(() =>
      Promise.resolve({ cancelled: false, assets: [{ uri: "mock-uri" }] }),
    ),
    launchImageLibraryAsync: jest.fn(() =>
      Promise.resolve({ cancelled: false, assets: [{ uri: "mock-uri" }] }),
    ),
    MediaTypeOptions: { Images: "Images" },
  }));
} catch (e) {
  // Module not required for tests
}

try {
  jest.mock("expo-image-manipulator", () => ({
    manipulateAsync: jest.fn(() =>
      Promise.resolve({ uri: "mocked-uri", width: 1200, height: 800 }),
    ),
    SaveFormat: { JPEG: "jpeg", PNG: "png" },
  }));
} catch (e) {
  // Module not required for tests
}

try {
  jest.mock("expo-notifications", () => ({
    getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
    requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
    getExpoPushTokenAsync: jest.fn(() =>
      Promise.resolve({ data: "mock-token" }),
    ),
    setNotificationHandler: jest.fn(),
    addNotificationReceivedListener: jest.fn(() => jest.fn()),
    addNotificationResponseReceivedListener: jest.fn(() => jest.fn()),
    scheduleNotificationAsync: jest.fn(() =>
      Promise.resolve("mock-notification-id"),
    ),
    dismissAllNotificationsAsync: jest.fn(() => Promise.resolve()),
    getBadgeCountAsync: jest.fn(() => Promise.resolve(0)),
    setBadgeCountAsync: jest.fn(() => Promise.resolve()),
  }));
} catch (e) {
  // Module not required for tests
}

try {
  jest.mock("expo-router", () => ({
    useRouter: () => ({
      push: jest.fn(),
      back: jest.fn(),
      replace: jest.fn(),
    }),
    useNavigationContainerRef: () => jest.fn(),
    useLocalSearchParams: () => ({}),
    Stack: { Screen: () => null },
    Link: () => null,
  }));
} catch (e) {
  // Module not required for tests
}

try {
  jest.mock("expo-haptics", () => ({
    notificationAsync: jest.fn(() => Promise.resolve()),
    selectionAsync: jest.fn(() => Promise.resolve()),
    impactAsync: jest.fn(() => Promise.resolve()),
  }));
} catch (e) {
  // Module not required for tests
}

// Add TextEncoder if not available
if (typeof global.TextEncoder === "undefined") {
  const { TextEncoder } = require("util");
  global.TextEncoder = TextEncoder;
}

// Suppress React Native warnings
if (__DEV__) {
  jest.spyOn(console, "error").mockImplementation(() => null);
  jest.spyOn(console, "warn").mockImplementation(() => null);
}
