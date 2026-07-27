/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // BRAND PALETTE - Royal Blue (renamed from `primary` to avoid colliding
        // with the `text.primary` semantic token — text-primary vs text-brand)
        brand: {
          DEFAULT: "#4169E1",
          dark: "#2E50B2",
          light: "#6B84F0",
        },
        // ACCENT PALETTE - Deep Orange
        accent: {
          DEFAULT: "#FB8B23",
          light: "#FFA950",
          muted: "#E57E1A",
        },
        // CARD & CONTAINER - darkened off the page's white background so cards
        // read as distinct, elevated surfaces instead of blending into the page
        card: {
          DEFAULT: "#F3F4F6",
          light: "#F9FAFB",
          dark: "#E5E7EB",
        },
        // SURFACE & BACKGROUND
        surface: "#F3F4F6",
        white: "#FFFFFF",
        // NEUTRAL GRAY SCALE - single ramp backing text/surface/divider aliases
        // below, instead of independently-guessed hex values
        neutral: {
          50: "#F9FAFB",
          100: "#F3F4F6",
          200: "#E5E7EB",
          300: "#D1D5DB",
          400: "#9CA3AF",
          500: "#6B7280",
          600: "#4B5563",
          700: "#374151",
          800: "#1F2937",
          900: "#111827",
        },
        // TEXT & TYPOGRAPHY - `primary` is a dark navy derived from the brand
        // blue (not pure black) so headings/body carry a subtle brand
        // undertone; `black` stays available for the rare case true black is
        // wanted.
        text: {
          primary: "#4169E1",
          secondary: "#6B7280",
          muted: "#9CA3AF",
          black: "#000000",
        },
        // ACCENT COLORS
        gold: "#FB8B23",
        // STATUS & FEEDBACK
        success: "#10B981",
        error: "#EF4444",
        warning: "#F59E0B",
        pending: "#F59E0B",
        active: "#4169E1",
        completed: "#10B981",
        cancelled: "#EF4444",
        divider: "#E5E7EB",
        // Hardcoded "off" track color reused across Switch components
        toggleOff: "#2A3080",
        // ADDITIONAL COLORS
        banner1: "#FFE2BC",
        banner2: "#D1F7E0",
        banner3: "#E0E0E0",
      },
    },
  },
  plugins: [],
};
