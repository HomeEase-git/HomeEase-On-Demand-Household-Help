export type DigitalIdCardData = {
  name: string;
  avatar?: string | null;
  badgeId: string;
  verified: boolean;
  rating: number;
  totalReviews: number;
  trade?: string;
  serviceArea?: string;
  licenseNumber?: string;
};

export type DigitalIdCard = {
  fullName: string;
  avatar: string | null;
  badgeId: string;
  verified: boolean;
  verificationLabel: string;
  rating: number;
  totalReviews: number;
  trade?: string;
  serviceArea?: string;
  licenseNumber?: string;
};

export const buildDigitalIdCard = (data: DigitalIdCardData): DigitalIdCard => ({
  fullName: data.name || "Unknown User",
  avatar: data.avatar ?? null,
  badgeId: data.badgeId,
  verified: data.verified,
  verificationLabel: data.verified
    ? "HomeEase Verified Worker"
    : "Verification Pending",
  rating: data.rating,
  totalReviews: data.totalReviews,
  trade: data.trade || undefined,
  serviceArea: data.serviceArea || undefined,
  licenseNumber: data.licenseNumber || undefined,
});
