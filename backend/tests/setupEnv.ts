import 'dotenv/config';

// The suite fires many requests at the same endpoints from one loopback IP
// in a short window; the production rate limiters would start returning 429
// and fail unrelated assertions. Turn them off for tests (exercised
// directly by their own unit test if needed).
process.env.RATE_LIMIT_DISABLED = 'true';
