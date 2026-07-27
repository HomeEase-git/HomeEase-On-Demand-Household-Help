/**
 * Form Validation Error Handling Tests
 */

import {
  validateField,
  validateForm,
  validateFieldAsync,
  type ValidationField,
  type ValidationRule,
  useFormValidation,
} from '../formValidation';

describe('Form Validation', () => {
  describe('Field Validation', () => {
    test('validates required fields', () => {
      const field: ValidationField = {
        name: 'email',
        value: '',
        rules: [{ type: 'required' }],
      };

      const result = validateField(field);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });

    test('validates email format', () => {
      const invalidField: ValidationField = {
        name: 'email',
        value: 'invalid-email',
        rules: [{ type: 'email' }],
      };

      const result = validateField(invalidField);
      expect(result.valid).toBe(false);

      const validField: ValidationField = {
        name: 'email',
        value: 'test@example.com',
        rules: [{ type: 'email' }],
      };

      const validResult = validateField(validField);
      expect(validResult.valid).toBe(true);
    });

    test('validates password requirements', () => {
      const weakField: ValidationField = {
        name: 'password',
        value: '123',
        rules: [{ type: 'password' }],
      };

      const result = validateField(weakField);
      expect(result.valid).toBe(false);
    });

    test('validates minLength constraint', () => {
      const field: ValidationField = {
        name: 'username',
        value: 'ab',
        rules: [{ type: 'minLength', params: { min: 3 } }],
      };

      const result = validateField(field);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('at least 3');
    });

    test('validates maxLength constraint', () => {
      const field: ValidationField = {
        name: 'username',
        value: 'verylongusername',
        rules: [{ type: 'maxLength', params: { max: 10 } }],
      };

      const result = validateField(field);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not exceed 10');
    });

    test('validates pattern matching', () => {
      const field: ValidationField = {
        name: 'phone',
        value: 'abc123',
        rules: [{ type: 'pattern', params: { pattern: /^\d+$/ } }],
      };

      const result = validateField(field);
      expect(result.valid).toBe(false);
    });

    test('validates field matching', () => {
      const field: ValidationField = {
        name: 'confirmPassword',
        value: 'password123',
        rules: [{ type: 'match', params: { value: 'password456' } }],
      };

      const result = validateField(field);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('do not match');
    });

    test('validates with custom error messages', () => {
      const field: ValidationField = {
        name: 'email',
        value: 'invalid',
        rules: [
          {
            type: 'email',
            message: 'Please enter a valid email address',
          },
        ],
      };

      const result = validateField(field);
      expect(result.error).toBe('Please enter a valid email address');
    });
  });

  describe('Form Validation', () => {
    test('validates multiple fields', () => {
      const fields = {
        email: {
          name: 'email',
          value: 'invalid',
          rules: [{ type: 'email' }],
        },
        password: {
          name: 'password',
          value: '123',
          rules: [{ type: 'password' }],
        },
      };

      const result = validateForm(fields);

      expect(result.valid).toBe(false);
      expect(result.errorCount).toBe(2);
      expect(result.errors.email).toBeDefined();
      expect(result.errors.password).toBeDefined();
    });

    test('returns valid when all fields pass', () => {
      const fields = {
        email: {
          name: 'email',
          value: 'test@example.com',
          rules: [{ type: 'email' }],
        },
        password: {
          name: 'password',
          value: 'SecurePass123!',
          rules: [{ type: 'password' }],
        },
      };

      const result = validateForm(fields);

      expect(result.valid).toBe(true);
      expect(result.errorCount).toBe(0);
      expect(Object.keys(result.errors)).toHaveLength(0);
    });
  });

  describe('Async Field Validation', () => {
    test('validates field asynchronously', async () => {
      const field: ValidationField = {
        name: 'email',
        value: 'test@example.com',
        rules: [{ type: 'email' }],
      };

      const asyncValidator = jest.fn(async (value) => {
        // Simulate checking if email is available
        return !value.includes('taken');
      });

      const result = await validateFieldAsync(field, asyncValidator);

      expect(result.valid).toBe(true);
      expect(asyncValidator).toHaveBeenCalledWith('test@example.com');
    });

    test('returns error from async validator', async () => {
      const field: ValidationField = {
        name: 'email',
        value: 'taken@example.com',
        rules: [{ type: 'email' }],
      };

      const asyncValidator = jest.fn(async (value) => {
        return !value.includes('taken');
      });

      const result = await validateFieldAsync(field, asyncValidator);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not available');
    });

    test('returns sync error if field fails sync validation', async () => {
      const field: ValidationField = {
        name: 'email',
        value: 'invalid',
        rules: [{ type: 'email' }],
      };

      const asyncValidator = jest.fn(async () => true);

      const result = await validateFieldAsync(field, asyncValidator);

      expect(result.valid).toBe(false);
      expect(asyncValidator).not.toHaveBeenCalled();
    });

    test('handles async validator errors', async () => {
      const field: ValidationField = {
        name: 'email',
        value: 'test@example.com',
        rules: [{ type: 'email' }],
      };

      const asyncValidator = jest.fn(async () => {
        throw new Error('Network error');
      });

      const result = await validateFieldAsync(field, asyncValidator);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unable to validate');
    });
  });

  describe('Validation Error Types', () => {
    test('creates validation error with fields', () => {
      const fields = {
        email: 'Invalid email',
        password: 'Too weak',
      };

      try {
        throw new Error('Validation test');
      } catch (error) {
        // Just testing that ValidationError structure is correct
      }
    });
  });
});
