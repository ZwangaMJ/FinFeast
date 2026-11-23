// Input checks and user-facing wording for the sign-in and account screens.
// Kept free of React Native imports so it runs under node:test.

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

// A failed input check, raised by unwrap(). Its message is already user-facing.
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function unwrap<T>(checked: Checked<T>): T {
  if (!checked.ok) throw new ValidationError(checked.error);
  return checked.value;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function checkEmail(raw: string): Checked<string> {
  const value = raw.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(value)) return { ok: false, error: 'Enter a valid email address.' };
  return { ok: true, value };
}

export const MIN_PASSWORD_LENGTH = 8;

export function checkNewPassword(password: string): Checked<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Use a password with at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  return { ok: true, value: password };
}

// Supabase sends 6-digit codes by default; projects can raise the length to 10.
export function checkCode(raw: string): Checked<string> {
  const value = raw.replace(/\s+/g, '');
  if (!/^\d{6,10}$/.test(value)) return { ok: false, error: 'Enter the 6-digit code from your email.' };
  return { ok: true, value };
}

// Supabase auth error codes: https://supabase.com/docs/guides/auth/debugging/error-codes
const MESSAGES_BY_CODE: Record<string, string> = {
  invalid_credentials: 'Email or password is incorrect.',
  email_not_confirmed: 'Confirm your email first. We sent you a code.',
  otp_expired: 'That code is wrong or has expired. Request a new one.',
  over_email_send_rate_limit: 'Too many emails sent. Wait a minute, then try again.',
  over_request_rate_limit: 'Too many attempts. Wait a minute, then try again.',
  user_already_exists: 'An account with this email already exists. Sign in instead.',
  email_exists: 'An account with this email already exists. Sign in instead.',
  weak_password: `Choose a stronger password with at least ${MIN_PASSWORD_LENGTH} characters.`,
  same_password: 'Your new password must be different from your current one.',
  email_address_invalid: 'Enter a valid email address.',
};

const NETWORK_MESSAGES = ['failed to fetch', 'network request failed', 'load failed'];

export function authErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Something went wrong. Please try again.';
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && MESSAGES_BY_CODE[code]) return MESSAGES_BY_CODE[code];
  if (NETWORK_MESSAGES.includes(error.message.toLowerCase())) {
    return 'Could not reach FinFeast. Check your connection and try again.';
  }
  return error.message || 'Something went wrong. Please try again.';
}
