/**
 * Category Mapping Utility
 *
 * Normalizes worker.service labels (from backend/worker profiles) to serviceConfig.categoryName values.
 * This ensures that a worker's service label is reliably matched against available service categories,
 * even if the backend uses slightly different naming conventions.
 */

import { serviceConfigs } from '../constants/serviceData';

/**
 * Known backend category names (or worker-facing labels) that refer to a
 * bookable serviceConfig but don't match its categoryName/categoryId exactly.
 * Keys are normalized (trimmed, lowercased); values are serviceConfig categoryIds.
 *
 * Categories with no entry here (e.g. "Painting", "Pest Control", "Appliance
 * Repair") have no bookable flow in the app yet — that's not a naming gap,
 * there's genuinely no serviceConfig to route them to.
 */
const CATEGORY_ALIASES: Record<string, string> = {
  'aircon & refrigeration': 'aircon',
  'aircon and refrigeration': 'aircon',
  'refrigeration': 'aircon',
};

/**
 * Internal: finds the serviceConfig matching a worker service string, if any.
 * Both mapServiceToCategory and isExactCategoryMatch delegate here so the
 * normalization + lookup only happens once per call site.
 */
function findMatchingConfig(workerService: string | null | undefined) {
  if (!workerService) return undefined;
  const normalized = workerService.trim().toLowerCase();

  const aliasId = CATEGORY_ALIASES[normalized];
  if (aliasId) {
    return serviceConfigs.find((config) => config.categoryId === aliasId);
  }

  return serviceConfigs.find(
    (config) =>
      config.categoryName.toLowerCase() === normalized ||
      config.categoryId.toLowerCase() === normalized,
  );
}

/**
 * Maps a worker service name to a category name suitable for `DraftBooking.category`.
 * Uses case-insensitive matching and removes leading/trailing whitespace.
 *
 * Downstream, `booking/new/step-1.tsx` resolves the actual bookable ServiceType by
 * matching this value against the LIVE backend category list (GET /services), not
 * against serviceConfigs. So for aliased categories (e.g. "Aircon & Refrigeration",
 * which is itself the real backend name, just not a serviceConfig.categoryName match)
 * we must return the original label as-is rather than the shortened local
 * categoryName ("Aircon") — rewriting it would make it match nothing in step-1's
 * live lookup. Only genuine casing/whitespace variants of an already-identical
 * local category name get normalized to serviceConfig's canonical categoryName.
 *
 * Falls back to the raw input if no exact match is found, but logs a warning in development
 * to surface naming mismatches between worker profiles and serviceConfigs.
 *
 * @param workerService - The service name from a worker profile (e.g., "plumbing", "Electrical", "aircon cleaning")
 * @returns The matching categoryName from serviceConfigs, the original label for aliased matches, the input value if no match found, or null if input is null/undefined
 */
export function mapServiceToCategory(workerService: string | null | undefined): string | null {
  if (!workerService) return null;

  const trimmed = workerService.trim();
  const normalized = trimmed.toLowerCase();

  if (CATEGORY_ALIASES[normalized]) {
    return trimmed;
  }

  const match = findMatchingConfig(trimmed);
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

/**
 * Finds the local serviceConfig (tasks/addOns) matching a category name, alias-aware.
 * Use this instead of a raw `categoryName` string comparison when looking up
 * addOns/tasks for a category that may be an alias (e.g. "Aircon & Refrigeration").
 *
 * @param categoryName - A category name, typically `DraftBooking.category`
 * @returns The matching ServiceConfig, or undefined if none exists locally
 */
export function resolveServiceConfig(categoryName: string | null | undefined) {
  return findMatchingConfig(categoryName);
}

export default { mapServiceToCategory, isValidCategory, isExactCategoryMatch, resolveServiceConfig };