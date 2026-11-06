export const spacing = {
  xs: 4,
  sm: 8,    // Small - buttons, input padding
  md: 16,   // Medium - standard spacing between elements
  lg: 24,   // Large - section spacing, card margins
  xl: 32,   // Extra large - page-level spacing, major sections
} as const;

export type Spacing = keyof typeof spacing;
