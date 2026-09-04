export type DigitalIdCardData = {
  id?: string;
  name: string;
  avatar?: string | null;
  badgeId: string;
  verified: boolean;
  rating: number;
  totalReviews: number;
  trade?: string;
  serviceArea?: string;
  licenseNumber?: string;
  memberSince?: string | null;
  kycApprovedAt?: string | null;
  /** Base URL the QR code points at, e.g. the API/web origin. */
  verificationBaseUrl?: string;
};

export type DigitalIdCard = {
  fullName: string;
  avatar: string | null;
  badgeId: string;
  verified: boolean;
  verificationLabel: string;
  statusLabel: string;
  rating: number;
  totalReviews: number;
  trade?: string;
  serviceArea?: string;
  licenseNumber?: string;
  /** "Sep 2026" style label, or "—" when unknown. */
  memberSinceLabel: string;
  /** "02 Sep 2026" style label, or "Pending review" when not yet approved. */
  kycApprovedLabel: string;
  /** URL encoded into the scan-to-verify QR code. */
  verificationUrl: string;
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Sep 2026" — month + year only. */
export const formatMonthYear = (value?: string | null): string => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

/** "02 Sep 2026" — zero-padded day, short month, year. */
export const formatFullDate = (value?: string | null): string => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  return `${day} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

export const buildDigitalIdCard = (data: DigitalIdCardData): DigitalIdCard => {
  const base = (data.verificationBaseUrl || "https://homeease.app").replace(/\/+$/, "");
  const ref = data.id || data.badgeId;

  return {
    fullName: data.name || "Unknown User",
    avatar: data.avatar ?? null,
    badgeId: data.badgeId,
    verified: data.verified,
    verificationLabel: data.verified ? "Verified worker" : "Verification pending",
    statusLabel: data.verified ? "Live — checked on scan" : "Pending review",
    rating: data.rating,
    totalReviews: data.totalReviews,
    trade: data.trade || undefined,
    serviceArea: data.serviceArea || undefined,
    licenseNumber: data.licenseNumber || undefined,
    memberSinceLabel: formatMonthYear(data.memberSince),
    kycApprovedLabel: data.verified ? formatFullDate(data.kycApprovedAt) : "Pending review",
    verificationUrl: `${base}/verify/worker/${ref}`,
  };
};
