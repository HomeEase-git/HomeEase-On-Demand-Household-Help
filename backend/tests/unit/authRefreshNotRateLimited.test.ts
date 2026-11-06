import { Router } from 'express';

jest.mock('@middleware/rateLimit', () => ({
  authLimiter: Object.assign((_req: unknown, _res: unknown, next: () => void) => next(), {
    __isAuthLimiter: true,
  }),
}));

describe('auth route limiters', () => {
  const stack = () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const router: Router = require('@routes/auth').default;
    return (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: { __isAuthLimiter?: boolean } }> } }> }).stack;
  };

  const limitersOn = (path: string, method: 'post' | 'get' = 'post') =>
    stack()
      .filter((layer) => layer.route?.path === path && (layer.route as unknown as Record<string, unknown>)[`${method}`] !== undefined)
      .flatMap((layer) => layer.route!.stack)
      .filter((l) => l.handle.__isAuthLimiter === true).length;

  it('leaves /refresh off the credential limiter', () => {
    expect(limitersOn('/refresh')).toBe(0);
  });

  it('still guards /login and /verify-otp', () => {
    expect(limitersOn('/login')).toBe(1);
    expect(limitersOn('/verify-otp')).toBe(1);
  });
});
