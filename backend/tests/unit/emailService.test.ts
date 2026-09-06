import type * as EmailService from '@utils/emailService';

const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn(() => ({ sendMail: mockSendMail }));

jest.mock('nodemailer', () => ({
  createTransport: mockCreateTransport,
}));

// emailService.ts reads SMTP_USER/SMTP_PASS/SMTP_FROM_NAME into module-level
// consts at import time and caches its transporter in a module-level
// variable, so each test needs a fresh module instance (via
// jest.isolateModules) to see a given env combination and to reliably
// assert on transporter-creation call counts.
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
  SMTP_USER: 'noreply@homeease.test',
  SMTP_PASS: 'app-password',
  SMTP_FROM_NAME: 'HomeEase',
};

describe('emailService', () => {
  beforeEach(() => {
    mockSendMail.mockReset();
    mockCreateTransport.mockClear();
  });

  it('sends an OTP email over Gmail SMTP with the code embedded', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: 'abc' });
    const { sendOtpEmail } = loadEmailService(TEST_ENV);

    await sendOtpEmail('client@example.com', '123456');

    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: 'noreply@homeease.test', pass: 'app-password' },
    });
    const [sentMessage] = mockSendMail.mock.calls[0];
    expect(sentMessage.from).toBe('HomeEase <noreply@homeease.test>');
    expect(sentMessage.to).toBe('client@example.com');
    expect(sentMessage.subject).toBe('Your HomeEase Verification Code');
    expect(sentMessage.html).toContain('123456');
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
    const { sendOtpEmail } = loadEmailService({ SMTP_USER: undefined, SMTP_PASS: undefined });

    await expect(sendOtpEmail('client@example.com', '123456')).rejects.toThrow(
      'Failed to send OTP email: SMTP_USER and SMTP_PASS must be set to send email'
    );
    expect(mockCreateTransport).not.toHaveBeenCalled();
  });
});
