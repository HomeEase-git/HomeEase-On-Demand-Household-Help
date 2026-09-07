/**
 * Application Configuration - Runtime settings, API endpoints, and feature flags
 */
export const config = {
  // ===== API CONFIGURATION =====
  // API_URL: process.env.EXPO_PUBLIC_API_URL ?? 'https://api.homeease.com',
  API_URL: process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000', // Localhost for Android emulator
  // The production backend (Render free tier) sleeps after ~15min idle and
  // cold-starts a fresh container on the next request. Render's own stated
  // worst case is "50 seconds or more"; a genuinely cold instance (idle long
  // enough that its image wasn't cached anywhere) was observed taking as
  // long as ~200s. 60s comfortably covers Render's stated worst case with
  // margin — going much higher chases an increasingly rare outlier at the
  // cost of every real "cannot connect" (e.g. actually offline) taking that
  // much longer to surface. The real fix for the 200s-outlier case is
  // keeping the server pinged (external uptime monitor) so it never gets
  // that deeply idle in the first place, not an ever-longer client timeout.
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

  // ===== FEATURE FLAGS =====
  // Toggle features on/off without app deployment
  FEATURES: {
    paymentsEnabled: true,    // Enable payment processing
    reviewsEnabled: true,     // Enable review/rating system
    messagingEnabled: true,   // Enable in-app messaging
  },
} as const;

export type Config = typeof config;
