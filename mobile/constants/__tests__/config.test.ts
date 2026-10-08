// A release bundle built without EXPO_PUBLIC_API_URL must still reach the
// real API, never the emulator address (Android blocks cleartext http).
describe('config.API_URL', () => {
  const originalUrl = process.env.EXPO_PUBLIC_API_URL;
  const originalDev = (globalThis as any).__DEV__;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = originalUrl;
    (globalThis as any).__DEV__ = originalDev;
  });

  const load = (dev: boolean) => {
    (globalThis as any).__DEV__ = dev;
    let url = '';
    jest.isolateModules(() => {
      url = require('../config').config.API_URL;
    });
    return url;
  };

  it('uses the production API in a release bundle with no env var', () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    expect(load(false)).toBe('https://homeease-on-demand-household-help.onrender.com');
  });

  it('keeps the emulator address for dev builds', () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    expect(load(true)).toBe('http://10.0.2.2:3000');
  });

  it('prefers the env var when set', () => {
    process.env.EXPO_PUBLIC_API_URL = 'https://example.test';
    expect(load(false)).toBe('https://example.test');
  });
});
