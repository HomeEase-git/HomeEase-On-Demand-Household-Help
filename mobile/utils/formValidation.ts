/**
 * Enhanced Form Validation Error Handling
 * 
 * Comprehensive form validation with error management
 */

import { useState, useCallback } from 'react';
import { ValidationError } from './errorHandling';
import * as validators from './validators';

export interface ValidationField {
  name: string;
  value: any;
  rules: ValidationRule[];
}

export interface ValidationRule {
  type: string;
  params?: any;
  message?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
  errorCount: number;
}

/**
 * Field-level validation
 */
function validateFieldModule(field: ValidationField): { valid: boolean; error?: string } {
  const { value, rules } = field;

  for (const rule of rules) {
    let isValid = false;
    let error = rule.message;

    switch (rule.type) {
      case 'required':
        isValid = value !== '' && value !== null && value !== undefined;
        error = error || 'This field is required';
        break;

      case 'email':
        isValid = !value || validators.isValidEmail(value);
        error = error || 'Invalid email address';
        break;

      case 'password':
        isValid = !value || validators.isValidPassword(value);
        error = error || 'Password does not meet requirements';
        break;

      case 'minLength':
        isValid = !value || value.length >= rule.params?.min;
        error = error || `Must be at least ${rule.params?.min} characters`;
        break;

      case 'maxLength':
        isValid = !value || value.length <= rule.params?.max;
        error = error || `Must not exceed ${rule.params?.max} characters`;
        break;

      case 'pattern':
        isValid = !value || rule.params?.pattern.test(value);
        error = error || 'Invalid format';
        break;

      case 'match':
        isValid = value === rule.params?.value;
        error = error || 'Fields do not match';
        break;

      case 'phone':
        isValid = !value || validators.validatePhone(value).valid;
        error = error || 'Invalid phone number';
        break;

      case 'custom':
        isValid = rule.params?.validate(value);
        error = error || 'Invalid value';
        break;

      default:
        isValid = true;
    }

    if (!isValid) {
      return { valid: false, error };
    }
  }

  return { valid: true };
}

/**
 * Export the field validation function
 */
export function validateField(field: ValidationField): { valid: boolean; error?: string } {
  return validateFieldModule(field);
}

/**
 * Form-level validation
 */
export function validateForm(
  fields: Record<string, ValidationField>
): ValidationResult {
  const errors: Record<string, string> = {};

  for (const [fieldName, field] of Object.entries(fields)) {
    const result = validateField(field);
    if (!result.valid && result.error) {
      errors[fieldName] = result.error;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    errorCount: Object.keys(errors).length,
  };
}

/**
 * Async field validation (for checking availability, etc.)
 */
export async function validateFieldAsync(
  field: ValidationField,
  asyncValidator: (value: any) => Promise<boolean>
): Promise<{ valid: boolean; error?: string }> {
  // First run sync validation
  const syncResult = validateField(field);
  if (!syncResult.valid) {
    return syncResult;
  }

  // Then run async validation if sync passed
  if (field.value) {
    try {
      const isValid = await asyncValidator(field.value);
      if (!isValid) {
        return {
          valid: false,
          error: 'This value is not available',
        };
      }
    } catch {
      return {
        valid: false,
        error: 'Unable to validate this field',
      };
    }
  }

  return { valid: true };
}

/**
 * Real-time validation hook
 */
export function useFormValidation(
  initialValues: Record<string, any>,
  initialRules: Record<string, ValidationRule[]>
) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [validating, setValidating] = useState<Record<string, boolean>>({});

  const rules = useCallback(
    (fieldName: string): ValidationRule[] => {
      return initialRules[fieldName] || [];
    },
    [initialRules]
  );

  const validateField = useCallback(
    (fieldName: string, value: any): { valid: boolean; error?: string } => {
      const fieldRules = rules(fieldName);
      const fieldData: ValidationField = {
        name: fieldName,
        value,
        rules: fieldRules,
      };
      
      // Call the module-level validateField function
      const result = validateFieldModule(fieldData);
      return result;
    },
    [rules]
  );

  const handleChange = useCallback(
    (fieldName: string, value: any) => {
      setValues((prev) => ({
        ...prev,
        [fieldName]: value,
      }));

      // Validate on change if field was touched
      if (touched[fieldName]) {
        const result = validateField(fieldName, value);
        setErrors((prev) => {
          const newErrors = { ...prev };
          if (result.valid) {
            delete newErrors[fieldName];
          } else {
            newErrors[fieldName] = result.error || 'Invalid value';
          }
          return newErrors;
        });
      }
    },
    [touched, validateField]
  );

  const handleBlur = useCallback(
    (fieldName: string) => {
      setTouched((prev) => ({
        ...prev,
        [fieldName]: true,
      }));

      // Validate on blur
      const result = validateField(fieldName, values[fieldName]);
      setErrors((prev) => {
        const newErrors = { ...prev };
        if (result.valid) {
          delete newErrors[fieldName];
        } else {
          newErrors[fieldName] = result.error || 'Invalid value';
        }
        return newErrors;
      });
    },
    [validateField, values]
  );

  const resetForm = useCallback(() => {
    setValues(initialValues);
    setErrors({});
    setTouched({});
    setValidating({});
  }, [initialValues]);

  const validateAll = useCallback(() => {
    const allErrors: Record<string, string> = {};

    for (const [fieldName, value] of Object.entries(values)) {
      const result = validateField(fieldName, value);
      if (!result.valid && result.error) {
        allErrors[fieldName] = result.error;
      }
    }

    setErrors(allErrors);
    setTouched(
      Object.keys(values).reduce((acc, fieldName) => {
        acc[fieldName] = true;
        return acc;
      }, {} as Record<string, boolean>)
    );

    return Object.keys(allErrors).length === 0;
  }, [values, validateField]);

  const getFieldProps = useCallback(
    (fieldName: string) => ({
      value: values[fieldName] ?? '',
      onChangeText: (value: string) => handleChange(fieldName, value),
      onBlur: () => handleBlur(fieldName),
      error: touched[fieldName] ? errors[fieldName] : undefined,
      isValidating: validating[fieldName] ?? false,
    }),
    [values, errors, touched, validating, handleChange, handleBlur]
  );

  return {
    values,
    setValues,
    errors,
    touched,
    validating,
    handleChange,
    handleBlur,
    validateAll,
    resetForm,
    getFieldProps,
    isValid: Object.keys(errors).length === 0,
  };
}

/**
 * Helper to throw validation errors
 */
export function throwValidationError(
  fields: Record<string, string>
): never {
  throw new ValidationError('Form validation failed', fields);
}

/**
 * Helper to format validation errors for display
 */
export function formatValidationErrors(errors: Record<string, string>): string[] {
  return Object.values(errors);
}
