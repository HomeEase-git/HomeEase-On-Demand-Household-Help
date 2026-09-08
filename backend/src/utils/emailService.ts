import dns from 'node:dns';
import net from 'node:net';
import nodemailer, { Transporter } from 'nodemailer';

// Pluggable email transport. EMAIL_PROVIDER selects one of:
//   - "smtp"      (default) nodemailer over SMTP. Host/port/secure are env-
//                 configurable so 465 vs 587 can be tried without a code change.
//   - "gmail-api" Gmail REST API over HTTPS (port 443) using an OAuth2 refresh
//                 token — sends genuinely from the Gmail account, no SMTP port.
//   - "brevo"     Brevo (Sendinblue) HTTP API — send from a "single sender"
//                 verified address (a plain Gmail address is allowed).
// All three send FROM the same identity: `${EMAIL_FROM_NAME} <${EMAIL_FROM_ADDRESS}>`
// (falling back to the legacy SMTP_* / provider-specific sender vars).
//
// All config is read once at module load (consts below) — env is static after
// boot, and the unit tests drive config via jest.isolateModules import-time env.

const PROVIDER = (process.env.EMAIL_PROVIDER || 'smtp').toLowerCase();

const FROM_NAME = process.env.EMAIL_FROM_NAME || process.env.SMTP_FROM_NAME || 'HomeEase';
const FROM_ADDRESS =
  process.env.EMAIL_FROM_ADDRESS ||
  process.env.SMTP_USER ||
  process.env.GMAIL_SENDER ||
  process.env.BREVO_SENDER_EMAIL ||
  '';
const FROM = FROM_ADDRESS ? `${FROM_NAME} <${FROM_ADDRESS}>` : FROM_NAME;

// SMTP
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 465;
const SMTP_SECURE = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : SMTP_PORT === 465;
// Force IPv4 by default. nodemailer 10 resolves BOTH A and AAAA records and
// then picks one at random (shared/index.js formatDNSValue) — it does not
// honour a `family` option — so on the Render host (which has an IPv6
// interface but no IPv6 route) roughly half its connections die with
// ENETUNREACH. When SMTP_FAMILY=4 we resolve the host to an A record
// ourselves and hand nodemailer the IPv4 literal (+ TLS servername), which
// short-circuits its resolver entirely. SMTP_FAMILY=0 restores "let
// nodemailer resolve", 6 forces its IPv6 path.
const SMTP_FAMILY = process.env.SMTP_FAMILY !== undefined ? Number(process.env.SMTP_FAMILY) : 4;
// Fail fast on a blocked port / unreachable host instead of hanging ~2 min on
// nodemailer's default connectionTimeout (which was blocking the whole signup
// response on Render).
const SMTP_TIMEOUTS = { connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 20_000 };

// Gmail API
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;

// Brevo
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || FROM_ADDRESS;
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || FROM_NAME;

const HTTP_TIMEOUT_MS = 15_000;

export const getEmailProviderName = (): string => PROVIDER;

// Snapshot of the effective transport config, for POST /internal/diag/email-test.
export const getEmailDiagInfo = async (): Promise<Record<string, unknown>> => {
  const info: Record<string, unknown> = { provider: PROVIDER, from: FROM };
  if (PROVIDER === 'smtp') {
    let connectHost: string = SMTP_HOST;
    let servername: string | undefined;
    let resolveError: string | undefined;
    try {
      ({ host: connectHost, servername } = await resolveSmtpTarget());
    } catch (err) {
      resolveError = (err as Error).message;
    }
    info.smtp = {
      configuredHost: SMTP_HOST,
      connectHost,
      servername: servername ?? null,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      family: SMTP_FAMILY,
      ...(resolveError ? { resolveError } : {}),
    };
  }
  return info;
};

// ---------------------------------------------------------------------------
// Transports — each returns a provider messageId string (or undefined) and
// throws with a clear message on misconfiguration or send failure.
// ---------------------------------------------------------------------------

// Resolve SMTP_HOST to an IPv4 literal when SMTP_FAMILY=4, so nodemailer's
// own (randomising) resolver never gets a chance to pick an AAAA record.
export const resolveSmtpTarget = async (): Promise<{ host: string; servername?: string }> => {
  if (SMTP_FAMILY === 4 && SMTP_HOST && net.isIP(SMTP_HOST) === 0) {
    const addrs = await dns.promises.resolve4(SMTP_HOST);
    if (addrs.length) {
      return { host: addrs[0], servername: SMTP_HOST };
    }
  }
  return { host: SMTP_HOST };
};

let transporterPromise: Promise<Transporter> | null = null;

const buildTransporter = async (): Promise<Transporter> => {
  if (!SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP_USER and SMTP_PASS must be set for EMAIL_PROVIDER=smtp');
  }
  const { host, servername } = await resolveSmtpTarget();
  return nodemailer.createTransport({
    host,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    requireTLS: !SMTP_SECURE,
    ...(servername ? { servername, tls: { servername } } : {}),
    ...(SMTP_FAMILY ? { family: SMTP_FAMILY } : {}),
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    ...SMTP_TIMEOUTS,
  });
};

const getTransporter = (): Promise<Transporter> => {
  if (!transporterPromise) {
    transporterPromise = buildTransporter().catch((err) => {
      transporterPromise = null; // let the next send retry the DNS resolve
      throw err;
    });
  }
  return transporterPromise;
};

const sendViaSmtp = async (to: string, subject: string, html: string): Promise<string | undefined> => {
  const info = await (await getTransporter()).sendMail({ from: FROM, to, subject, html });
  return info.messageId;
};

const base64Url = (input: string): string =>
  Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let gmailAccessToken: { value: string; expiresAt: number } | null = null;

const getGmailAccessToken = async (): Promise<string> => {
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    throw new Error('GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN must be set for EMAIL_PROVIDER=gmail-api');
  }
  if (gmailAccessToken && gmailAccessToken.expiresAt > Date.now() + 60_000) {
    return gmailAccessToken.value;
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(`Gmail token refresh failed (${res.status}): ${data.error_description || data.error || 'no access_token'}`);
  }
  gmailAccessToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return gmailAccessToken.value;
};

const sendViaGmailApi = async (to: string, subject: string, html: string): Promise<string | undefined> => {
  const accessToken = await getGmailAccessToken();
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
  const mime = [
    `From: ${FROM}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html, 'utf8').toString('base64'),
  ].join('\r\n');
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: base64Url(mime) }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok) {
    throw new Error(`Gmail API send failed (${res.status}): ${data.error?.message || 'unknown error'}`);
  }
  return data.id;
};

const sendViaBrevo = async (to: string, subject: string, html: string): Promise<string | undefined> => {
  if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL) {
    throw new Error('BREVO_API_KEY and BREVO_SENDER_EMAIL must be set for EMAIL_PROVIDER=brevo');
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as { messageId?: string; message?: string; code?: string };
  if (!res.ok) {
    throw new Error(`Brevo send failed (${res.status}): ${data.message || data.code || 'unknown error'}`);
  }
  return data.messageId;
};

// ---------------------------------------------------------------------------

const send = async (to: string, subject: string, html: string, label: string): Promise<string | undefined> => {
  try {
    let messageId: string | undefined;
    if (PROVIDER === 'gmail-api') {
      messageId = await sendViaGmailApi(to, subject, html);
    } else if (PROVIDER === 'brevo') {
      messageId = await sendViaBrevo(to, subject, html);
    } else {
      messageId = await sendViaSmtp(to, subject, html);
    }
    console.log(`[Email] ${label} sent via ${PROVIDER}:`, messageId);
    return messageId;
  } catch (err) {
    console.error(`[Email] Failed to send ${label} via ${PROVIDER}:`, err);
    throw new Error(`Failed to send ${label}: ${(err as Error).message}`);
  }
};

// Diagnostic — used by POST /internal/diag/email-test to exercise the active
// transport without creating a signup. Not a user-facing template.
export const sendTestEmail = async (to: string): Promise<{ provider: string; messageId?: string }> => {
  const messageId = await send(
    to,
    'HomeEase email transport test',
    `<div style="font-family: Arial, sans-serif;">
       <p>This is a HomeEase email-transport diagnostic.</p>
       <p>Provider: <strong>${PROVIDER}</strong><br/>From: <strong>${FROM}</strong><br/>Sent: ${new Date().toISOString()}</p>
     </div>`,
    'transport test',
  );
  return { provider: PROVIDER, messageId };
};

export const sendOtpEmail = async (email: string, otp: string): Promise<void> => {
  await send(
    email,
    'Your HomeEase Verification Code',
    `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4169E1;">HomeEase Email Verification</h2>
        <p>Your verification code is:</p>
        <h1 style="font-size: 48px; letter-spacing: 8px; color: #FB8B23;">${otp}</h1>
        <p>This code expires in <strong>10 minutes</strong>.</p>
        <p>If you did not request this, please ignore this email.</p>
      </div>
    `,
    'OTP email',
  );
};

export const sendPasswordResetEmail = async (email: string, otp: string): Promise<void> => {
  await send(
    email,
    'Reset Your HomeEase Password',
    `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4169E1;">Password Reset Request</h2>
        <p>You requested to reset your HomeEase password. Enter this code in the app to continue:</p>
        <h1 style="font-size: 48px; letter-spacing: 8px; color: #FB8B23;">${otp}</h1>
        <p>This code expires in <strong>10 minutes</strong>.</p>
        <p>If you did not request a password reset, please ignore this email.</p>
      </div>
    `,
    'password reset email',
  );
};

export const sendWelcomeEmail = async (email: string, fullName: string): Promise<void> => {
  await send(
    email,
    'Welcome to HomeEase',
    `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4169E1;">Welcome to HomeEase, ${fullName}!</h2>
        <p>Your account has been successfully verified. You can now access all HomeEase features.</p>
        <p>Thank you for joining us.</p>
      </div>
    `,
    'welcome email',
  );
};
