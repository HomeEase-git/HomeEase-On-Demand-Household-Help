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

// Password validation
export function isValidPassword(password: string): boolean {
  return (
    password.length >= 8 &&
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
    minLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasNumber: /\d/.test(password),
  };

  const valid = Object.values(requirements).every((v) => v);

  if (!valid) {
    const missing = [];
    if (!requirements.minLength) missing.push('at least 8 characters');
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
