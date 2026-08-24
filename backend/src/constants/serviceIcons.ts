// Curated Ionicons outline names admins can assign to a ServiceType, shown
// picker-side in web/src/constants/serviceIcons.js (keep both lists in sync —
// this one is the source of truth for validation). Values match exactly what
// mobile's <Ionicons name={icon} /> expects (@expo/vector-icons Ionicons5).
export const VALID_SERVICE_ICONS = [
  'sparkles-outline',
  'water-outline',
  'flash-outline',
  'hammer-outline',
  'color-palette-outline',
  'build-outline',
  'bug-outline',
  'snow-outline',
  'flame-outline',
  'leaf-outline',
  'umbrella-outline',
  'trash-outline',
  'cube-outline',
  'car-outline',
  'happy-outline',
  'paw-outline',
  'medkit-outline',
  'shirt-outline',
  'key-outline',
  'videocam-outline',
  'shield-checkmark-outline',
  'desktop-outline',
  'phone-portrait-outline',
  'wifi-outline',
  'tv-outline',
  'flower-outline',
  'barbell-outline',
  'cut-outline',
  'restaurant-outline',
  'camera-outline',
  'school-outline',
  'gift-outline',
  'construct-outline',
] as const;

export type ValidServiceIcon = (typeof VALID_SERVICE_ICONS)[number];
