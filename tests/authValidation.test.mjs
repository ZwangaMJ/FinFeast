import assert from 'node:assert/strict';
import test from 'node:test';

import { authErrorMessage, checkCode, checkEmail, checkNewPassword, unwrap, ValidationError } from '../src/lib/auth/validation.ts';

test('email is trimmed and lower-cased before use', () => {
  assert.deepEqual(checkEmail('  Thandi@Example.CO.ZA '), { ok: true, value: 'thandi@example.co.za' });
});

test('an email without a domain is rejected', () => {
  assert.deepEqual(checkEmail('thandi@'), { ok: false, error: 'Enter a valid email address.' });
});

test('a new password needs at least 8 characters', () => {
  assert.deepEqual(checkNewPassword('short1'), { ok: false, error: 'Use a password with at least 8 characters.' });
  assert.deepEqual(checkNewPassword('long enough'), { ok: true, value: 'long enough' });
});

test('an emailed code accepts spaces but only 6 to 10 digits', () => {
  assert.deepEqual(checkCode(' 123 456 '), { ok: true, value: '123456' });
  assert.deepEqual(checkCode('12345'), { ok: false, error: 'Enter the 6-digit code from your email.' });
  assert.deepEqual(checkCode('12a456'), { ok: false, error: 'Enter the 6-digit code from your email.' });
});

test('Supabase auth errors are reworded by their error code', () => {
  const supabaseError = (code, message = 'raw supabase text') => Object.assign(new Error(message), { code });
  assert.equal(authErrorMessage(supabaseError('invalid_credentials')), 'Email or password is incorrect.');
  assert.equal(authErrorMessage(supabaseError('otp_expired')), 'That code is wrong or has expired. Request a new one.');
  assert.equal(authErrorMessage(supabaseError('over_email_send_rate_limit')), 'Too many emails sent. Wait a minute, then try again.');
  assert.equal(authErrorMessage(supabaseError('user_already_exists')), 'An account with this email already exists. Sign in instead.');
});

test('unknown errors keep their own message, and non-errors get a fallback', () => {
  assert.equal(authErrorMessage(new Error('Supabase request timed out. Please try again.')), 'Supabase request timed out. Please try again.');
  assert.equal(authErrorMessage(new TypeError('Failed to fetch')), 'Could not reach FinFeast. Check your connection and try again.');
  assert.equal(authErrorMessage('nope'), 'Something went wrong. Please try again.');
});

test('unwrap returns a valid value, and a failed check becomes an error with the same wording', () => {
  assert.equal(unwrap(checkEmail(' A@B.CO ')), 'a@b.co');
  assert.throws(() => unwrap(checkEmail('nope')), (error) => {
    assert.ok(error instanceof ValidationError);
    assert.equal(authErrorMessage(error), 'Enter a valid email address.');
    return true;
  });
});
