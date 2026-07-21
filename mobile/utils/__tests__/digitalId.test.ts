import { buildDigitalIdCard } from "../digitalId";

describe("buildDigitalIdCard", () => {
  it("builds a worker verification card from profile data", () => {
    const card = buildDigitalIdCard({
      name: "Maria Santos",
      email: "maria@example.com",
      phone: "+639171234567",
      role: "worker",
      trade: "Plumbing",
      serviceArea: "Quezon City",
      licenseNumber: "ABC-2024-001",
    });

    expect(card.fullName).toBe("Maria Santos");
    expect(card.trade).toBe("Plumbing");
    expect(card.serviceArea).toBe("Quezon City");
    expect(card.licenseNumber).toBe("ABC-2024-001");
    expect(card.verificationLabel).toContain("Verified");
  });
});
