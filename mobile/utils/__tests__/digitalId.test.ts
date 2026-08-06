import { buildDigitalIdCard } from "../digitalId";

describe("buildDigitalIdCard", () => {
  it("builds a verified worker card from real KYC-backed profile data", () => {
    const card = buildDigitalIdCard({
      name: "Maria Santos",
      avatar: "https://example.com/avatar.jpg",
      badgeId: "HE-ABCD1234",
      verified: true,
      rating: 4.8,
      totalReviews: 12,
      trade: "Plumbing",
      serviceArea: "Quezon City",
      licenseNumber: "ABC-2024-001",
    });

    expect(card.fullName).toBe("Maria Santos");
    expect(card.badgeId).toBe("HE-ABCD1234");
    expect(card.trade).toBe("Plumbing");
    expect(card.serviceArea).toBe("Quezon City");
    expect(card.licenseNumber).toBe("ABC-2024-001");
    expect(card.verificationLabel).toBe("HomeEase Verified Worker");
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
    expect(card.verificationLabel).toBe("Verification Pending");
  });
});
