import { formatEstimate } from "../BookingFooterBar";

jest.mock("../../icons/AppIcon", () => ({ AppIcon: () => null }));

describe("formatEstimate", () => {
  it("shows a range with thousands separators", () => {
    expect(formatEstimate({ mode: "range", range: { min: 350, max: 6000 } })).toEqual({
      amount: "₱350 – ₱6,000",
      label: "Estimated price",
    });
  });

  it("shows a single figure when the range is one price", () => {
    expect(formatEstimate({ mode: "range", range: { min: 800, max: 800 } })?.amount).toBe("~₱800");
  });

  it("labels per-unit rates", () => {
    expect(formatEstimate({ mode: "range", range: { min: 50, max: 80 }, unitLabel: "sqm" })).toEqual({
      amount: "₱50 – ₱80/sqm",
      label: "Estimated rate",
    });
  });

  it("returns nothing before a service is chosen", () => {
    expect(formatEstimate({ mode: "range", range: { min: 0, max: 0 } })).toBeNull();
  });

  it("shows a picked worker's exact total", () => {
    const point = { total: 1240.4, laborCost: 1000, addOnsTotal: 0, tip: 0 } as any;
    expect(formatEstimate({ mode: "point", point })).toEqual({ amount: "₱1,240", label: "Estimated total" });
  });
});
