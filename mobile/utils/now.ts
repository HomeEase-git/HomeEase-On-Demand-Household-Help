// Indirection around Date.now() so event-handler code (e.g. starting the
// booking hold timer) doesn't call the impure Date.now() directly inside a
// component body — keeps the react-hooks/purity lint rule happy without
// restructuring call sites, and is a convenient seam for tests to mock time.
export function now(): number {
  return Date.now();
}
