/** -1 / 0 / 1 comparing dotted versions numerically ("1.0.10" > "1.0.9"); missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Which store prompt the installed version needs, given the server's latest/minimum. */
export function storeUpdateNeed(
  installed: string | null | undefined,
  info: { latest?: string | null; minimum?: string | null },
): "required" | "optional" | null {
  if (!installed) return null;
  if (info.minimum && compareVersions(installed, info.minimum) < 0) return "required";
  if (info.latest && compareVersions(installed, info.latest) < 0) return "optional";
  return null;
}
