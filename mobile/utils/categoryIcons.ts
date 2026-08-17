import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

/**
 * Best-effort icon per category/service name — falls back to a generic icon
 * for whatever else is seeded (categories are DB-driven via GET /services,
 * not hardcoded, so this can't be an exhaustive map).
 */
const CATEGORY_ICONS: Record<string, IoniconName> = {
  "standard clean": "sparkles-outline",
  "deep clean": "water-outline",
  "move-in/move-out": "home-outline",
  "post-renovation": "construct-outline",
  handyman: "hammer-outline",
  "heavy lifting": "barbell-outline",
  cleaning: "sparkles-outline",
  plumbing: "water-outline",
  electrical: "flash-outline",
  aircon: "snow-outline",
  "aircon & refrigeration": "snow-outline",
  "aircon and refrigeration": "snow-outline",
  refrigeration: "snow-outline",
  carpentry: "hammer-outline",
  painting: "color-palette-outline",
  "pest control": "bug-outline",
  "appliance repair": "build-outline",
  gardening: "leaf-outline",
  "car wash": "car-outline",
  babysitting: "happy-outline",
  "pet care": "paw-outline",
  moving: "cube-outline",
};

const DEFAULT_ICON: IoniconName = "construct-outline";

export function getCategoryIcon(name: string | null | undefined): IoniconName {
  if (!name) return DEFAULT_ICON;
  return CATEGORY_ICONS[name.trim().toLowerCase()] ?? DEFAULT_ICON;
}
