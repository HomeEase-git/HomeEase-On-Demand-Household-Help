export type DigitalIdCardData = {
  name: string;
  email: string;
  phone: string;
  role: "worker" | "client";
  trade?: string;
  serviceArea?: string;
  licenseNumber?: string;
};

export type DigitalIdCard = {
  fullName: string;
  email: string;
  phone: string;
  roleLabel: string;
  trade: string;
  serviceArea: string;
  licenseNumber: string;
  verificationLabel: string;
};

export const buildDigitalIdCard = (data: DigitalIdCardData): DigitalIdCard => ({
  fullName: data.name || "Unknown User",
  email: data.email || "—",
  phone: data.phone || "—",
  roleLabel: data.role === "worker" ? "Verified Worker" : "Verified Client",
  trade: data.trade || "General Services",
  serviceArea: data.serviceArea || "Service Area Pending",
  licenseNumber: data.licenseNumber || "Not provided",
  verificationLabel: `HomeEase Verified ${data.role === "worker" ? "Worker" : "Client"}`,
});
