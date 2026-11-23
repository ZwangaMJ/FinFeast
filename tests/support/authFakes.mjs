import { authErrorMessage } from '../../src/lib/auth/validation.ts';

// In-memory stand-ins for Supabase auth, the cloud database, the device cache,
// cloud sync and the app store. They model behaviour (accounts, codes, sessions)
// rather than recording calls, so tests can assert on outcomes.

export const initialData = Object.freeze({ profile: Object.freeze({ name: '', email: '' }), goals: Object.freeze([]) });

export function appDataWith(overrides) {
  return { ...initialData, ...overrides, profile: { ...initialData.profile, ...(overrides.profile ?? {}) } };
}

function authError(code, message = code) {
  return Object.assign(new Error(message), { code });
}

export function fakeSupabaseAuth({ confirmEmail = true } = {}) {
  const users = new Map(); // email -> { id, email, password, confirmed }
  const inbox = new Map(); // email -> latest code
  const listeners = new Set();
  let session = null;
  let nextId = 1;
  let nextCode = 111111;

  const sessionFor = (user) => ({ access_token: `token-${user.id}`, user: { id: user.id, email: user.email } });
  const sendCode = (email) => {
    const code = String(nextCode++);
    inbox.set(email, code);
    return code;
  };
  const emit = (event) => listeners.forEach((listener) => listener(event, session));

  return {
    inbox,
    users,
    get session() {
      return session;
    },
    addUser(email, password, { confirmed = true } = {}) {
      const user = { id: `user-${nextId++}`, email, password, confirmed };
      users.set(email, user);
      return user;
    },
    // Simulates the session being ended elsewhere (another tab, revoked token).
    endSessionElsewhere() {
      session = null;
      emit('SIGNED_OUT');
    },

    async getSession() {
      return { data: { session }, error: null };
    },
    async signUp({ email, password }) {
      // Real Supabase (with "Confirm email" on) hides whether an email is taken:
      // no error, no session, no email sent, and a user with no identities.
      if (users.has(email)) return { data: { user: { id: 'obfuscated', identities: [] }, session: null }, error: null };
      const user = this.addUser(email, password, { confirmed: !confirmEmail });
      if (!confirmEmail) {
        session = sessionFor(user);
        emit('SIGNED_IN');
        return { data: { session }, error: null };
      }
      sendCode(email);
      return { data: { user: { id: user.id, identities: [{ provider: 'email' }] }, session: null }, error: null };
    },
    async signInWithPassword({ email, password }) {
      const user = users.get(email);
      if (!user || user.password !== password) return { data: { session: null }, error: authError('invalid_credentials') };
      if (!user.confirmed) return { data: { session: null }, error: authError('email_not_confirmed') };
      session = sessionFor(user);
      emit('SIGNED_IN');
      return { data: { session }, error: null };
    },
    async resend({ type, email }) {
      if (type !== 'signup') throw new Error(`unexpected resend type ${type}`);
      if (users.has(email)) sendCode(email);
      return { error: null };
    },
    async resetPasswordForEmail(email) {
      if (users.has(email)) sendCode(email);
      return { error: null };
    },
    async verifyOtp({ email, token, type }) {
      const user = users.get(email);
      if (!user || inbox.get(email) !== token) return { data: { session: null }, error: authError('otp_expired') };
      if (type === 'email') user.confirmed = true;
      else if (type !== 'recovery') throw new Error(`unexpected otp type ${type}`);
      inbox.delete(email);
      session = sessionFor(user);
      emit('SIGNED_IN');
      return { data: { session }, error: null };
    },
    async updateUser({ password }) {
      if (!session) return { error: authError('session_not_found') };
      const user = [...users.values()].find((candidate) => candidate.id === session.user.id);
      if (user.password === password) return { error: authError('same_password') };
      user.password = password;
      return { error: null };
    },
    async signOut() {
      session = null;
      emit('SIGNED_OUT');
      return { error: null };
    },
    onAuthStateChange(listener) {
      listeners.add(listener);
      return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
    },
  };
}

export function fakeCloud(auth) {
  const rows = new Map(); // userId -> AppData
  return {
    rows,
    failNextLoad: null,
    async load(userId) {
      if (this.failNextLoad) {
        const error = this.failNextLoad;
        this.failNextLoad = null;
        throw error;
      }
      return rows.has(userId) ? structuredClone(rows.get(userId)) : null;
    },
    async save(data, userId) {
      rows.set(userId, structuredClone(data));
    },
    async deleteAccount() {
      const userId = auth.session?.user.id;
      if (!userId) throw new Error('not signed in');
      rows.delete(userId);
      const user = [...auth.users.values()].find((candidate) => candidate.id === userId);
      auth.users.delete(user.email);
    },
  };
}

export function fakeDeviceCache({ legacy = null, perUser = {} } = {}) {
  const entries = new Map(Object.entries(perUser));
  return {
    entries,
    legacy,
    savingFor: null,
    async load(userId) {
      return entries.has(userId) ? structuredClone(entries.get(userId)) : null;
    },
    async loadLegacy() {
      return this.legacy ? structuredClone(this.legacy) : null;
    },
    async removeLegacy() {
      this.legacy = null;
    },
    async remove(userId) {
      entries.delete(userId);
    },
    startSaving(userId, getData) {
      this.savingFor = userId;
      entries.set(userId, structuredClone(getData()));
    },
    async stopSaving() {
      this.savingFor = null;
    },
  };
}

export function fakeSync() {
  return {
    runningFor: null,
    flushSucceeds: true,
    start(userId) {
      this.runningFor = userId;
    },
    stop() {
      this.runningFor = null;
    },
    async flush() {
      return this.flushSucceeds;
    },
    lastError() {
      return this.flushSucceeds ? null : 'Could not save your data to Supabase.';
    },
  };
}

export function fakeAppStore() {
  let data = initialData;
  return {
    get: () => data,
    replace: (next) => {
      data = next;
    },
  };
}

export function harness({ confirmEmail = true, cache = {} } = {}) {
  const auth = fakeSupabaseAuth({ confirmEmail });
  const parts = {
    auth,
    repository: fakeCloud(auth),
    deviceCache: fakeDeviceCache(cache),
    sync: fakeSync(),
    app: fakeAppStore(),
    initialData,
    describeError: authErrorMessage,
  };
  return parts;
}
