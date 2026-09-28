// Email validation
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateEmail(email: string): { valid: boolean; error?: string } {
  const trimmed = email.trim();
  if (!trimmed) {
    return { valid: false, error: 'Email is required' };
  }
  if (!isValidEmail(trimmed)) {
    return { valid: false, error: 'Invalid email format' };
  }
  return { valid: true };
}

// Password validation — keep in step with backend/src/utils/passwordPolicy.ts
// (the server also rejects passwords found in known data breaches).
export const PASSWORD_MIN_LENGTH = 10;

export function isValidPassword(password: string): boolean {
  return (
    password.length >= PASSWORD_MIN_LENGTH &&
    /[A-Z]/.test(password) &&
    /\d/.test(password)
  );
}

export function validatePassword(password: string): {
  valid: boolean;
  error?: string;
  requirements?: {
    minLength: boolean;
    hasUppercase: boolean;
    hasNumber: boolean;
  };
} {
  if (!password) {
    return {
      valid: false,
      error: 'Password is required',
      requirements: {
        minLength: false,
        hasUppercase: false,
        hasNumber: false,
      },
    };
  }

  const requirements = {
    minLength: password.length >= PASSWORD_MIN_LENGTH,
    hasUppercase: /[A-Z]/.test(password),
    hasNumber: /\d/.test(password),
  };

  const valid = Object.values(requirements).every((v) => v);

  if (!valid) {
    const missing = [];
    if (!requirements.minLength) missing.push(`at least ${PASSWORD_MIN_LENGTH} characters`);
    if (!requirements.hasUppercase) missing.push('uppercase letter');
    if (!requirements.hasNumber) missing.push('number');
    return {
      valid: false,
      error: `Password must have ${missing.join(', ')}`,
      requirements,
    };
  }

  return { valid: true, requirements };
}

// Name validation
export function validateName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim();
  if (!trimmed) {
    return { valid: false, error: 'Name is required' };
  }
  if (trimmed.length < 2) {
    return { valid: false, error: 'Name must be at least 2 characters' };
  }
  return { valid: true };
}

// Phone validation
export function validatePhone(phone: string): { valid: boolean; error?: string } {
  const digitsOnly = phone
    .toUpperCase()
    .replace(/[A-Z]/g, (letter) => {
      const keypadMap: Record<string, string> = {
        A: '2',
        B: '2',
        C: '2',
        D: '3',
        E: '3',
        F: '3',
        G: '4',
        H: '4',
        I: '4',
        J: '5',
        K: '5',
        L: '5',
        M: '6',
        N: '6',
        O: '6',
        P: '7',
        Q: '7',
        R: '7',
        S: '7',
        T: '8',
        U: '8',
        V: '8',
        W: '9',
        X: '9',
        Y: '9',
        Z: '9',
      };
      return keypadMap[letter];
    })
    .replace(/\D/g, '');
  if (!digitsOnly) {
    return { valid: false, error: 'Phone number is required' };
  }
  if (digitsOnly.length < 10) {
    return { valid: false, error: 'Phone must have at least 10 digits' };
  }
  return { valid: true };
}

// OTP validation
export function validateOTP(otp: string): { valid: boolean; error?: string } {
  const digitsOnly = otp.replace(/\D/g, '');
  if (!digitsOnly) {
    return { valid: false, error: 'OTP is required' };
  }
  if (digitsOnly.length !== 6) {
    return { valid: false, error: 'OTP must be 6 digits' };
  }
  return { valid: true };
}

// Confirm password validation
export function validatePasswordMatch(
  password: string,
  confirmPassword: string
): { valid: boolean; error?: string } {
  if (!confirmPassword) {
    return { valid: false, error: 'Please confirm your password' };
  }
  if (password !== confirmPassword) {
    return { valid: false, error: 'Passwords do not match' };
  }
  return { valid: true };
}

// Workers must be 18-60 (the admin can adjust the range; the backend is the
// authority — this only gives an immediate message instead of a round trip).
export const WORKER_MIN_AGE = 18;
export const WORKER_MAX_AGE = 60;

export function validateWorkerBirthDate(value: string): { valid: boolean; error?: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { valid: false, error: "Use the format YYYY-MM-DD" };
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return { valid: false, error: "That isn't a valid date" };
  }
  const now = new Date();
  let age = now.getUTCFullYear() - date.getUTCFullYear();
  if (
    now.getUTCMonth() < date.getUTCMonth() ||
    (now.getUTCMonth() === date.getUTCMonth() && now.getUTCDate() < date.getUTCDate())
  ) {
    age--;
  }
  if (age > 100) return { valid: false, error: "Please check your date of birth" };
  if (age < WORKER_MIN_AGE || age > WORKER_MAX_AGE) {
    return { valid: false, error: `Workers must be ${WORKER_MIN_AGE} to ${WORKER_MAX_AGE} years old` };
  }
  return { valid: true };
}
