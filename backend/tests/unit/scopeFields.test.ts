import { fieldAppliesToTask, validateScopeAnswers, type ScopeFieldForValidation } from '@utils/scopeFields';

function field(overrides: Partial<ScopeFieldForValidation> & { id: string; label: string }): ScopeFieldForValidation {
  return {
    fieldType: 'TEXT',
    required: true,
    minValue: null,
    maxValue: null,
    options: [],
    taskLinks: [],
    ...overrides,
  };
}

const toiletJob = { id: 'task-toilet', quantityScopeFieldId: 'f-toilets' };
const leakJob = { id: 'task-leak', quantityScopeFieldId: null };

describe('fieldAppliesToTask', () => {
  it('applies an unlinked field to every job and to category-level bookings', () => {
    const f = field({ id: 'f-area', label: 'Where is the problem?' });
    expect(fieldAppliesToTask(f, toiletJob)).toBe(true);
    expect(fieldAppliesToTask(f, leakJob)).toBe(true);
    expect(fieldAppliesToTask(f, null)).toBe(true);
  });

  it('applies a linked field only to its linked jobs', () => {
    const f = field({ id: 'f-pipe', label: 'Pipe material', taskLinks: [{ serviceTaskId: 'task-leak' }] });
    expect(fieldAppliesToTask(f, leakJob)).toBe(true);
    expect(fieldAppliesToTask(f, toiletJob)).toBe(false);
    expect(fieldAppliesToTask(f, null)).toBe(false);
  });

  it("always applies a per-unit job's quantity field to that job, even when linked elsewhere", () => {
    const f = field({ id: 'f-toilets', label: 'How many toilets?', taskLinks: [{ serviceTaskId: 'other-job' }] });
    expect(fieldAppliesToTask(f, toiletJob)).toBe(true);
  });
});

describe('validateScopeAnswers', () => {
  const fields = [
    field({ id: 'f-area', label: 'Where is the problem?' }),
    field({
      id: 'f-toilets',
      label: 'How many toilets?',
      fieldType: 'NUMBER',
      minValue: 1,
      maxValue: 5,
      taskLinks: [{ serviceTaskId: 'task-toilet' }],
    }),
    field({
      id: 'f-pipe',
      label: 'Pipe material',
      fieldType: 'SELECT',
      options: [{ label: 'PVC' }, { label: 'Copper' }],
      taskLinks: [{ serviceTaskId: 'task-leak' }],
    }),
  ];

  it('requires only the fields that apply to the chosen job', () => {
    expect(validateScopeAnswers(fields, { 'Where is the problem?': 'Kitchen', 'Pipe material': 'PVC' }, leakJob)).toBeNull();
    expect(validateScopeAnswers(fields, { 'Where is the problem?': 'Kitchen' }, leakJob)).toBe(
      '"Pipe material" is required for this service'
    );
  });

  it("ignores answers to fields that don't apply, so older app builds that send every answer still work", () => {
    const answers = { 'Where is the problem?': 'Kitchen', 'Pipe material': 'not-an-option', 'How many toilets?': '2' };
    expect(validateScopeAnswers(fields, answers, toiletJob)).toBeNull();
  });

  it('still validates choice and number answers on applicable fields', () => {
    expect(validateScopeAnswers(fields, { 'Where is the problem?': 'x', 'Pipe material': 'Steel' }, leakJob)).toBe(
      '"Pipe material" has an invalid selection'
    );
    expect(validateScopeAnswers(fields, { 'Where is the problem?': 'x', 'How many toilets?': '9' }, toiletJob)).toBe(
      '"How many toilets?" is outside the allowed range'
    );
    expect(validateScopeAnswers(fields, { 'Where is the problem?': 'x', 'How many toilets?': 'two' }, toiletJob)).toBe(
      '"How many toilets?" must be a number'
    );
  });
});
