/**
 * Color Palette - Light Theme
 * All colors used throughout the HomeEase application
 * Theme: Light backgrounds, dark text, Royal Blue primary, Deep Orange accents
 */
export const colors = {
  // ===== PRIMARY PALETTE =====
  // Used for main brand elements, buttons, navigation, and primary CTAs
  primary: {
    DEFAULT: '#4169E1', // Royal Blue - Primary brand color - main buttons, navigation, links
    dark: '#2E50B2',    // Darker Royal Blue - pressed states, hover effects
    light: '#6B84F0'    // Lighter Royal Blue - disabled states, backgrounds
  },

  // ===== ACCENT PALETTE =====
  // Used for highlights, secondary actions, alerts, and interactive elements
  accent: {
    DEFAULT: '#FB8B23', // Deep Orange - Accent color - alerts, highlights, special features
    light: '#FFA950',   // Light Orange - hover states, focused elements
    muted: '#E57E1A'    // Muted Orange - disabled actions, subtle backgrounds
  },

  // ===== CARD & CONTAINER =====
  // Used for card backgrounds, modals, bottom sheets, and content containers
  card: {
    DEFAULT: '#FFFFFF',  // White - Card default background
    light: '#F9FAFB',    // Very Light Gray - Light card variant - alternate row backgrounds
    dark: '#F3F4F6'      // Light Gray - Dark card variant - pressed/selected states
  },

  // ===== SURFACE & BACKGROUND =====
  // Used for main screen backgrounds and surface elements
  surface: '#F3F4F6',   // Light Gray - Main background color for screens and containers
  white: '#FFFFFF',     // White - Pure white - cards, overlays, text on primary

  // ===== TEXT & TYPOGRAPHY =====
  // Used for text content at different prominence levels
  text: {
    primary: '#000000',   // Dark Charcoal - Main text - headings, body copy, labels
    muted: '#6B7280'      // Medium Gray - Secondary text - hints, descriptions, dates
  },

  // ===== STATUS & FEEDBACK =====
  // Used for status badges, status indicators, and feedback messages
  success: '#10B981',     // Emerald Green - Success states - completed bookings, successful actions
  error: '#EF4444',       // Bright Red - Error states - cancellations, error messages, invalid inputs
  warning: '#F59E0B',     // Amber Orange - Warning states - pending actions, alerts
  pending: '#F59E0B',     // Amber Orange - Pending status - waiting approvals, under review
  active: '#4169E1',      // Royal Blue - Active/Online status - active users, live indicators
  completed: '#10B981',   // Emerald Green - Completed status - finished tasks, verified items
  cancelled: '#EF4444',   // Bright Red - Cancelled status - rejected items, cancelled bookings

  // ===== ACCENT COLORS =====
  // Used for special highlights and premium features
  gold: '#FB8B23',        // Deep Orange - Premium highlight - ratings, premium badges, special features

  // ===== DIVIDERS & SEPARATORS =====
  // Used for lines, borders, and visual separation
  divider: '#E5E7EB',      // Light Gray - Divider color - borders, separators, bottom sheets

  // ===== ADDITIONAL COLORS =====
  // Used for additional UI elements and states
  banner1: '#FFE2BC', // Light Peach - Promo banner 1 background
  banner2: '#D1F7E0', // Light Mint - Promo banner 2 background
  banner3: '#E0E0E0', // Light Gray - Promo banner 3 background

} as const;

export type AppColors = typeof colors;

