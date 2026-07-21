/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // PRIMARY PALETTE - Royal Blue
        primary: {
          DEFAULT: "#4169E1",
          dark: "#2E50B2",
          light: "#6B84F0",
          white: "#FFFFFF",
        },
        // ACCENT PALETTE - Deep Orange
        accent: {
          DEFAULT: "#FB8B23",
          light: "#FFA950",
          muted: "#E57E1A",
        },
        // CARD & CONTAINER
        card: {
          DEFAULT: "#FFFFFF",
          light: "#F9FAFB",
          dark: "#F3F4F6",
        },
        // SURFACE & BACKGROUND
        surface: "#F3F4F6",
        white: "#FFFFFF",
        // TEXT & TYPOGRAPHY
        text: {
          primary: "#000000",
          secondary: "#6B7280",
          muted: "#9CA3AF",
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
        // ADDITIONAL COLORS
        banner1: "#FFE2BC",
        banner2: "#D1F7E0",
        banner3: "#E0E0E0",
      },
    },
  },
  plugins: [],
};
