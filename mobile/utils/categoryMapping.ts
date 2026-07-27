/**
 * Category Mapping Utility
 *
 * Normalizes worker.service labels (from backend/worker profiles) to serviceConfig.categoryName values.
 * This ensures that a worker's service label is reliably matched against available service categories,
 * even if the backend uses slightly different naming conventions.
 */

import { serviceConfigs } from '../constants/serviceData';

/**
 * Internal: finds the serviceConfig matching a worker service string, if any.
 * Both mapServiceToCategory and isExactCategoryMatch delegate here so the
 * normalization + lookup only happens once per call site.
 */
function findMatchingConfig(workerService: string | null | undefined) {
  if (!workerService) return undefined;
  const normalized = workerService.trim().toLowerCase();
  return serviceConfigs.find(
    (config) =>
      config.categoryName.toLowerCase() === normalized ||
      config.categoryId.toLowerCase() === normalized,
  );
}

/**
 * Maps a worker service name to the canonical serviceConfig categoryName.
 * Uses case-insensitive matching and removes leading/trailing whitespace.
 *
 * Falls back to the raw input if no exact match is found, but logs a warning in development
 * to surface naming mismatches between worker profiles and serviceConfigs.
 *
 * @param workerService - The service name from a worker profile (e.g., "plumbing", "Electrical", "aircon cleaning")
 * @returns The matching categoryName from serviceConfigs, the input value if no match found, or null if input is null/undefined
 */
export function mapServiceToCategory(workerService: string | null | undefined): string | null {
  if (!workerService) return null;

  const match = findMatchingConfig(workerService);
  if (match) {
    return match.categoryName;
  }

  // Fallback: return the raw input, but warn in development so naming drift is visible
  if (__DEV__) {
    console.warn(
      `[categoryMapping] Worker service "${workerService}" did not match any known category. Falling back to raw value. Known categories: ${serviceConfigs.map((c) => c.categoryName).join(", ")}`
    );
  }
  return workerService;
}

/**
 * Checks if a service name is a valid category.
 *
 * @param workerService - The service name to validate
 * @returns true if the service maps to a known category, false otherwise
 */
export function isValidCategory(workerService: string | null | undefined): boolean {
  return mapServiceToCategory(workerService) !== null;
}

/**
 * Checks if a worker service name matches an exact known category.
 * Used to validate worker-profile-to-booking routing before committing to workerLocked: true.
 *
 * @param workerService - The service name from a worker profile
 * @returns true if the service matches a known categoryName or categoryId (case/whitespace-insensitive)
 */
export function isExactCategoryMatch(workerService: string | null | undefined): boolean {
  return findMatchingConfig(workerService) !== undefined;
}

export default { mapServiceToCategory, isValidCategory, isExactCategoryMatch };