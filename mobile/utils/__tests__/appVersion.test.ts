import { compareVersions, storeUpdateNeed } from "../appVersion";

describe("appVersion", () => {
  it("compares numerically, not as text", () => {
    expect(compareVersions("1.0.10", "1.0.9")).toBe(1);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.1", "1.1.0")).toBe(-1);
  });

  it("blocks below minimum, prompts below latest", () => {
    expect(storeUpdateNeed("1.0.1", { latest: "1.0.3", minimum: "1.0.2" })).toBe("required");
    expect(storeUpdateNeed("1.0.2", { latest: "1.0.3", minimum: "1.0.2" })).toBe("optional");
    expect(storeUpdateNeed("1.0.3", { latest: "1.0.3", minimum: "1.0.2" })).toBeNull();
    expect(storeUpdateNeed("1.0.1", { latest: null, minimum: null })).toBeNull();
  });
});
