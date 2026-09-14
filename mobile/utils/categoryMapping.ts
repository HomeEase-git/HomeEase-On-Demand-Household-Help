/**
 * Category Mapping Utility
 *
 * Normalizes worker.service labels (from backend/worker profiles) to a
 * DraftBooking.category value. `booking/new/step-1.tsx` resolves the actual
 * bookable ServiceType by matching this against the LIVE backend category
 * list (GET /services) case-insensitively, so this just needs to hand back
 * a clean label — every ServiceType an admin creates is bookable regardless
 * of anything local.
 *
 * @param workerService - The service name from a worker profile (e.g., "Plumbing Repair")
 * @returns The trimmed input, or null if input is null/undefined
 */
export function mapServiceToCategory(workerService: string | null | undefined): string | null {
  if (!workerService) return null;
  return workerService.trim();
}

export default { mapServiceToCategory };
