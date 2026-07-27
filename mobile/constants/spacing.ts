/**
 * Spacing Constants - Standardized spacing scale for consistent layout
 * All values in pixels
 */
export const spacing = {
  xs: 4,    // Extra small - minimal gaps, tight spacing (badge padding)
  sm: 8,    // Small - buttons, input padding
  md: 16,   // Medium - standard spacing between elements
  lg: 24,   // Large - section spacing, card margins
  xl: 32,   // Extra large - page-level spacing, major sections
} as const;

export type Spacing = keyof typeof spacing;
