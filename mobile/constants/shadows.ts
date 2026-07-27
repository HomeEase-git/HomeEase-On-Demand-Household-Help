/**
 * Shared elevation styles - applied via the `style` prop (not className) since
 * Android's floating effect needs `elevation`, which Tailwind's box-shadow
 * utilities don't reliably translate to.
 */
export const cardShadow = {
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.08,
  shadowRadius: 6,
  elevation: 4,
} as const;
