export function roundToCentavo(amount: number): number {
  return Math.round(amount * 100) / 100;
}
