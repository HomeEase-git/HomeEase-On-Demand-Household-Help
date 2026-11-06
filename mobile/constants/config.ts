export const config = {
  API_URL:
    process.env.EXPO_PUBLIC_API_URL ??
    (__DEV__ ? 'http://10.0.2.2:3000' : 'https://homeease-on-demand-household-help.onrender.com'),
  API_TIMEOUT_MS: 60000,

  // ===== APP VERSION =====
  APP_VERSION: '1.0.0',

  // ===== PAGINATION =====
  PAGINATION: {
    pageSize: 20, // Default number of items per page for list views
  },

  // ===== PAYMENT CONFIGURATION =====
  PAYMENTS: {
    methods: ['cash', 'gcash', 'maya', 'bank'] as const,
  },

  FEATURES: {
    paymentsEnabled: true,    // Enable payment processing
    reviewsEnabled: true,     // Enable review/rating system
    messagingEnabled: true,   // Enable in-app messaging
  },
} as const;

export type Config = typeof config;
