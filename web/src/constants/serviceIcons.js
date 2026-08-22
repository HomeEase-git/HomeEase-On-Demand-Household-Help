// Curated Ionicons outline names an admin can assign to a service category.
// Keep in sync with backend/src/constants/serviceIcons.ts (the validation
// source of truth) — `ion` is the value actually stored and sent to mobile's
// <Ionicons name={icon} />; `ms` is only a Material Symbols ligature used to
// render a visual preview here, since the web admin can't load Ionicons.
export const SERVICE_ICON_GROUPS = [
  {
    group: 'Core Trades',
    icons: [
      { name: 'Cleaning', ms: 'cleaning_services', ion: 'sparkles-outline' },
      { name: 'Plumbing', ms: 'plumbing', ion: 'water-outline' },
      { name: 'Electrical', ms: 'electrical_services', ion: 'flash-outline' },
      { name: 'Carpentry', ms: 'carpenter', ion: 'hammer-outline' },
      { name: 'Painting', ms: 'format_paint', ion: 'color-palette-outline' },
      { name: 'Appliance Repair', ms: 'home_repair_service', ion: 'build-outline' },
      { name: 'Pest Control', ms: 'pest_control', ion: 'bug-outline' },
    ],
  },
  {
    group: 'Climate & Comfort',
    icons: [
      { name: 'Aircon / HVAC', ms: 'ac_unit', ion: 'snow-outline' },
      { name: 'Heating & Gas', ms: 'local_fire_department', ion: 'flame-outline' },
    ],
  },
  {
    group: 'Outdoor & Grounds',
    icons: [
      { name: 'Gardening / Landscaping', ms: 'yard', ion: 'leaf-outline' },
      { name: 'Roofing', ms: 'roofing', ion: 'umbrella-outline' },
      { name: 'Junk Removal', ms: 'delete_sweep', ion: 'trash-outline' },
    ],
  },
  {
    group: 'Auto & Moving',
    icons: [
      { name: 'Moving Services', ms: 'local_shipping', ion: 'cube-outline' },
      { name: 'Car Wash / Detailing', ms: 'local_car_wash', ion: 'car-outline' },
    ],
  },
  {
    group: 'Home & Family',
    icons: [
      { name: 'Babysitting', ms: 'child_care', ion: 'happy-outline' },
      { name: 'Pet Care & Grooming', ms: 'pets', ion: 'paw-outline' },
      { name: 'Elderly Care', ms: 'elderly', ion: 'medkit-outline' },
      { name: 'Laundry', ms: 'local_laundry_service', ion: 'shirt-outline' },
    ],
  },
  {
    group: 'Security & Access',
    icons: [
      { name: 'Locksmith', ms: 'key', ion: 'key-outline' },
      { name: 'CCTV Installation', ms: 'videocam', ion: 'videocam-outline' },
      { name: 'Home Security', ms: 'security', ion: 'shield-checkmark-outline' },
    ],
  },
  {
    group: 'Tech & Electronics',
    icons: [
      { name: 'Computer Repair', ms: 'computer', ion: 'desktop-outline' },
      { name: 'Phone Repair', ms: 'smartphone', ion: 'phone-portrait-outline' },
      { name: 'WiFi / Network Setup', ms: 'wifi', ion: 'wifi-outline' },
      { name: 'TV & Appliance Install', ms: 'tv', ion: 'tv-outline' },
    ],
  },
  {
    group: 'Wellness & Personal Care',
    icons: [
      { name: 'Massage Therapy', ms: 'spa', ion: 'flower-outline' },
      { name: 'Fitness Training', ms: 'fitness_center', ion: 'barbell-outline' },
      { name: 'Haircut & Grooming', ms: 'content_cut', ion: 'cut-outline' },
    ],
  },
  {
    group: 'Events & Lifestyle',
    icons: [
      { name: 'Catering', ms: 'restaurant', ion: 'restaurant-outline' },
      { name: 'Photography', ms: 'photo_camera', ion: 'camera-outline' },
      { name: 'Tutoring', ms: 'school', ion: 'school-outline' },
      { name: 'Event Styling', ms: 'celebration', ion: 'gift-outline' },
      { name: 'General Handyman', ms: 'handyman', ion: 'construct-outline' },
    ],
  },
]

export const SERVICE_ICONS_FLAT = SERVICE_ICON_GROUPS.flatMap((g) => g.icons)

export function msIconFor(ion) {
  return SERVICE_ICONS_FLAT.find((i) => i.ion === ion)?.ms ?? 'category'
}
