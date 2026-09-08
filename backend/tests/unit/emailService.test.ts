import type * as EmailService from '@utils/emailService';

const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn(() => ({ sendMail: mockSendMail }));

jest.mock('nodemailer', () => ({
  createTransport: mockCreateTransport,
}));

// emailService.ts reads env into module-level consts at import time and
// caches its SMTP transporter in a module-level variable, so each test needs
// a fresh module instance (via jest.isolateModules) to see a given env
// combination and to reliably assert on transporter-creation call counts.
function loadEmailService(env: Record<string, string | undefined>): typeof EmailService {
  const originalEnv = { ...process.env };
  // Node stringifies assigned process.env values, so `= undefined` would
  // become the literal (truthy) string "undefined" instead of unsetting the
  // var — delete is required to actually simulate a missing credential.
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  let mod!: typeof EmailService;
  jest.isolateModules(() => {
    mod = require('@utils/emailService');
  });

  process.env = originalEnv;
  return mod;
}

const TEST_ENV = {
  EMAIL_PROVIDER: undefined,
  SMTP_USER: 'noreply@homeease.test',
  SMTP_PASS: 'app-password',
  SMTP_FROM_NAME: 'HomeEase',
  SMTP_HOST: undefined,
  SMTP_PORT: undefined,
  SMTP_SECURE: undefined,
  SMTP_FAMILY: undefined,
};

describe('emailService', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    mockSendMail.mockReset();
    mockCreateTransport.mockClear();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends an OTP email over Gmail SMTP with the code embedded', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: 'abc' });
    const { sendOtpEmail } = loadEmailService(TEST_ENV);

    await sendOtpEmail('client@example.com', '123456');

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        family: 4,
        auth: { user: 'noreply@homeease.test', pass: 'app-password' },
      })
    );
    const [sentMessage] = mockSendMail.mock.calls[0];
    expect(sentMessage.from).toBe('HomeEase <noreply@homeease.test>');
    expect(sentMessage.to).toBe('client@example.com');
    expect(sentMessage.subject).toBe('Your HomeEase Verification Code');
    expect(sentMessage.html).toContain('123456');
  });

  it('honours SMTP_PORT / SMTP_SECURE overrides (e.g. 587 STARTTLS)', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: 'abc' });
    const { sendOtpEmail } = loadEmailService({ ...TEST_ENV, SMTP_PORT: '587', SMTP_SECURE: 'false' });

    await sendOtpEmail('client@example.com', '123456');

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: false, requireTLS: true })
    );
  });

  it('omits family when SMTP_FAMILY=0 (let the OS pick)', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: 'abc' });
    const { sendOtpEmail } = loadEmailService({ ...TEST_ENV, SMTP_FAMILY: '0' });

    await sendOtpEmail('client@example.com', '123456');

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.not.objectContaining({ family: expect.anything() })
    );
  });

  it('embeds the reset code in the password reset email', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: 'abc' });
    const { sendPasswordResetEmail } = loadEmailService(TEST_ENV);

    await sendPasswordResetEmail('client@example.com', '654321');

    const [sentMessage] = mockSendMail.mock.calls[0];
    expect(sentMessage.subject).toBe('Reset Your HomeEase Password');
    expect(sentMessage.html).toContain('654321');
  });

  it('includes the recipient name in the welcome email', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: 'abc' });
    const { sendWelcomeEmail } = loadEmailService(TEST_ENV);

    await sendWelcomeEmail('client@example.com', 'Jordan Cruz');

    const [sentMessage] = mockSendMail.mock.calls[0];
    expect(sentMessage.subject).toBe('Welcome to HomeEase');
    expect(sentMessage.html).toContain('Jordan Cruz');
  });

  it('reuses a single cached transporter across multiple sends', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'abc' });
    const { sendOtpEmail, sendWelcomeEmail } = loadEmailService(TEST_ENV);

    await sendOtpEmail('a@example.com', '111111');
    await sendWelcomeEmail('a@example.com', 'Alex');

    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
  });

  it('wraps and rethrows a transport failure with the email label', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('SMTP connection refused'));
    const { sendOtpEmail } = loadEmailService(TEST_ENV);

    await expect(sendOtpEmail('client@example.com', '123456')).rejects.toThrow(
      'Failed to send OTP email: SMTP connection refused'
    );
  });

  it('throws before ever creating a transport when SMTP credentials are missing', async () => {
    const { sendOtpEmail } = loadEmailService({ ...TEST_ENV, SMTP_USER: undefined, SMTP_PASS: undefined });

    await expect(sendOtpEmail('client@example.com', '123456')).rejects.toThrow(
      'Failed to send OTP email: SMTP_USER and SMTP_PASS must be set for EMAIL_PROVIDER=smtp'
    );
    expect(mockCreateTransport).not.toHaveBeenCalled();
  });

  it('dispatches to the Brevo HTTP API when EMAIL_PROVIDER=brevo', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ messageId: '<brevo-1>' }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { sendOtpEmail } = loadEmailService({
      ...TEST_ENV,
      EMAIL_PROVIDER: 'brevo',
      BREVO_API_KEY: 'xkeysib-test',
      BREVO_SENDER_EMAIL: 'noreply@homeease.test',
    });

    await sendOtpEmail('client@example.com', '123456');

    expect(mockCreateTransport).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.brevo.com/v3/smtp/email',
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.to).toEqual([{ email: 'client@example.com' }]);
    expect(body.sender.email).toBe('noreply@homeease.test');
    expect(body.htmlContent).toContain('123456');
  });

  it('dispatches to the Gmail REST API (token refresh + send) when EMAIL_PROVIDER=gmail-api', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'ya29.test', expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'gmail-msg-1' }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { sendOtpEmail } = loadEmailService({
      ...TEST_ENV,
      EMAIL_PROVIDER: 'gmail-api',
      GMAIL_CLIENT_ID: 'cid',
      GMAIL_CLIENT_SECRET: 'csec',
      GMAIL_REFRESH_TOKEN: 'rtok',
    });

    await sendOtpEmail('client@example.com', '123456');

    expect(mockCreateTransport).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
