import 'dotenv/config';

// The suite fires many requests at the same endpoints from one loopback IP
// in a short window; the production rate limiters would start returning 429
// and fail unrelated assertions. Turn them off for tests (exercised
// directly by their own unit test if needed).
process.env.RATE_LIMIT_DISABLED = 'true';
// No outbound Have I Been Pwned calls from tests (see utils/passwordPolicy.ts).
process.env.PASSWORD_BREACH_CHECK = 'false';
// Admin fixtures sign in with a password alone; the server-side admin-MFA
// gate (middleware/role.ts) honours this only when NODE_ENV is 'test'.
// tests/mfa.test.ts turns it back on to exercise the gate.
process.env.ADMIN_MFA_ENFORCEMENT = 'off';
