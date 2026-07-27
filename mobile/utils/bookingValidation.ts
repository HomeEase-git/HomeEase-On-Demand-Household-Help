import { DraftBooking } from '../store/bookingStore';
import { isValidHHmm } from './time';

export function validateDraftForSubmit(draft: DraftBooking): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!draft.category) errors.push('Please select a service category.');
  if (!draft.address) errors.push('Please enter a service address.');
  if (!draft.date) errors.push('Please select a date.');
  if (!draft.time) errors.push('Please select a time.');
  if (draft.time && !isValidHHmm(draft.time)) errors.push('Selected time format is invalid.');
  if (!draft.workerId) errors.push('Please select a worker.');
  if (!draft.paymentMethod) errors.push('Please select a payment method.');

  return { ok: errors.length === 0, errors };
}

export function getDraftInvalidationReasons(draft: DraftBooking): string[] {
  const reasons: string[] = [];
  if (draft.lastInvalidationReason) reasons.push(draft.lastInvalidationReason);
  // Additional programmatic reasons could be pushed here in future.
  return reasons;
}

export default { validateDraftForSubmit, getDraftInvalidationReasons };
