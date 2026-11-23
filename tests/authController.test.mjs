import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthController } from '../src/lib/auth/authController.ts';
import { appDataWith, harness } from './support/authFakes.mjs';

function setup(options) {
  const parts = harness(options);
  const controller = createAuthController(parts);
  return { ...parts, controller };
}

test('a new user signs up, confirms with the emailed code and is signed in to an empty account', async () => {
  const { controller, auth, repository, sync, app } = setup();
  await controller.start();
  assert.equal(controller.getState().status, 'signedOut');

  const result = await controller.signUp('thandi@example.com', 'correct horse');
  assert.equal(result, 'needsConfirmation');
  assert.equal(controller.getState().status, 'signedOut');

  await controller.confirmSignUp('thandi@example.com', auth.inbox.get('thandi@example.com'));

  const state = controller.getState();
  assert.equal(state.status, 'ready');
  assert.equal(state.email, 'thandi@example.com');
  assert.equal(app.get().profile.email, 'thandi@example.com');
  assert.deepEqual(repository.rows.get(state.userId).profile.email, 'thandi@example.com');
  assert.equal(sync.runningFor, state.userId);
});

test('data already on this device moves into a new, empty account', async () => {
  const deviceData = appDataWith({ profile: { name: 'Thandi' }, goals: ['Emergency fund'] });
  const { controller, auth, repository, deviceCache, app } = setup({ cache: { legacy: deviceData } });
  auth.addUser('thandi@example.com', 'correct horse');
  await controller.start();

  await controller.signIn('thandi@example.com', 'correct horse');

  const { userId } = controller.getState();
  assert.equal(app.get().profile.name, 'Thandi');
  assert.deepEqual(repository.rows.get(userId).goals, ['Emergency fund']);
  assert.equal(deviceCache.legacy, null, 'the pre-account copy should be cleared once it is in the account');
});

test('an account with cloud data keeps it; device data from before accounts is not uploaded over it', async () => {
  const deviceData = appDataWith({ profile: { name: 'Someone else' } });
  const { controller, auth, repository, app, deviceCache } = setup({ cache: { legacy: deviceData } });
  const user = auth.addUser('thandi@example.com', 'correct horse');
  repository.rows.set(user.id, appDataWith({ profile: { name: 'Thandi', email: 'thandi@example.com' }, goals: ['House deposit'] }));
  await controller.start();

  await controller.signIn('thandi@example.com', 'correct horse');

  assert.equal(app.get().profile.name, 'Thandi');
  assert.deepEqual(repository.rows.get(user.id).goals, ['House deposit']);
  assert.equal(deviceCache.legacy, null, 'unused pre-account data must not wait around for the next empty account');
});

test('this account’s own device copy is used when the cloud has nothing yet', async () => {
  const { controller, auth, repository, app, deviceCache } = setup();
  const user = auth.addUser('thandi@example.com', 'correct horse');
  deviceCache.entries.set(user.id, appDataWith({ profile: { name: 'Thandi offline' } }));
  deviceCache.legacy = appDataWith({ profile: { name: 'Pre-account data' } });
  await controller.start();

  await controller.signIn('thandi@example.com', 'correct horse');

  assert.equal(app.get().profile.name, 'Thandi offline');
  assert.equal(repository.rows.get(user.id).profile.name, 'Thandi offline');
});

test('signing in before confirming the email sends a fresh code and asks for it', async () => {
  const { controller, auth } = setup();
  auth.addUser('thandi@example.com', 'correct horse', { confirmed: false });
  await controller.start();

  const result = await controller.signIn('thandi@example.com', 'correct horse');

  assert.equal(result, 'needsConfirmation');
  assert.ok(auth.inbox.get('thandi@example.com'), 'a new code should have been emailed');
  assert.equal(controller.getState().status, 'signedOut');
});

test('a wrong password is rejected and leaves the user signed out', async () => {
  const { controller, auth } = setup();
  auth.addUser('thandi@example.com', 'correct horse');
  await controller.start();

  await assert.rejects(controller.signIn('thandi@example.com', 'wrong'), { code: 'invalid_credentials' });
  assert.equal(controller.getState().status, 'signedOut');
});

test('a wrong confirmation code is rejected and can be re-sent', async () => {
  const { controller, auth } = setup();
  await controller.start();
  await controller.signUp('thandi@example.com', 'correct horse');
  const firstCode = auth.inbox.get('thandi@example.com');

  await assert.rejects(controller.confirmSignUp('thandi@example.com', '000000'), { code: 'otp_expired' });
  await controller.resendConfirmation('thandi@example.com');

  assert.notEqual(auth.inbox.get('thandi@example.com'), firstCode);
  await controller.confirmSignUp('thandi@example.com', auth.inbox.get('thandi@example.com'));
  assert.equal(controller.getState().status, 'ready');
});

test('a forgotten password is reset with the emailed code, which also signs the user in', async () => {
  const { controller, auth } = setup();
  auth.addUser('thandi@example.com', 'old password');
  await controller.start();

  await controller.requestPasswordReset('thandi@example.com');
  await controller.resetPassword('thandi@example.com', auth.inbox.get('thandi@example.com'), 'new password');

  assert.equal(controller.getState().status, 'ready');
  assert.equal(auth.users.get('thandi@example.com').password, 'new password');
});

test('a password reset with a wrong code changes nothing', async () => {
  const { controller, auth } = setup();
  auth.addUser('thandi@example.com', 'old password');
  await controller.start();
  await controller.requestPasswordReset('thandi@example.com');

  await assert.rejects(controller.resetPassword('thandi@example.com', '000000', 'new password'), { code: 'otp_expired' });

  assert.equal(auth.users.get('thandi@example.com').password, 'old password');
  assert.equal(controller.getState().status, 'signedOut');
});

test('changing the password requires the current one', async () => {
  const { controller, auth } = setup();
  auth.addUser('thandi@example.com', 'old password');
  await controller.start();
  await controller.signIn('thandi@example.com', 'old password');

  await assert.rejects(controller.changePassword('not it', 'new password'), /current password is incorrect/);
  assert.equal(auth.users.get('thandi@example.com').password, 'old password');

  await controller.changePassword('old password', 'new password');
  assert.equal(auth.users.get('thandi@example.com').password, 'new password');
  assert.equal(controller.getState().status, 'ready');
});

async function signedIn(options) {
  const parts = setup(options);
  parts.auth.addUser('thandi@example.com', 'correct horse');
  await parts.controller.start();
  await parts.controller.signIn('thandi@example.com', 'correct horse');
  parts.app.replace(appDataWith({ profile: { name: 'Thandi', email: 'thandi@example.com' } }));
  return parts;
}

test('signing out removes this account’s data from the device', async () => {
  const { controller, app, deviceCache, sync } = await signedIn();
  const { userId } = controller.getState();

  await controller.signOut();

  assert.equal(controller.getState().status, 'signedOut');
  assert.equal(controller.getState().userId, null);
  assert.equal(app.get().profile.name, '');
  assert.equal(deviceCache.entries.has(userId), false);
  assert.equal(sync.runningFor, null);
});

test('signing out is refused while changes have not reached the cloud', async () => {
  const { controller, auth, app, sync } = await signedIn();
  sync.flushSucceeds = false;

  await assert.rejects(controller.signOut(), /Could not save your data/);

  assert.equal(controller.getState().status, 'ready');
  assert.ok(auth.session, 'the session should still be active');
  assert.equal(app.get().profile.name, 'Thandi');
});

test('a session ended elsewhere signs this device out too', async () => {
  const { controller, auth, app } = await signedIn();

  auth.endSessionElsewhere();
  await controller.settled();

  assert.equal(controller.getState().status, 'signedOut');
  assert.equal(app.get().profile.name, '');
});

test('deleting the account removes it, its cloud data and the device copy, then signs out', async () => {
  const { controller, auth, repository, deviceCache } = await signedIn();
  const { userId } = controller.getState();

  await controller.deleteAccount();

  assert.equal(auth.users.has('thandi@example.com'), false);
  assert.equal(repository.rows.has(userId), false);
  assert.equal(deviceCache.entries.has(userId), false);
  assert.equal(controller.getState().status, 'signedOut');
  await assert.rejects(controller.signIn('thandi@example.com', 'correct horse'), { code: 'invalid_credentials' });
});

test('a failed account deletion keeps the user signed in with sync running', async () => {
  const { controller, repository, sync } = await signedIn();
  repository.deleteAccount = async () => {
    throw new Error('permission denied for function delete_my_account');
  };

  await assert.rejects(controller.deleteAccount(), /permission denied/);

  assert.equal(controller.getState().status, 'ready');
  assert.equal(sync.runningFor, controller.getState().userId);
});

test('an existing session is restored when the app starts', async () => {
  const parts = harness();
  const user = parts.auth.addUser('thandi@example.com', 'correct horse');
  await parts.auth.signInWithPassword({ email: 'thandi@example.com', password: 'correct horse' });
  parts.repository.rows.set(user.id, appDataWith({ profile: { name: 'Thandi', email: 'thandi@example.com' } }));
  const controller = createAuthController(parts);

  await controller.start();

  assert.equal(controller.getState().status, 'ready');
  assert.equal(parts.app.get().profile.name, 'Thandi');
});

test('when the cloud cannot be reached the error is shown and retry recovers', async () => {
  const parts = harness();
  parts.auth.addUser('thandi@example.com', 'correct horse');
  await parts.auth.signInWithPassword({ email: 'thandi@example.com', password: 'correct horse' });
  parts.repository.failNextLoad = new TypeError('Failed to fetch');
  const controller = createAuthController(parts);

  await controller.start();

  assert.equal(controller.getState().status, 'error');
  assert.equal(controller.getState().error, 'Could not reach FinFeast. Check your connection and try again.');
  assert.equal(parts.sync.runningFor, null, 'nothing should sync from an account that failed to load');

  await controller.start();
  assert.equal(controller.getState().status, 'ready');
});

test('signing in while the cloud is unreachable reports the error instead of hanging', async () => {
  const { controller, auth, repository, sync } = setup();
  auth.addUser('thandi@example.com', 'correct horse');
  await controller.start();
  repository.failNextLoad = new TypeError('Failed to fetch');

  await assert.rejects(controller.signIn('thandi@example.com', 'correct horse'));

  assert.equal(controller.getState().status, 'error');
  assert.equal(sync.runningFor, null);
});

test('a sign-out that lands while the account is still loading wins', async () => {
  const { controller, auth, repository, sync, app } = setup();
  const user = auth.addUser('thandi@example.com', 'correct horse');
  repository.rows.set(user.id, appDataWith({ profile: { name: 'Thandi', email: 'thandi@example.com' } }));
  let releaseLoad;
  const realLoad = repository.load.bind(repository);
  repository.load = (...args) => new Promise((resolve) => {
    releaseLoad = () => resolve(realLoad(...args));
  });
  await controller.start();

  const signingIn = controller.signIn('thandi@example.com', 'correct horse');
  await new Promise((resolve) => setImmediate(resolve));
  auth.endSessionElsewhere();
  await controller.settled();
  releaseLoad();
  await signingIn.catch(() => {});

  assert.equal(controller.getState().status, 'signedOut');
  assert.equal(sync.runningFor, null);
  assert.equal(app.get().profile.name, '');
});

test('signing up with an email that already has an account says so instead of waiting for a code', async () => {
  const { controller, auth } = setup();
  auth.addUser('thandi@example.com', 'correct horse');
  await controller.start();

  await assert.rejects(controller.signUp('thandi@example.com', 'another password'), { code: 'user_already_exists' });
  assert.equal(controller.getState().status, 'signedOut');
});

test('a password reset the server rejects leaves no session behind', async () => {
  const { controller, auth } = setup();
  auth.addUser('thandi@example.com', 'old password');
  await controller.start();
  await controller.requestPasswordReset('thandi@example.com');

  await assert.rejects(
    controller.resetPassword('thandi@example.com', auth.inbox.get('thandi@example.com'), 'old password'),
    { code: 'same_password' },
  );

  assert.equal(auth.session, null, 'a stored session would sign the user in next launch with the old password');
  assert.equal(controller.getState().status, 'signedOut');
});
