import { redactString, redactValue } from '@utils/logRedaction';

describe('log redaction', () => {
  it('masks values under sensitive keys, at any depth', () => {
    const out = redactValue({
      email: 'a@b.c',
      password: 'Hunter2Hunter2',
      body: { refreshToken: 'abc', newPassword: 'x', otp: '123456', tin: '123-456-789', payoutAccountNumber: '0917' },
      headers: { authorization: 'Bearer x', 'x-callback-token': 't', cookie: 'c' },
      error: { code: 'P2002' },
    }) as any;
    expect(out.email).toBe('a@b.c');
    expect(out.password).toBe('[REDACTED]');
    expect(out.body).toEqual({
      refreshToken: '[REDACTED]',
      newPassword: '[REDACTED]',
      otp: '[REDACTED]',
      tin: '[REDACTED]',
      payoutAccountNumber: '[REDACTED]',
    });
    expect(out.headers).toEqual({ authorization: '[REDACTED]', 'x-callback-token': '[REDACTED]', cookie: '[REDACTED]' });
    expect(out.error.code).toBe('P2002'); // error codes stay readable
  });

  it('scrubs credential shapes out of free text', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiIxMjMifQ.abcdefghijk';
    const text = redactString(
      [
        `token ${jwt}`,
        'Authorization: Bearer abc.def-ghi',
        'postgresql://homeease:s3cr3tPass@ep-x.neon.tech/db',
        'key xnd_production_AbC123dEf',
        'enc:v1:0a1b:2c3d:4e5f',
        `refresh ${'a1'.repeat(40)}`,
      ].join(' | '),
    );
    expect(text).not.toContain(jwt);
    expect(text).not.toContain('abc.def-ghi');
    expect(text).not.toContain('s3cr3tPass');
    expect(text).toContain('postgresql://homeease:[REDACTED]@ep-x.neon.tech/db');
    expect(text).not.toContain('xnd_production_AbC123dEf');
    expect(text).not.toContain('enc:v1:');
    expect(text).not.toContain('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1');
  });

  it('flattens errors and survives circular or deep objects', () => {
    const err = Object.assign(new Error('connect to postgres://u:pw123456@h/db failed'), { code: 'ECONNREFUSED' });
    const circular: any = { name: 'loop' };
    circular.self = circular;
    const out = redactValue({ err, circular }) as any;
    expect(out.err.message).toBe('connect to postgres://u:[REDACTED]@h/db failed');
    expect(out.err.code).toBe('ECONNREFUSED');
    expect(out.err.stack).toContain('Error:');
    expect(out.circular.self).toBe('[Circular]');
  });
});

describe('structured console', () => {
  it('writes one redacted JSON line per call, tagged with the request id', () => {
    const originals = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
    const lines: string[] = [];
    const out = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => (lines.push(String(chunk)), true));
    const err = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => (lines.push(String(chunk)), true));
    try {
      jest.isolateModules(() => {
        /* eslint-disable @typescript-eslint/no-require-imports */
        const { installStructuredConsole } = require('../../src/utils/structuredConsole');
        const { requestContext } = require('../../src/utils/requestContext');
        /* eslint-enable @typescript-eslint/no-require-imports */
        installStructuredConsole();
        const req: any = { headers: { 'x-request-id': 'req-abc-12345' }, ip: '1.2.3.4', path: '/x', originalUrl: '/x' };
        const res: any = { setHeader: jest.fn(), on: jest.fn() };
        requestContext(req, res, () => {
          console.log('saved', { password: 'nope', ok: 1 });
          console.error('failed', new Error('Bearer secret-token-value'));
        });
      });
    } finally {
      out.mockRestore();
      err.mockRestore();
      Object.assign(console, originals);
    }

    const [info, error] = lines.map((line) => JSON.parse(line));
    expect(info).toMatchObject({ level: 'info', msg: 'saved', requestId: 'req-abc-12345', data: { password: '[REDACTED]', ok: 1 } });
    expect(error.level).toBe('error');
    expect(error.requestId).toBe('req-abc-12345');
    expect(JSON.stringify(error)).not.toContain('secret-token-value');
  });
});
