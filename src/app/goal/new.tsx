import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { GOAL_ICON } from '@/components/cards';
import { AmountInput, Button, Card, Chip, Field, Icon, IconButton, Row, Screen, Txt } from '@/components/ui';
import { emergencyTarget } from '@/lib/budget';
import { iso, shortDate } from '@/lib/dates';
import { money } from '@/lib/format';
import type { GoalType } from '@/store/types';
import { uid, useStore } from '@/store/useStore';
import { useTheme } from '@/theme';

const TYPES: { type: GoalType; label: string; body: string }[] = [
  { type: 'emergency', label: 'Emergency Fund', body: '3–6 months of essentials, for life’s surprises.' },
  { type: 'short_term', label: 'Short-term saving', body: 'A holiday, a deposit, a laptop — with a date.' },
  { type: 'investment', label: 'Investment bucket', body: 'Track money you put to work for the long run.' },
];

export default function NewGoal() {
  const { tone } = useTheme();
  const goals = useStore((s) => s.goals);
  const currency = useStore((s) => s.profile.currency);
  const bills = useStore((s) => s.bills);
  const food = useStore((s) => s.weeklyFoodBudget);
  const addGoal = useStore((s) => s.addGoal);
  const hasEmergency = goals.some((g) => g.type === 'emergency');
  const suggestedEmergencyTarget = emergencyTarget(bills, food);
  const [type, setType] = useState<GoalType>(hasEmergency ? 'short_term' : 'emergency');
  const [name, setName] = useState('');
  const [target, setTarget] = useState(!hasEmergency && suggestedEmergencyTarget > 0 ? String(suggestedEmergencyTarget) : '');
  const [monthly, setMonthly] = useState('');
  const [months, setMonths] = useState(12);
  const deadline = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return iso(d);
  })();
  const t = parseFloat(target);
  const ok = t > 0 && (type !== 'short_term' || name.trim());
  const suggestedMonthly = type === 'short_term' && t > 0 ? Math.ceil(t / months / 10) * 10 : 0;

  return (
    <Screen edges={['top', 'bottom']} title="New goal" right={<IconButton icon="close" label="Close" onPress={() => router.back()} />}>
      <View style={{ gap: 12 }}>
        {TYPES.map((x) => {
          const disabled = x.type === 'emergency' && hasEmergency;
          return (
            <Card key={x.type} tone={type === x.type ? 'blue' : undefined} onPress={disabled ? undefined : () => setType(x.type)} style={{ opacity: disabled ? 0.5 : 1 }} accessibilityLabel={x.label}>
              <Row gap={10}>
                <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: tone('blue').bg }}>
                  <Icon name={GOAL_ICON[x.type]} size={21} color={tone('blue').fg} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt v="bodyStrong">{x.label}</Txt>
                  <Txt v="small" muted>
                    {disabled ? 'You already have one.' : x.body}
                  </Txt>
                </View>
              </Row>
            </Card>
          );
        })}
        <Field label="Name" value={name} onChange={setName} placeholder={type === 'short_term' ? 'e.g. December holiday' : type === 'investment' ? 'e.g. Tax-free savings' : 'Emergency Fund'} />
        <AmountInput label="Target" value={target} onChange={setTarget} />
        {type === 'short_term' ? (
          <>
            <Txt v="smallStrong" muted>
              By when?
            </Txt>
            <Row gap={8} wrap>
              {[3, 6, 12, 24].map((m) => (
                <Chip key={m} label={`${m} months`} selected={months === m} onPress={() => setMonths(m)} />
              ))}
            </Row>
            <Txt v="caption" muted>
              {shortDate(deadline)} {deadline.slice(0, 4)}
              {suggestedMonthly ? ` · about ${money(suggestedMonthly, currency)} a month gets you there` : ''}
            </Txt>
          </>
        ) : null}
        <AmountInput label="Monthly commitment (optional)" value={monthly} onChange={setMonthly} />
        <Button
          label="Create goal"
          disabled={!ok}
          onPress={() => {
            const id = addGoal({
              type,
              name: name.trim() || TYPES.find((x) => x.type === type)!.label,
              target: t,
              deadline: type === 'short_term' ? deadline : null,
              monthlyCommitted: parseFloat(monthly) || (type === 'short_term' ? suggestedMonthly : 0),
              rules: type === 'emergency' ? [{ id: uid(), kind: 'meal_surplus', enabled: true }] : [],
            });
            router.replace(`/goal/${id}`);
          }}
        />
      </View>
    </Screen>
  );
}
