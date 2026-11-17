// The sign-in and account flow, independent of React Native and Supabase setup.
// Collaborators are injected so the flow can be tested with in-memory fakes;
// src/store/useAuthStore.ts wires in the real Supabase client and storage.

export type AuthStatus = 'checking' | 'signedOut' | 'loading' | 'ready' | 'error';

export type AuthState = {
  status: AuthStatus;
  userId: string | null;
  email: string | null;
  error: string | null;
};

type AuthResultError = { message: string; code?: string } | null;

export type AuthSession = { user: { id: string; email?: string | null } };

type SessionResult = { data: { session: AuthSession | null }; error: AuthResultError };

export type AuthClient = {
  getSession: () => Promise<SessionResult>;
  signInWithPassword: (credentials: { email: string; password: string }) => Promise<SessionResult>;
  signUp: (credentials: { email: string; password: string }) => Promise<{
    data: { session: AuthSession | null; user: { identities?: unknown[] } | null };
    error: AuthResultError;
  }>;
  resend: (params: { type: 'signup'; email: string }) => Promise<{ error: AuthResultError }>;
  resetPasswordForEmail: (email: string) => Promise<{ error: AuthResultError }>;
  updateUser: (attributes: { password: string }) => Promise<{ error: AuthResultError }>;
  signOut: (options?: { scope?: 'global' | 'local' | 'others' }) => Promise<{ error: AuthResultError }>;
  onAuthStateChange: (callback: (event: string, session: AuthSession | null) => void) => unknown;
  verifyOtp: (params: { email: string; token: string; type: 'email' | 'recovery' }) => Promise<SessionResult>;
};

type AppDataShape = { profile: { email: string } };

export type AuthDependencies<Data extends AppDataShape> = {
  auth: AuthClient;
  repository: {
    load: (userId: string, email: string) => Promise<Data | null>;
    save: (data: Data, userId: string) => Promise<void>;
    deleteAccount: () => Promise<void>;
  };
  deviceCache: {
    load: (userId: string) => Promise<Data | null>;
    loadLegacy: () => Promise<Data | null>;
    removeLegacy: () => Promise<void>;
    startSaving: (userId: string, getData: () => Data) => void;
    stopSaving: () => Promise<void>;
    remove: (userId: string) => Promise<void>;
  };
  sync: {
    start: (userId: string) => void;
    stop: () => void;
    flush: () => Promise<boolean>;
    lastError: () => string | null;
  };
  app: { get: () => Data; replace: (data: Data) => void };
  initialData: Data;
  describeError: (error: unknown) => string;
  onChange?: (state: AuthState) => void;
};

// What a sign-in or sign-up led to: straight into the app, or the emailed-code step.
export type AuthOutcome = 'signedIn' | 'needsConfirmation';

function asError(error: AuthResultError): Error {
  return Object.assign(new Error(error?.message ?? 'Authentication failed.'), { code: error?.code });
}

export function createAuthController<Data extends AppDataShape>(deps: AuthDependencies<Data>) {
  let state: AuthState = { status: 'checking', userId: null, email: null, error: null };

  const setState = (next: Partial<AuthState>) => {
    state = { ...state, ...next };
    deps.onChange?.(state);
  };

  // Read through a function: TypeScript would otherwise keep a narrowed status across awaits.
  const signedOutAlready = () => state.status === 'signedOut';

  const withEmail = (data: Data, email: string): Data => ({ ...data, profile: { ...data.profile, email } });

  // Bumped on every sign-out, so a load that is still in flight can tell it has
  // been overtaken and must not write the old account's data into the app.
  let generation = 0;

  async function loadSession(session: AuthSession): Promise<void> {
    const userId = session.user.id;
    const email = session.user.email ?? '';
    const loadGeneration = ++generation;
    const current = () => loadGeneration === generation;
    setState({ status: 'loading', userId, email, error: null });

    try {
      const cloud = await deps.repository.load(userId, email);
      if (!current()) return;
      if (cloud) {
        deps.app.replace(withEmail(cloud, email));
      } else {
        // A new or empty account: seed it from this account's device copy, else from
        // data saved on this device before accounts existed, else start fresh.
        const ownCopy = await deps.deviceCache.load(userId);
        const legacy = ownCopy ? null : await deps.deviceCache.loadLegacy();
        if (!current()) return;
        const data = withEmail(ownCopy ?? legacy ?? deps.initialData, email);
        deps.app.replace(data);
        await deps.repository.save(data, userId);
        if (!current()) return;
      }
      // Pre-account data is either in this account now or superseded by its cloud
      // data; either way it must not wait on the device for the next empty account.
      await deps.deviceCache.removeLegacy();

      deps.deviceCache.startSaving(userId, deps.app.get);
      deps.sync.start(userId);
      setState({ status: 'ready' });
    } catch (error) {
      if (current()) {
        deps.app.replace(deps.initialData);
        setState({ status: 'error', error: deps.describeError(error) });
      }
      throw error;
    }
  }

  // Work started by auth events rather than by a caller; settled() awaits it.
  let background: Promise<void> = Promise.resolve();
  let listening = false;

  async function clearSession(): Promise<void> {
    generation += 1;
    const userId = state.userId;
    deps.sync.stop();
    await deps.deviceCache.stopSaving();
    if (userId) await deps.deviceCache.remove(userId);
    deps.app.replace(deps.initialData);
    setState({ status: 'signedOut', userId: null, email: null, error: null });
  }

  function listenForSignOutElsewhere() {
    if (listening) return;
    listening = true;
    deps.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT' || state.status === 'signedOut') return;
      background = background.then(clearSession, clearSession);
    });
  }

  async function resendConfirmation(email: string): Promise<void> {
    const { error } = await deps.auth.resend({ type: 'signup', email });
    if (error) throw asError(error);
  }

  return {
    getState: () => state,

    settled: () => background,

    async signOut(): Promise<void> {
      if (!(await deps.sync.flush())) {
        throw new Error(deps.sync.lastError() ?? 'Your latest changes have not been saved yet. Try again before signing out.');
      }
      const { error } = await deps.auth.signOut();
      if (error) throw asError(error);
      await background;
      if (!signedOutAlready()) await clearSession();
    },

    // Account deletion runs server-side (delete_my_account), which also removes
    // every cloud row. The server session is gone afterwards, so sign out locally.
    async deleteAccount(): Promise<void> {
      if (state.status !== 'ready' || !state.userId) throw new Error('Sign in to delete your account.');
      const userId = state.userId;
      deps.sync.stop();
      try {
        await deps.repository.deleteAccount();
      } catch (error) {
        deps.sync.start(userId);
        throw error;
      }
      await deps.auth.signOut({ scope: 'local' });
      await deps.deviceCache.removeLegacy();
      await background;
      if (!signedOutAlready()) await clearSession();
    },

    // Also used as "retry" after a failed load.
    async start(): Promise<void> {
      listenForSignOutElsewhere();
      setState({ status: 'checking', error: null });
      try {
        const { data, error } = await deps.auth.getSession();
        if (error) throw asError(error);
        if (data.session) await loadSession(data.session);
        else setState({ status: 'signedOut', userId: null, email: null });
      } catch (error) {
        deps.sync.stop();
        setState({ status: 'error', error: deps.describeError(error) });
      }
    },

    async signIn(email: string, password: string): Promise<AuthOutcome> {
      const { data, error } = await deps.auth.signInWithPassword({ email, password });
      if (error?.code === 'email_not_confirmed') {
        await resendConfirmation(email);
        return 'needsConfirmation';
      }
      if (error) throw asError(error);
      if (!data.session) throw new Error('Sign-in finished without a session. Please try again.');
      await loadSession(data.session);
      return 'signedIn';
    },

    resendConfirmation,

    async signUp(email: string, password: string): Promise<AuthOutcome> {
      const { data, error } = await deps.auth.signUp({ email, password });
      if (error) throw asError(error);
      // With "Confirm email" on, Supabase hides taken emails: no error, no email
      // sent, and a user with no identities. Say so rather than wait for a code.
      if (!data.session && data.user?.identities?.length === 0) {
        throw asError({ message: 'An account with this email already exists.', code: 'user_already_exists' });
      }
      if (!data.session) return 'needsConfirmation';
      await loadSession(data.session);
      return 'signedIn';
    },

    async requestPasswordReset(email: string): Promise<void> {
      const { error } = await deps.auth.resetPasswordForEmail(email);
      if (error) throw asError(error);
    },

    // The recovery code signs the user in; the new password is set before the
    // account loads. If the server rejects the new password, the recovery session
    // is dropped so the next launch doesn't sign in with the old password intact.
    async resetPassword(email: string, code: string, newPassword: string): Promise<void> {
      const { data, error } = await deps.auth.verifyOtp({ email, token: code, type: 'recovery' });
      if (error) throw asError(error);
      if (!data.session) throw new Error('That reset code did not sign you in. Request a new one.');
      const { error: updateError } = await deps.auth.updateUser({ password: newPassword });
      if (updateError) {
        await deps.auth.signOut({ scope: 'local' });
        throw asError(updateError);
      }
      await loadSession(data.session);
    },

    async changePassword(currentPassword: string, newPassword: string): Promise<void> {
      const email = state.email;
      if (state.status !== 'ready' || !email) throw new Error('Sign in to change your password.');
      const { error: checkError } = await deps.auth.signInWithPassword({ email, password: currentPassword });
      if (checkError?.code === 'invalid_credentials') throw new Error('Your current password is incorrect.');
      if (checkError) throw asError(checkError);
      const { error } = await deps.auth.updateUser({ password: newPassword });
      if (error) throw asError(error);
    },

    async confirmSignUp(email: string, code: string): Promise<void> {
      const { data, error } = await deps.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) throw asError(error);
      if (!data.session) throw new Error('Your email was confirmed. Sign in to continue.');
      await loadSession(data.session);
    },
  };
}

export type AuthController = ReturnType<typeof createAuthController>;
