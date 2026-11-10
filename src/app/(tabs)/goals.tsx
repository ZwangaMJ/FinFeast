import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { FoundMoneyCard, GoalRingCard } from '@/components/cards';
import { Ring } from '@/components/charts';
import { AmountInput, Button, Card, Chip, EmptyState, IconButton, Row, Screen, Section, Sheet, Txt, useCurrency } from '@/components/ui';
import { securityMeter } from '@/lib/budget';
import { money } from '@/lib/format';
import { tick } from '@/lib/haptics';
import { useStore } from '@/store/useStore';
import { useTheme } from '@/theme';

function meterCopy(score: number) {
  if (score < 10) return 'Every rand you find here moves you away from one-paycheck-from-trouble.';
  if (score < 40) return 'A real cushion is forming. Keep the found money flowing.';
  if (score < 85) return 'Most surprises are covered now. Investing is the next lever.';
  return 'Six months covered and money working for you. Beautiful.';
}

export default function Goals() {
  const { tone } = useTheme();
  const currency = useCurrency();
  const goals = useStore((s) => s.goals);
  const bills = useStore((s) => s.bills);
  const food = useStore((s) => s.weeklyFoodBudget);
  const found = useStore((s) => s.foundMoney);
  const contribute = useStore((s) => s.contribute);
  const [moving, setMoving] = useState(false);
  const [amount, setAmount] = useState('');
  const [goalId, setGoalId] = useState<string | null>(null);
  const meter = securityMeter(goals, bills, food);
  const hasFinancialData = useStore((s) => Boolean(s.income || s.bills.length || s.transactions.length || s.weeklyFoodBudget > 0));
  const pending = found.filter((f) => f.status === 'pending');
  const history = found.filter((f) => f.status !== 'pending').slice(0, 8);
  const totalFound = found.filter((f) => f.status === 'allocated').reduce((a, f) => a + f.amount, 0);

  return (
    <Screen title="Goals" subtitle="Where your found money grows" right={<IconButton icon="add" label="New goal" tone="blue" onPress={() => router.push('/goal/new')} />}>
      <Card style={{ alignItems: 'center', gap: 10 }}>
        <Txt v="label" color={tone('blue').fg}>
          Security Meter
        </Txt>
        {hasFinancialData ? (
          <>
            <Ring value={meter.score / 100} size={170} stroke={12} tone="blue" overTone="blue" accessibilityLabel={`Security meter ${meter.score} out of 100`}>
              <Txt v="hero" tabular>
                {meter.score}
              </Txt>
              <Txt v="caption" muted>
                of 100
              </Txt>
            </Ring>
            <Txt muted center style={{ maxWidth: 320 }}>
              {meter.months >= 0.1 ? `${meter.months.toFixed(1)} months of essentials covered. ` : ''}
              {meterCopy(meter.score)}
            </Txt>
          </>
        ) : (
          <Txt muted center style={{ maxWidth: 320 }}>
            Add your payslip, bank statement, or budget to calculate your safety meter.
          </Txt>
        )}
        {totalFound > 0 ? (
          <Txt v="smallStrong" color={tone('green').fg}>
            {money(totalFound, currency)} of found money put to work so far
          </Txt>
        ) : null}
      </Card>

      <Section title={pending.length ? `Found Money · ${pending.length} waiting` : 'Found Money'}>
        {pending.length ? (
          <View style={{ gap: 12 }}>
            {pending.map((f) => (
              <FoundMoneyCard key={f.id} fm={f} />
            ))}
          </View>
        ) : (
          <Card>
            <EmptyState icon="sparkles-outline" title="Nothing waiting" body="Potential savings will be identified from your transactions and bills once you add financial data." />
          </Card>
        )}
      </Section>

      <Section title="Your goals" action={{ label: 'Move money', onPress: () => { setGoalId(goals[0]?.id ?? null); setMoving(true); } }}>
        {goals.length === 0 ? (
          <EmptyState icon="leaf-outline" title="No goals yet" body="Start with an Emergency Fund — it’s the base everything else builds on." action={<Button label="Create a goal" small onPress={() => router.push('/goal/new')} />} />
        ) : (
          <View style={{ gap: 12 }}>
            {goals.map((g) => (
              <GoalRingCard key={g.id} goal={g} />
            ))}
          </View>
        )}
      </Section>

      {history.length ? (
        <Section title="Recent">
          <Card style={{ gap: 2 }}>
            {history.map((f) => (
              <FoundMoneyCard key={f.id} fm={f} />
            ))}
          </Card>
        </Section>
      ) : null}

      <Sheet
        visible={moving}
        onClose={() => setMoving(false)}
        title="Move money to a goal"
        footer={
          <Button
            label="Add to goal"
            disabled={!goalId || !(parseFloat(amount) > 0)}
            onPress={() => {
              tick();
              contribute(goalId!, parseFloat(amount), 'Added by you');
              setAmount('');
              setMoving(false);
            }}
          />
        }>
        <AmountInput value={amount} onChange={setAmount} autoFocus />
        <Row gap={8} wrap>
          {goals.map((g) => (
            <Chip key={g.id} label={g.name} tone="blue" selected={goalId === g.id} onPress={() => setGoalId(g.id)} />
          ))}
        </Row>
        <Txt v="caption" muted>
          This records a transfer you’ve made in your banking app. FinFeast never moves money on its own.
        </Txt>
      </Sheet>
    </Screen>
  );
}
