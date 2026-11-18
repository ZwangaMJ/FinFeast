import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Field, ListRow, Sheet, Txt } from '@/components/ui';
import { useAuthAction } from '@/hooks/useAuthAction';
import { checkNewPassword, unwrap, ValidationError } from '@/lib/auth/validation';
import { useAuthStore } from '@/store/useAuthStore';
import { useTheme } from '@/theme';

type Panel = null | 'password' | 'delete';

// Account section of the Profile tab: email, change password, sign out, delete account.
export function AccountSettings() {
  const { c, tone } = useTheme();
  const email = useAuthStore((s) => s.email);
  const [panel, setPanel] = useState<Panel>(null);
  const { busy, error, notice, setNotice, run, clearMessages } = useAuthAction();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const open = (next: Panel) => {
    setPanel(next);
    clearMessages();
    setCurrentPassword('');
    setNewPassword('');
  };

  const changePassword = () =>
    run(async () => {
      if (!currentPassword) throw new ValidationError('Enter your current password.');
      await useAuthStore.getState().changePassword(currentPassword, unwrap(checkNewPassword(newPassword)));
      setPanel(null);
      setNotice('Your password was changed.');
    });

  // Once the account is gone the root layout returns to the sign-in screen.
  const deleteAccount = () => run(() => useAuthStore.getState().deleteAccount());
  const signOut = () => run(() => useAuthStore.getState().signOut());

  return (
    <>
      <Card style={{ gap: 4 }}>
        <ListRow icon="mail-outline" title="Signed in as" subtitle={email ?? ''} />
      </Card>
      <View style={{ gap: 10, marginTop: 12 }}>
        {notice ? <Txt v="small" color={tone('green').fg}>{notice}</Txt> : null}
        {error && !panel ? <Txt v="small" color={c.destructive}>{error}</Txt> : null}
        <Button label="Change password" icon="key-outline" variant="secondary" disabled={busy} onPress={() => open('password')} />
        <Button label={busy && !panel ? 'Signing out…' : 'Sign out'} icon="log-out-outline" variant="secondary" disabled={busy} onPress={() => void signOut()} />
        <Button label="Delete my account" icon="trash-outline" variant="destructive" disabled={busy} onPress={() => open('delete')} />
      </View>

      <Sheet
        visible={panel === 'password'}
        onClose={() => setPanel(null)}
        title="Change password"
        footer={
          <>
            <Button label={busy ? 'Saving…' : 'Change password'} disabled={busy} onPress={() => void changePassword()} />
            <Button label="Cancel" variant="ghost" tone="gray" disabled={busy} onPress={() => setPanel(null)} />
          </>
        }>
        <View style={{ gap: 14 }}>
          <Field label="Current password" value={currentPassword} onChange={setCurrentPassword} secure autoComplete="current-password" textContentType="password" autoFocus />
          <Field
            label="New password"
            placeholder="At least 8 characters"
            value={newPassword}
            onChange={setNewPassword}
            secure
            autoComplete="new-password"
            textContentType="newPassword"
            onSubmit={() => void changePassword()}
          />
          {error ? <Txt v="small" color={c.destructive}>{error}</Txt> : null}
        </View>
      </Sheet>

      <Sheet
        visible={panel === 'delete'}
        onClose={() => setPanel(null)}
        title="Delete your account?"
        footer={
          <>
            <Button label={busy ? 'Deleting…' : 'Permanently delete my account'} variant="destructive" disabled={busy} onPress={() => void deleteAccount()} />
            <Button label="Cancel" variant="ghost" tone="gray" disabled={busy} onPress={() => setPanel(null)} />
          </>
        }>
        <View style={{ gap: 10 }}>
          <Txt muted>
            This permanently deletes your account ({email}) and every document, transaction, plan, goal and setting in it, from the cloud and this device. It can’t be undone. Export
            first if you’d like a copy.
          </Txt>
          {error ? <Txt v="small" color={c.destructive}>{error}</Txt> : null}
        </View>
      </Sheet>
    </>
  );
}
