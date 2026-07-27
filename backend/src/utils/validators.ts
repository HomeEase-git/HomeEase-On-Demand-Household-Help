export const validateEmail = (email: string): boolean => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};

export const validatePassword = (password: string): boolean => {
  // Min 8 chars, 1 uppercase, 1 number
  return /^(?=.*[A-Z])(?=.*\d).{8,}$/.test(password);
};

export const validatePhone = (phone: string): boolean => {
  return /^\d{10,}$/.test(phone.replace(/\D/g, ''));
};

export const validateOtp = (otp: string): boolean => {
  return /^\d{6}$/.test(otp);
};