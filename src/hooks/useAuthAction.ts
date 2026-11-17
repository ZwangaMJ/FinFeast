import { useCallback, useState } from 'react';

import { authErrorMessage } from '@/lib/auth/validation';

// Busy / error / notice state shared by the sign-in and account screens.
// `run` clears messages, marks the screen busy, and turns any failure
// (including a ValidationError from unwrap) into user-facing wording.
export function useAuthAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (failure) {
      setError(authErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }, []);

  const clearMessages = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  return { busy, error, notice, setNotice, run, clearMessages };
}
