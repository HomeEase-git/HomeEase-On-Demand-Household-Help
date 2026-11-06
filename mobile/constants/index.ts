// Design System
export { colors, type AppColors } from './colors';
export { spacing, type Spacing } from './spacing';
export { fontSizes, fontWeights, type FontSize, type FontWeight } from './typography';
export { cardShadow } from './shadows';

// Configuration
export { config, type Config } from './config';

export const KYC_STEPS = {
  worker: ["ID", "Selfie", "Documents", "Resume", "Contract"],
  client: ["ID", "Selfie", "Contract"],
};
