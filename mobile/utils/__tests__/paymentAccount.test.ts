import { isPhMobileNumber } from "../paymentAccount";

describe("isPhMobileNumber", () => {
  it.each(["09171234567", "+639171234567"])("accepts %s", (v) => expect(isPhMobileNumber(v)).toBe(true));
  it.each(["", "9171234567", "0917123456", "+63 917 123 4567", "abc"])("rejects %j", (v) =>
    expect(isPhMobileNumber(v)).toBe(false),
  );
  it("ignores surrounding spaces", () => expect(isPhMobileNumber(" 09171234567 ")).toBe(true));
});
