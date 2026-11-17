// React-facing auth state. The flow itself lives in src/lib/auth/authController.ts;
// this file wires it to the real Supabase client, cloud data, device copy and sync.
import { create } from 'zustand';

import { createAuthController, type AuthController, type AuthState, type AuthStatus, type AuthOutcome } from '@/lib/auth/authController';
import { authErrorMessage } from '@/lib/auth/validation';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { supabaseDataRepository } from '@/lib/supabase/dataRepository';
import { flushCloudSync, getCloudSyncStatus, startCloudSync, stopCloudSync } from '@/lib/supabase/sync';
import { deviceCache } from './deviceCache';
import { getAppData, initialData, useStore } from './useStore';

export type { AuthStatus, AuthOutcome };

type AuthStore = AuthState & {
  // Problems saving the device copy; shown as a banner, never blocks the app.
  deviceError: string | null;
  initialize: () => Promise<void>;
  retry: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<AuthOutcome>;
  signUp: (email: string, password: string) => Promise<AuthOutcome>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  resetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
};

const NOT_CONFIGURED =
  'FinFeast is not connected to its account service. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then rebuild.';

let controller: AuthController | null = null;

function getController(): AuthController {
  if (controller) return controller;
  deviceCache.onWriteError((message) => useAuthStore.setState({ deviceError: message }));
  controller = createAuthController({
    auth: getSupabaseClient().auth,
    repository: supabaseDataRepository,
    deviceCache,
    sync: {
      start: (userId) => {
        startCloudSync(userId);
      },
      stop: stopCloudSync,
      flush: flushCloudSync,
      lastError: () => getCloudSyncStatus().error,
    },
    app: { get: () => getAppData(), replace: (data) => useStore.setState(data) },
    initialData,
    describeError: authErrorMessage,
    onChange: (state) => useAuthStore.setState({ ...state, deviceError: state.status === 'ready' ? useAuthStore.getState().deviceError : null }),
  });
  return controller;
}

async function start(): Promise<void> {
  if (!isSupabaseConfigured()) {
    useAuthStore.setState({ status: 'error', error: NOT_CONFIGURED });
    return;
  }
  await getController().start();
}

export const useAuthStore = create<AuthStore>(() => ({
  status: 'checking',
  userId: null,
  email: null,
  error: null,
  deviceError: null,
  initialize: start,
  retry: start,
  signIn: (email, password) => getController().signIn(email, password),
  signUp: (email, password) => getController().signUp(email, password),
  confirmSignUp: (email, code) => getController().confirmSignUp(email, code),
  resendConfirmation: (email) => getController().resendConfirmation(email),
  requestPasswordReset: (email) => getController().requestPasswordReset(email),
  resetPassword: (email, code, newPassword) => getController().resetPassword(email, code, newPassword),
  changePassword: (currentPassword, newPassword) => getController().changePassword(currentPassword, newPassword),
  signOut: () => getController().signOut(),
  deleteAccount: () => getController().deleteAccount(),
}));
