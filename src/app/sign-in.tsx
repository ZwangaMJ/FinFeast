import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Field, Screen, Txt } from '@/components/ui';
import { useAuthAction } from '@/hooks/useAuthAction';
import { checkCode, checkEmail, checkNewPassword, unwrap, ValidationError } from '@/lib/auth/validation';
import { useAuthStore } from '@/store/useAuthStore';
import { useTheme } from '@/theme';

type Step = 'signIn' | 'signUp' | 'confirm' | 'forgot' | 'reset';

const HEADINGS: Record<Step, { title: string; body: string }> = {
  signIn: { title: 'Welcome back', body: 'Sign in to your FinFeast account.' },
  signUp: { title: 'Create your account', body: 'Your budget, meal plans and goals are saved to your account.' },
  confirm: { title: 'Check your email', body: 'Enter the code we sent to confirm your email address.' },
  forgot: { title: 'Reset your password', body: 'We’ll email you a code to set a new password.' },
  reset: { title: 'Set a new password', body: 'Enter the code from your email and choose a new password.' },
};

export default function SignIn() {
  const { c, tone } = useTheme();
  // Actions only: reading them via getState() keeps this screen from re-rendering on auth changes.
  const auth = useAuthStore.getState();
  const [step, setStep] = useState<Step>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const { busy, error, notice, setNotice, run, clearMessages } = useAuthAction();

  const goTo = (next: Step, message: string | null = null) => {
    setStep(next);
    clearMessages();
    setNotice(message);
    setCode('');
    if (next !== 'confirm') setPassword('');
  };

  const validEmail = () => unwrap(checkEmail(email));
  const validNewPassword = () => unwrap(checkNewPassword(password));
  const validCode = () => unwrap(checkCode(code));

  const submit = () =>
    run(async () => {
      if (step === 'signIn') {
        const address = validEmail();
        if (!password) throw new ValidationError('Enter your password.');
        const result = await auth.signIn(address, password);
        if (result === 'needsConfirmation') goTo('confirm', 'Your email isn’t confirmed yet. We sent you a new code.');
      } else if (step === 'signUp') {
        const address = validEmail();
        const result = await auth.signUp(address, validNewPassword());
        if (result === 'needsConfirmation') goTo('confirm', `We sent a code to ${address}.`);
      } else if (step === 'confirm') {
        await auth.confirmSignUp(validEmail(), validCode());
      } else if (step === 'forgot') {
        const address = validEmail();
        await auth.requestPasswordReset(address);
        goTo('reset', `If ${address} has an account, we sent it a code.`);
      } else {
        await auth.resetPassword(validEmail(), validCode(), validNewPassword());
      }
    });

  const resend = () =>
    run(async () => {
      const address = validEmail();
      if (step === 'confirm') await auth.resendConfirmation(address);
      else await auth.requestPasswordReset(address);
      setNotice(`We sent a new code to ${address}.`);
    });

  const submitLabel: Record<Step, string> = {
    signIn: 'Sign in',
    signUp: 'Create account',
    confirm: 'Confirm email',
    forgot: 'Email me a code',
    reset: 'Set new password',
  };
  const needsCode = step === 'confirm' || step === 'reset';
  const needsPassword = step === 'signIn' || step === 'signUp' || step === 'reset';
  const choosingPassword = step === 'signUp' || step === 'reset';

  return (
    <Screen edges={['top', 'bottom']} contentStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <View style={{ gap: 20, width: '100%', maxWidth: 480, alignSelf: 'center' }}>
        <View style={{ gap: 8 }}>
          <Txt v="hero" style={{ fontSize: 40, lineHeight: 46 }}>
            FinFeast
          </Txt>
          <Txt v="title">{HEADINGS[step].title}</Txt>
          <Txt muted>{HEADINGS[step].body}</Txt>
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
            autoFocus={step === 'signIn' || step === 'signUp' || step === 'forgot'}
          />
          {needsCode ? (
            <Field
              label="Code from your email"
              placeholder="123456"
              value={code}
              onChange={setCode}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              autoFocus
            />
          ) : null}
          {needsPassword ? (
            <Field
              label={step === 'reset' ? 'New password' : 'Password'}
              placeholder={choosingPassword ? 'At least 8 characters' : 'Your password'}
              value={password}
              onChange={setPassword}
              secure
              autoComplete={choosingPassword ? 'new-password' : 'current-password'}
              textContentType={choosingPassword ? 'newPassword' : 'password'}
              onSubmit={() => void submit()}
            />
          ) : null}

          {error ? (
            <View accessibilityRole="alert" accessibilityLiveRegion="polite">
              <Txt v="small" color={c.destructive}>
                {error}
              </Txt>
            </View>
          ) : null}
          {notice ? <Txt v="small" color={tone('green').fg}>{notice}</Txt> : null}

          <Button label={busy ? 'Please wait…' : submitLabel[step]} onPress={() => void submit()} disabled={busy} />

          {needsCode ? <Button label="Send a new code" variant="ghost" disabled={busy} onPress={() => void resend()} /> : null}
          {step === 'signIn' ? (
            <>
              <Button label="Forgot your password?" variant="ghost" disabled={busy} onPress={() => goTo('forgot')} />
              <Button label="New to FinFeast? Create an account" variant="ghost" disabled={busy} onPress={() => goTo('signUp')} />
            </>
          ) : (
            <Button label="Back to sign in" variant="ghost" disabled={busy} onPress={() => goTo('signIn')} />
          )}
        </Card>

        <Txt v="caption" muted center>
          Already used FinFeast on this device? That data moves into your account the first time you sign in, if the account is empty.
        </Txt>
      </View>
    </Screen>
  );
}
