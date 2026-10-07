import { hasMorePages, uniqueNew } from "../pagination";

describe("hasMorePages", () => {
  it("is true only while page < pages", () => {
    expect(hasMorePages({ page: 1, limit: 20, total: 41, pages: 3 })).toBe(true);
    expect(hasMorePages({ page: 3, limit: 20, total: 41, pages: 3 })).toBe(false);
    expect(hasMorePages({ page: 1, limit: 20, total: 0, pages: 0 })).toBe(false);
    expect(hasMorePages(undefined)).toBe(false);
  });
});

describe("uniqueNew", () => {
  it("drops items already loaded (offset pages shift when new rows arrive)", () => {
    expect(uniqueNew([{ id: "b" }, { id: "c" }], [{ id: "a" }, { id: "b" }])).toEqual([{ id: "c" }]);
  });
});
