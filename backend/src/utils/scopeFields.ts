import type { ScopeFieldType } from '@prisma/client';

export type ScopeAnswers = Record<string, string | string[]>;

export interface ScopeFieldForValidation {
  id: string;
  label: string;
  fieldType: ScopeFieldType;
  required: boolean;
  minValue: number | null;
  maxValue: number | null;
  options: { label: string }[];
  taskLinks?: { serviceTaskId: string }[];
}

/**
 * Whether a scope field is asked for a given job. A field with no task links
 * applies to every job in its category (the only behavior before
 * ServiceScopeFieldTask existed), and a PER_UNIT/TIERED task's own quantity
 * field always applies to that task, even if an admin linked it elsewhere —
 * the price can't be computed without it. A category-level booking (no task
 * picked) is only asked the unlinked fields.
 */
export function fieldAppliesToTask(
  field: Pick<ScopeFieldForValidation, 'id' | 'taskLinks'>,
  task: { id: string; quantityScopeFieldId?: string | null } | null
): boolean {
  if (task && task.quantityScopeFieldId === field.id) return true;
  const links = field.taskLinks ?? [];
  if (links.length === 0) return true;
  return task ? links.some((l) => l.serviceTaskId === task.id) : false;
}

/**
 * Checks a booking's scope answers against the fields that apply to the
 * chosen task (or category). Returns an error message, or null when valid.
 * Answers to fields that don't apply are left alone rather than rejected, so
 * an older app build that still shows every field in the category keeps
 * working.
 */
export function validateScopeAnswers(
  fields: ScopeFieldForValidation[],
  answers: ScopeAnswers,
  task: { id: string; quantityScopeFieldId?: string | null } | null
): string | null {
  for (const field of fields) {
    if (!fieldAppliesToTask(field, task)) continue;
    const answer = answers[field.label];
    const hasAnswer = Array.isArray(answer) ? answer.length > 0 : typeof answer === 'string' && answer.trim().length > 0;
    if (field.required && !hasAnswer) {
      return `"${field.label}" is required for this service`;
    }
    if (hasAnswer && (field.fieldType === 'SELECT' || field.fieldType === 'MULTI_SELECT')) {
      const validLabels = new Set(field.options.map((o) => o.label));
      const values = Array.isArray(answer) ? answer : [answer as string];
      if (!values.every((v) => validLabels.has(v))) {
        return `"${field.label}" has an invalid selection`;
      }
    }
    if (hasAnswer && field.fieldType === 'NUMBER') {
      const n = Number(answer);
      if (Number.isNaN(n)) {
        return `"${field.label}" must be a number`;
      }
      if ((field.minValue != null && n < field.minValue) || (field.maxValue != null && n > field.maxValue)) {
        return `"${field.label}" is outside the allowed range`;
      }
    }
  }
  return null;
}
