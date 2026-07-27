/**
 * Color Palette - Light Theme
 * Single source of truth lives in `tailwind.config.js` (NativeWind needs it as
 * plain CommonJS); this file just re-exports that same object, typed, so JS/TS
 * code (icon colors, StyleSheet, etc.) and Tailwind classNames can never drift.
 */
import tailwindConfig from "../tailwind.config.js";

export interface AppColors {
  brand: { DEFAULT: string; dark: string; light: string };
  accent: { DEFAULT: string; light: string; muted: string };
  card: { DEFAULT: string; light: string; dark: string };
  surface: string;
  white: string;
  neutral: {
    50: string; 100: string; 200: string; 300: string; 400: string;
    500: string; 600: string; 700: string; 800: string; 900: string;
  };
  text: { primary: string; secondary: string; muted: string; black: string };
  gold: string;
  success: string;
  error: string;
  warning: string;
  pending: string;
  active: string;
  completed: string;
  cancelled: string;
  divider: string;
  toggleOff: string;
  banner1: string;
  banner2: string;
  banner3: string;
}

export const colors = tailwindConfig.theme!.extend!.colors as unknown as AppColors;
