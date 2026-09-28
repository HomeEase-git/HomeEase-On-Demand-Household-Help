export const validateEmail = (email: string): boolean => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};

export const validatePhone = (phone: string): boolean => {
  return /^\d{10,}$/.test(phone.replace(/\D/g, ''));
};

export const validateOtp = (otp: string): boolean => {
  return /^\d{6}$/.test(otp);
};