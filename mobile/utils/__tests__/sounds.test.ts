import AsyncStorage from "@react-native-async-storage/async-storage";

const mockPlay = jest.fn();
const mockRemove = jest.fn();
const mockCreateAudioPlayer = jest.fn(() => ({ play: mockPlay, remove: mockRemove }));

jest.mock("expo-audio", () => ({
  createAudioPlayer: mockCreateAudioPlayer,
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
}));

// sounds.ts keeps its setting and last-played times in module
// state, so each test gets a fresh copy.
function loadSounds(): typeof import("../sounds") {
  let mod!: typeof import("../sounds");
  jest.isolateModules(() => {
    mod = require("../sounds");
  });
  return mod;
}

describe("sounds", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, "now").mockReturnValue(10_000);
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  afterEach(() => jest.restoreAllMocks());

  it("plays a sound and releases its player afterwards", () => {
    jest.useFakeTimers();
    const { playSound } = loadSounds();
    playSound("message");
    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(mockRemove).not.toHaveBeenCalled();
    jest.advanceTimersByTime(3000);
    expect(mockRemove).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it("plays a burst of the same sound only once", () => {
    const { playSound } = loadSounds();
    playSound("message");
    playSound("message");
    (Date.now as jest.Mock).mockReturnValue(11_000);
    playSound("message");
    expect(mockPlay).toHaveBeenCalledTimes(1);

    (Date.now as jest.Mock).mockReturnValue(11_600);
    playSound("message");
    expect(mockPlay).toHaveBeenCalledTimes(2);
  });

  it("limits each sound separately", () => {
    const { playSound } = loadSounds();
    playSound("message");
    playSound("newJob");
    playSound("newJob");
    expect(mockPlay).toHaveBeenCalledTimes(2);
  });

  it("stays silent when turned off, and saves the setting", async () => {
    const { playSound, setSoundsEnabled, areSoundsEnabled } = loadSounds();
    await setSoundsEnabled(false);
    expect(areSoundsEnabled()).toBe(false);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith("settings.inAppSounds", "false");
    playSound("newJob");
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it("restores a saved 'off' setting on startup", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("false");
    const { initSounds, areSoundsEnabled } = loadSounds();
    await initSounds();
    expect(areSoundsEnabled()).toBe(false);
  });
});
