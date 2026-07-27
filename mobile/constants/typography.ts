/**
 * Typography Constants - Font sizes and weights used throughout the application
 */

// Font sizes for different text levels
export const fontSizes = {
  xs: 12,     // Small labels, captions, hints
  sm: 14,     // Body text, buttons, cards
  base: 16,   // Standard text, descriptions
  lg: 18,     // Subheadings, section titles
  xl: 20,     // Large titles, main headings
  '2xl': 24,  // Page titles, hero text
  '3xl': 30,  // Large page headers
} as const;

// Font weights for text emphasis
export const fontWeights = {
  normal: '400' as const,     // Regular text - body copy, descriptions
  medium: '500' as const,     // Slightly emphasized - labels, secondary text
  semibold: '600' as const,   // Emphasized - subheadings, highlights
  bold: '700' as const,       // Strong emphasis - main headings, important text
};

export type FontSize = keyof typeof fontSizes;
export type FontWeight = keyof typeof fontWeights;
