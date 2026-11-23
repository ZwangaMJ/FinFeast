import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Field, Screen, Txt } from '@/components/ui';
import { useAuthStore } from '@/store/useAuthStore';
import { useTheme } from '@/theme';

type Mode = 'signIn' | 'signUp';

export default function SignIn() {
  const { c, tone } = useTheme();
  const signIn = useAuthStore((state) => state.signIn);
  const signUp = useAuthStore((state) => state.signUp);
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Autofill and some keyboards add invisible spaces; Supabase compares passwords exactly
  const edgeSpace = password.length > 0 && password !== password.trim();

  const submit = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    setError(null);
    setNotice(null);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }
    if (mode === 'signUp' && password.length < 8) {
      setError('Use a password with at least 8 characters.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'signIn') {
        await signIn(normalizedEmail, password);
      } else {
        const signedIn = await signUp(normalizedEmail, password);
        if (!signedIn) {
          setNotice('Account created. Check your email to confirm your address, then sign in.');
          setMode('signIn');
          setPassword('');
        }
      }
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Something went wrong. Please try again.';
      setError(message.toLowerCase().includes('invalid login credentials') ? 'Email or password is incorrect.' : message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']} contentStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <View style={{ gap: 20, width: '100%', maxWidth: 480, alignSelf: 'center' }}>
        <View style={{ gap: 8 }}>
          <Txt v="hero" style={{ fontSize: 40, lineHeight: 46 }}>
            FinFeast
          </Txt>
          <Txt v="title">{mode === 'signIn' ? 'Welcome back' : 'Create your account'}</Txt>
          <Txt muted>Sign in with email and password to access your private financial workspace.</Txt>
        </View>

        <Card style={{ gap: 16 }}>
          <Field
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChange={setEmail}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            autoFocus
          />
          <Field
            label="Password"
            placeholder={mode === 'signUp' ? 'At least 8 characters' : 'Your password'}
            value={password}
            onChange={setPassword}
            secure
            autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
            textContentType={mode === 'signUp' ? 'newPassword' : 'password'}
          />
          {edgeSpace ? (
            <Txt v="small" color={tone('amber').fg}>
              Your password starts or ends with a space. If that isn’t part of it, remove it.
            </Txt>
          ) : null}
          {error ? <Txt v="small" color={c.destructive}>{error}</Txt> : null}
          {notice ? <Txt v="small" color={tone('green').fg}>{notice}</Txt> : null}
          <Button
            label={busy ? 'Please wait…' : mode === 'signIn' ? 'Sign in' : 'Create account'}
            onPress={() => void submit()}
            disabled={busy}
          />
          <Button
            label={mode === 'signIn' ? 'New to FinFeast? Create an account' : 'Already have an account? Sign in'}
            variant="ghost"
            disabled={busy}
            onPress={() => {
              setMode((current) => (current === 'signIn' ? 'signUp' : 'signIn'));
              setError(null);
              setNotice(null);
            }}
          />
        </Card>

        <Txt v="caption" muted center>
          If you have existing FinFeast data on this device, it will be added to your first account only when that account has no saved cloud data.
        </Txt>
      </View>
    </Screen>
  );
}
