import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Share, View } from 'react-native';

import { AmountInput, Button, Card, Chip, Divider, Icon, ListRow, Pill, Row, Screen, Section, Segmented, Sheet, Stepper, ToggleRow, Txt, useCurrency } from '@/components/ui';
import { CURRENCY_LABELS, money } from '@/lib/format';
import type { Allergen, Currency, DietPattern, ThemeMode } from '@/store/types';
import { exportData, useStore } from '@/store/useStore';
import { useTheme } from '@/theme';

const DIETS: { v: DietPattern; l: string }[] = [
  { v: 'omnivore', l: 'Everything' },
  { v: 'vegetarian', l: 'Vegetarian' },
  { v: 'vegan', l: 'Vegan' },
  { v: 'pescatarian', l: 'Pescatarian' },
  { v: 'halal', l: 'Halal' },
  { v: 'kosher', l: 'Kosher' },
];
const ALLERGENS: Allergen[] = ['gluten', 'dairy', 'nuts', 'eggs', 'fish', 'soy'];

async function doExport() {
  const json = exportData();
  if (Platform.OS === 'web') {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finfeast-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } else {
    await Share.share({ title: 'FinFeast data export', message: json });
  }
}

export default function Profile() {
  const { tone } = useTheme();
  const currency = useCurrency();
  const s = useStore();
  const p = s.profile;
  const [edit, setEdit] = useState<null | 'income' | 'food'>(null);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exported, setExported] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const toggleAllergy = (a: Allergen) => s.setProfile({ allergies: p.allergies.includes(a) ? p.allergies.filter((x) => x !== a) : [...p.allergies, a] });

  return (
    <Screen title="Profile">
      <Card>
        <Row gap={14}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: tone('green').bg, alignItems: 'center', justifyContent: 'center' }}>
            <Txt v="h2" color={tone('green').fg}>
              {(p.name || 'F').slice(0, 1).toUpperCase()}
            </Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt v="h2">{p.name || 'Your profile'}</Txt>
            <Txt v="small" muted>
              Saved on this device
            </Txt>
          </View>
          {s.manualMode ? <Pill label="Manual mode" tone="amber" /> : <Pill label="Document mode" tone="green" />}
        </Row>
      </Card>

      <Section title="Household & food">
        <Card style={{ gap: 14 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt v="bodyStrong">People you cook for</Txt>
            <Stepper value={p.householdSize} min={1} max={10} onChange={(n) => s.setProfile({ householdSize: n })} />
          </Row>
          <Divider style={{ marginVertical: 0 }} />
          <Txt v="bodyStrong">Diet</Txt>
          <Row gap={8} wrap>
            {DIETS.map((d) => (
              <Chip key={d.v} label={d.l} small selected={p.diet === d.v} onPress={() => s.setProfile({ diet: d.v })} />
            ))}
          </Row>
          <Txt v="bodyStrong">Allergies & exclusions</Txt>
          <Row gap={8} wrap>
            {ALLERGENS.map((a) => (
              <Chip key={a} label={a[0].toUpperCase() + a.slice(1)} small tone="red" selected={p.allergies.includes(a)} onPress={() => toggleAllergy(a)} />
            ))}
          </Row>
          <Divider style={{ marginVertical: 0 }} />
          <Row style={{ justifyContent: 'space-between' }}>
            <View>
              <Txt v="bodyStrong">Calories per person</Txt>
              <Txt v="caption" muted>
                Plans stay within ±10%
              </Txt>
            </View>
            <Stepper value={p.calorieTarget} min={1400} max={3200} step={100} onChange={(n) => s.setProfile({ calorieTarget: n })} />
          </Row>
          <Txt v="bodyStrong">Max cooking time per meal</Txt>
          <Row gap={8} wrap>
            {[15, 30, 45, 60].map((m) => (
              <Chip key={m} label={`${m} min`} small selected={p.maxCookMinutes === m} onPress={() => s.setProfile({ maxCookMinutes: m })} />
            ))}
          </Row>
        </Card>
        <Txt v="caption" muted style={{ marginTop: 6 }}>
          Changing these rebuilds this week’s meal plan.
        </Txt>
      </Section>

      <Section title="Money basics">
        <Card padded={false} style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
          <ListRow
            icon="cash-outline"
            iconTone="green"
            title="Monthly take-home"
            subtitle={s.income ? `${money(s.income.net, currency)} · from ${s.income.source === 'document' ? 'your documents' : 'you'}` : 'Not set'}
            chevron
            onPress={() => {
              setDraft(String(s.income?.net ?? ''));
              setEdit('income');
            }}
          />
          <Divider style={{ marginVertical: 0 }} />
          <ListRow
            icon="basket-outline"
            iconTone="amber"
            title="Weekly grocery budget"
            subtitle={`${money(s.weeklyFoodBudget, currency)} · your meal-plan ceiling`}
            chevron
            onPress={() => {
              setDraft(String(s.weeklyFoodBudget));
              setEdit('food');
            }}
          />
          <Divider style={{ marginVertical: 0 }} />
          <ListRow icon="document-text-outline" iconTone="blue" title="Documents" subtitle={`${s.documents.filter((d) => d.status === 'confirmed').length} added`} chevron onPress={() => router.push('/upload')} />
        </Card>
        <Txt v="bodyStrong" style={{ marginTop: 14, marginBottom: 8 }}>
          Currency & region
        </Txt>
        <Row gap={8} wrap>
          {(Object.keys(CURRENCY_LABELS) as Currency[]).map((cur) => (
            <Chip key={cur} small label={CURRENCY_LABELS[cur]} selected={p.currency === cur} onPress={() => s.setProfile({ currency: cur })} />
          ))}
        </Row>
      </Section>

      <Section title="Settings">
        <Card style={{ gap: 10 }}>
          <Txt v="bodyStrong">Appearance</Txt>
          <Segmented<ThemeMode>
            value={s.settings.themeMode}
            onChange={(v) => s.setSettings({ themeMode: v })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
          <Divider style={{ marginVertical: 4 }} />
          <ToggleRow icon="notifications-outline" title="Notifications" subtitle="One recommendation at a time, never a wall of numbers" value={s.settings.notifications} onChange={(v) => s.setSettings({ notifications: v })} />
          <ToggleRow icon="alert-circle-outline" title="Risky-day alerts" subtitle="e.g. a Friday takeaway heads-up in the morning" value={s.settings.riskAlerts} onChange={(v) => s.setSettings({ riskAlerts: v })} />
          <ToggleRow icon="mail-outline" title="Weekly digest" subtitle="Sunday summary: plan vs actual, found money" value={s.settings.weeklyDigest} onChange={(v) => s.setSettings({ weeklyDigest: v })} />
        </Card>
      </Section>

      <Section title="Connected accounts">
        <Card padded={false} style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
          <ListRow icon="business-outline" title="Bank feeds" subtitle="Automatic transactions — coming soon" right={<Pill label="Soon" />} />
          <Divider style={{ marginVertical: 0 }} />
          <ListRow icon="trending-up-outline" title="Investment partners" subtitle="Sync brokerage balances — coming soon" right={<Pill label="Soon" />} />
          <Divider style={{ marginVertical: 0 }} />
          <ListRow icon="people-outline" title="Household sharing" subtitle="Plan a shared food budget — coming soon" right={<Pill label="Soon" />} />
        </Card>
      </Section>

      <Section title="Security & your data">
        <Card tone="green" style={{ gap: 10 }}>
          {[
            ['phone-portrait-outline', 'Your data is stored on this device for now; account sign-in and cloud sync are coming soon.'],
            ['eye-off-outline', 'Document parsing is simulated in this prototype; original document files are not uploaded.'],
            ['time-outline', 'Your financial records stay on this device.'],
            ['ban-outline', 'Never sold. No third-party ad tracking.'],
          ].map(([icon, text]) => (
            <Row key={text} gap={10} style={{ alignItems: 'flex-start' }}>
              <Icon name={icon} size={18} color={tone('green').fg} />
              <Txt v="small" style={{ flex: 1 }}>
                {text}
              </Txt>
            </Row>
          ))}
        </Card>
        <View style={{ gap: 10, marginTop: 12 }}>
          <Button
            label={exported ? 'Exported ✓' : 'Export my data (JSON)'}
            icon="download-outline"
            variant="secondary"
            onPress={async () => {
              await doExport();
              setExported(true);
            }}
          />
          <Button label="Delete all my data" icon="trash-outline" variant="destructive" disabled={deleting} onPress={() => setConfirmDelete(true)} />
        </View>
      </Section>

      <Txt v="caption" muted center style={{ marginTop: 26 }}>
        FinFeast prototype · data stays on this device. FinFeast is not a licensed financial adviser.
      </Txt>

      <Sheet
        visible={!!edit}
        onClose={() => setEdit(null)}
        title={edit === 'income' ? 'Monthly take-home pay' : 'Weekly grocery budget'}
        footer={
          <Button
            label="Save"
            onPress={() => {
              const n = parseFloat(draft);
              if (n > 0 && edit === 'income') {
                if (s.income) useStore.setState({ income: { ...s.income, net: n, source: 'manual' } });
                else s.setManualBaseline(n, s.weeklyFoodBudget);
              }
              if (n > 0 && edit === 'food') s.setWeeklyFoodBudget(n);
              setEdit(null);
            }}
          />
        }>
        <AmountInput value={draft} onChange={setDraft} autoFocus />
        {edit === 'food' ? (
          <Txt v="caption" muted>
            Your meal plan is rebuilt to fit. If it can’t meet your nutrition floor at this budget, we’ll say so rather than under-feed you.
          </Txt>
        ) : null}
      </Sheet>

      <Sheet
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete everything?"
        footer={
          <>
            <Button
              label="Permanently delete my data"
              variant="destructive"
              disabled={deleting}
              onPress={async () => {
                setConfirmDelete(false);
                setDeleting(true);
                s.resetAll();
                setDeleting(false);
                router.replace('/onboarding');
              }}
            />
            <Button label="Cancel" variant="ghost" tone="gray" onPress={() => setConfirmDelete(false)} />
          </>
        }>
        <Txt muted>This permanently deletes your documents, transactions, plans, goals and settings from this device. Export first if you’d like a copy.</Txt>
      </Sheet>
    </Screen>
  );
}
