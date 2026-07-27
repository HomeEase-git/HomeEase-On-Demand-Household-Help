import * as validators from '../validators';

describe('Validators', () => {
  describe('Email Validation', () => {
    it('should validate correct email addresses', () => {
      expect(validators.isValidEmail('test@example.com')).toBe(true);
      expect(validators.isValidEmail('user.name@domain.co.uk')).toBe(true);
      expect(validators.isValidEmail('test+tag@example.org')).toBe(true);
    });

    it('should reject invalid email addresses', () => {
      expect(validators.isValidEmail('invalid.email')).toBe(false);
      expect(validators.isValidEmail('test@.com')).toBe(false);
      expect(validators.isValidEmail('@example.com')).toBe(false);
      expect(validators.isValidEmail('')).toBe(false);
    });

    it('validateEmail should return error for empty email', () => {
      const result = validators.validateEmail('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });

    it('validateEmail should return error for invalid format', () => {
      const result = validators.validateEmail('not-an-email');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid');
    });

    it('validateEmail should trim whitespace', () => {
      const result = validators.validateEmail('  test@example.com  ');
      expect(result.valid).toBe(true);
    });
  });

  describe('Password Validation', () => {
    it('should validate strong passwords', () => {
      expect(validators.isValidPassword('Test1234')).toBe(true);
      expect(validators.isValidPassword('MyPassword123')).toBe(true);
      expect(validators.isValidPassword('SecurePass99')).toBe(true);
    });

    it('should reject weak passwords', () => {
      expect(validators.isValidPassword('short1')).toBe(false); // Too short
      expect(validators.isValidPassword('nouppercase123')).toBe(false); // No uppercase
      expect(validators.isValidPassword('NODIGITS')).toBe(false); // No digits
      expect(validators.isValidPassword('password')).toBe(false); // No uppercase or digits
    });

    it('validatePassword should provide detailed requirements', () => {
      const result = validators.validatePassword('weak');
      expect(result.valid).toBe(false);
      expect(result.requirements).toBeDefined();
      expect(result.requirements?.minLength).toBe(false);
      expect(result.error).toContain('must have');
    });

    it('validatePassword should show which requirements are missing', () => {
      const result = validators.validatePassword('NoDigits');
      expect(result.valid).toBe(false);
      expect(result.requirements?.minLength).toBe(true);
      expect(result.requirements?.hasUppercase).toBe(true);
      expect(result.requirements?.hasNumber).toBe(false);
    });

    it('validatePassword should accept valid password', () => {
      const result = validators.validatePassword('Test1234');
      expect(result.valid).toBe(true);
    });
  });

  describe('Name Validation', () => {
    it('should validate normal names', () => {
      expect(validators.validateName('John Doe').valid).toBe(true);
      expect(validators.validateName('Juan García').valid).toBe(true);
      expect(validators.validateName('李明').valid).toBe(true);
    });

    it('should reject empty names', () => {
      const result = validators.validateName('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should reject names that are too short', () => {
      const result = validators.validateName('A');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('at least 2');
    });

    it('should trim whitespace', () => {
      const result = validators.validateName('  John Doe  ');
      expect(result.valid).toBe(true);
    });
  });

  describe('Phone Validation', () => {
    it('should validate phone numbers with valid lengths', () => {
      expect(validators.validatePhone('1234567890').valid).toBe(true);
      expect(validators.validatePhone('555-123-4567').valid).toBe(true);
      expect(validators.validatePhone('(555) 123-4567').valid).toBe(true);
      expect(validators.validatePhone('+1 555 123 4567').valid).toBe(true);
    });

    it('should reject phone numbers that are too short', () => {
      const result = validators.validatePhone('12345');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('at least 10');
    });

    it('should reject empty phone numbers', () => {
      const result = validators.validatePhone('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should handle phone numbers with special characters', () => {
      const result = validators.validatePhone('+1-800-FLOWERS');
      expect(result.valid).toBe(true);
    });
  });

  describe('OTP Validation', () => {
    it('should validate correct 6-digit OTPs', () => {
      expect(validators.validateOTP('123456').valid).toBe(true);
      expect(validators.validateOTP('000000').valid).toBe(true);
      expect(validators.validateOTP('999999').valid).toBe(true);
    });

    it('should reject OTPs with wrong length', () => {
      expect(validators.validateOTP('12345').valid).toBe(false); // 5 digits
      expect(validators.validateOTP('1234567').valid).toBe(false); // 7 digits
    });

    it('should reject empty OTP', () => {
      const result = validators.validateOTP('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should handle OTP with spaces', () => {
      expect(validators.validateOTP('123 456').valid).toBe(true);
    });
  });

  describe('Password Match Validation', () => {
    it('should validate matching passwords', () => {
      const result = validators.validatePasswordMatch('Test1234', 'Test1234');
      expect(result.valid).toBe(true);
    });

    it('should reject non-matching passwords', () => {
      const result = validators.validatePasswordMatch('Test1234', 'Different1');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('do not match');
    });

    it('should reject when confirm password is empty', () => {
      const result = validators.validatePasswordMatch('Test1234', '');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('confirm');
    });
  });
});
