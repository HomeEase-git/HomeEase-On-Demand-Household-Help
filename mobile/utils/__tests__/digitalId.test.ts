import {
  buildDigitalIdCard,
  formatMonthYear,
  formatFullDate,
} from "../digitalId";

describe("buildDigitalIdCard", () => {
  it("builds a verified worker card from real KYC-backed profile data", () => {
    const card = buildDigitalIdCard({
      id: "user-abc123",
      name: "Maria Santos",
      avatar: "https://example.com/avatar.jpg",
      badgeId: "HE-ABCD1234",
      verified: true,
      rating: 4.8,
      totalReviews: 12,
      trade: "Plumbing",
      serviceArea: "Quezon City",
      licenseNumber: "ABC-2024-001",
      memberSince: "2026-01-15T12:00:00.000Z",
      kycApprovedAt: "2026-02-03T12:00:00.000Z",
      verificationBaseUrl: "https://homeease.app/",
    });

    expect(card.fullName).toBe("Maria Santos");
    expect(card.badgeId).toBe("HE-ABCD1234");
    expect(card.trade).toBe("Plumbing");
    expect(card.serviceArea).toBe("Quezon City");
    expect(card.licenseNumber).toBe("ABC-2024-001");
    expect(card.verificationLabel).toBe("Verified worker");
    expect(card.statusLabel).toBe("Live — checked on scan");
    expect(card.memberSinceLabel).toBe("Jan 2026");
    expect(card.kycApprovedLabel).toBe("03 Feb 2026");
    expect(card.verificationUrl).toBe(
      "https://homeease.app/verify/worker/user-abc123",
    );
  });

  it("labels an unapproved worker as pending instead of verified", () => {
    const card = buildDigitalIdCard({
      name: "New Worker",
      badgeId: "HE-EFGH5678",
      verified: false,
      rating: 0,
      totalReviews: 0,
    });

    expect(card.verified).toBe(false);
    expect(card.verificationLabel).toBe("Verification pending");
    expect(card.statusLabel).toBe("Pending review");
    expect(card.kycApprovedLabel).toBe("Pending review");
    expect(card.memberSinceLabel).toBe("—");
    // Falls back to the badge id when the user id is unavailable.
    expect(card.verificationUrl).toBe(
      "https://homeease.app/verify/worker/HE-EFGH5678",
    );
  });
});

describe("date formatting", () => {
  it("formatMonthYear returns month + year, or an em dash when missing/invalid", () => {
    expect(formatMonthYear("2026-09-20T12:00:00.000Z")).toBe("Sep 2026");
    expect(formatMonthYear(null)).toBe("—");
    expect(formatMonthYear("not-a-date")).toBe("—");
  });

  it("formatFullDate zero-pads the day", () => {
    expect(formatFullDate("2026-09-02T12:00:00.000Z")).toBe("02 Sep 2026");
    expect(formatFullDate(undefined)).toBe("—");
  });
});
