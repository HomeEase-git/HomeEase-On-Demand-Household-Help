/**
 * Application Configuration - Runtime settings, API endpoints, and feature flags
 */
export const config = {
  // ===== API CONFIGURATION =====
  // API_URL: process.env.EXPO_PUBLIC_API_URL ?? 'https://api.homeease.com',
  API_URL: process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000', // Localhost for Android emulator
  API_TIMEOUT_MS: 8000,

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

  // ===== FEATURE FLAGS =====
  // Toggle features on/off without app deployment
  FEATURES: {
    paymentsEnabled: true,    // Enable payment processing
    reviewsEnabled: true,     // Enable review/rating system
    messagingEnabled: true,   // Enable in-app messaging
  },
} as const;

export type Config = typeof config;
