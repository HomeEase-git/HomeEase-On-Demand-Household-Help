import type { CalendarDay } from "../services/api";

// Low-opacity day tints so a busy month doesn't turn into a wall of color:
// 1 job green, 2-3 yellow, 4+ red, a day off gray. Shared by the
// availability calendar and the worker home "This week" strip.
export function dayTint(day: CalendarDay | undefined): string {
  if (!day) return "bg-transparent";
  if (day.jobCount >= 4) return "bg-error/20";
  if (day.jobCount >= 2) return "bg-warning/20";
  if (day.jobCount === 1) return "bg-success/20";
  if (!day.available) return "bg-neutral-300/50";
  return "bg-transparent";
}

/** YYYY-MM-DD `days` after the given YYYY-MM-DD date. */
export function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}
