import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { GOAL_TONE, RULE_LABEL, ruleSummary } from '@/components/cards';
import { Ring } from '@/components/charts';
import { AmountInput, Button, Card, Chip, Divider, EmptyState, Field, Icon, IconButton, ListRow, Row, Screen, Section, Sheet, Txt, useCurrency } from '@/components/ui';
import { monthsToGoal } from '@/lib/budget';
import { shortDate } from '@/lib/dates';
import { money } from '@/lib/format';
import { tick } from '@/lib/haptics';
import type { Rule, RuleKind } from '@/store/types';
import { uid, useStore } from '@/store/useStore';
import { useTheme } from '@/theme';

const RULE_TEMPLATES: { kind: RuleKind; example: string; needs?: 'amount' | 'percent' }[] = [
  { kind: 'meal_surplus', example: 'Grocery underspend each week → this goal' },
  { kind: 'fixed', example: 'A fixed amount every payday', needs: 'amount' },
  { kind: 'percent', example: 'A share of any Found Money', needs: 'percent' },
  { kind: 'roundup', example: 'Round food spend up to the nearest 10', needs: 'amount' },
  { kind: 'threshold', example: 'If the month ends with spare money, ask me', needs: 'amount' },
];

export default function GoalDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, tone } = useTheme();
  const currency = useCurrency();
  const fmt = (n: number) => money(n, currency);
  const goal = useStore((s) => s.goals.find((g) => g.id === id));
  const weekHistory = useStore((s) => s.weekHistory);
  const { updateGoal, deleteGoal, contribute, upsertRule, removeRule } = useStore.getState();
  const [editing, setEditing] = useState<null | 'target' | 'monthly' | 'name'>(null);
  const [draft, setDraft] = useState('');
  const [ruleDraft, setRuleDraft] = useState<Rule | null>(null);
  const [adding, setAdding] = useState<null | 'add' | 'withdraw'>(null);
  const [amount, setAmount] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!goal) {
    return (
      <Screen back={() => router.back()}>
        <EmptyState icon="leaf-outline" title="Goal not found" body="It may have been deleted." />
      </Screen>
    );
  }

  const t = GOAL_TONE[goal.type];
  const p = goal.target > 0 ? goal.current / goal.target : 0;
  const months = monthsToGoal(goal);
  // Reinvestment math, stated plainly: average weekly found food money × 52
  const underspends = weekHistory.filter((w) => w.actual > 0 && w.actual < w.estimate).map((w) => w.estimate - w.actual);
  const weeklyFound = underspends.length ? underspends.reduce((a, b) => a + b, 0) / underspends.length : 0;
  const withFound = monthsToGoal(goal, (weeklyFound * 52) / 12);

  const openRule = (kind: RuleKind) => {
    const existing = goal.rules.find((r) => r.kind === kind);
    setRuleDraft(existing ?? { id: uid(), kind, enabled: true });
    setDraft(String(existing?.amount ?? existing?.percent ?? ''));
  };

  return (
    <Screen back={() => router.back()} right={goal.type !== 'emergency' ? <IconButton icon="trash-outline" label="Delete goal" onPress={() => setConfirmDelete(true)} /> : undefined}>
      <View style={{ alignItems: 'center', gap: 10 }}>
        <Row gap={6}>
          <Txt v="title" center>
            {goal.name}
          </Txt>
          <IconButton icon="pencil" label="Rename goal" onPress={() => { setDraft(goal.name); setEditing('name'); }} />
        </Row>
        <Ring value={p} size={190} stroke={13} tone={t} overTone={t} accessibilityLabel={`${goal.name}: ${Math.round(p * 100)}% funded, ${fmt(goal.current)} of ${fmt(goal.target)}`}>
          <Txt v="display" tabular>
            {fmt(goal.current)}
          </Txt>
          <Txt v="small" muted>
            of {fmt(goal.target)}
          </Txt>
        </Ring>
        <Txt muted center>
          {months === 0 ? 'Fully funded — you did it.' : Number.isFinite(months) ? `About ${months} months to go at your current pace.` : 'Add a monthly amount or a rule to set a pace.'}
          {goal.deadline ? ` Target date ${shortDate(goal.deadline)}.` : ''}
        </Txt>
        <Row gap={10}>
          <Button label="Add money" icon="add" onPress={() => setAdding('add')} />
          <Button label="Withdraw" variant="secondary" onPress={() => setAdding('withdraw')} />
        </Row>
      </View>

      {weeklyFound > 0 && Number.isFinite(withFound) ? (
        <Card tone="green" style={{ marginTop: 18, gap: 4 }}>
          <Txt v="h3">The maths, plainly</Txt>
          <Txt v="small" muted>
            {fmt(weeklyFound)}/wk found on food × 52 = {fmt(weeklyFound * 52)}/yr → {goal.name} fully funded in {withFound} months
            {Number.isFinite(months) ? ` (vs ${months} without)` : ''}.
          </Txt>
        </Card>
      ) : null}

      <Section title="Plan">
        <Card padded={false} style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
          <ListRow icon="flag-outline" iconTone={t} title="Target" subtitle={fmt(goal.target)} chevron onPress={() => { setDraft(String(goal.target)); setEditing('target'); }} />
          <Divider style={{ marginVertical: 0 }} />
          <ListRow icon="calendar-outline" iconTone={t} title="Monthly commitment" subtitle={goal.monthlyCommitted ? `${fmt(goal.monthlyCommitted)} from your income` : 'None yet'} chevron onPress={() => { setDraft(String(goal.monthlyCommitted)); setEditing('monthly'); }} />
        </Card>
        {goal.type === 'emergency' ? (
          <Txt v="caption" muted style={{ marginTop: 6 }}>
            Target is 3 months of essentials (bills + food). Aim for 6 once you get there.
          </Txt>
        ) : null}
        {goal.type === 'investment' ? (
          <Txt v="caption" muted style={{ marginTop: 6 }}>
            FinFeast tracks what you invest; it doesn’t give investment advice. Speak to a licensed adviser about where to invest.
          </Txt>
        ) : null}
      </Section>

      <Section title="Automation rules">
        <Txt v="small" muted style={{ marginBottom: 10 }}>
          Rules are opt-in. Without one, found money waits in your inbox for you to decide.
        </Txt>
        <View style={{ gap: 10 }}>
          {goal.rules.map((r) => (
            <Card key={r.id} tone={r.enabled ? t : 'gray'} style={{ gap: 6 }}>
              <Row gap={10}>
                <Icon name={RULE_LABEL[r.kind].icon} color={tone(r.enabled ? t : 'gray').fg} />
                <View style={{ flex: 1 }}>
                  <Txt v="bodyStrong">{RULE_LABEL[r.kind].label}</Txt>
                  <Txt v="small" muted>
                    {ruleSummary(r, currency)}
                    {r.enabled ? '' : ' · paused'}
                  </Txt>
                </View>
                <IconButton icon="create-outline" label={`Edit ${RULE_LABEL[r.kind].label} rule`} onPress={() => openRule(r.kind)} />
                <Button label={r.enabled ? 'Pause' : 'Resume'} small variant="ghost" tone="gray" onPress={() => upsertRule(goal.id, { ...r, enabled: !r.enabled })} />
              </Row>
            </Card>
          ))}
        </View>
        <Txt v="label" muted style={{ marginTop: 14, marginBottom: 8 }}>
          Add a rule
        </Txt>
        <Row gap={8} wrap>
          {RULE_TEMPLATES.filter((tpl) => !goal.rules.some((r) => r.kind === tpl.kind)).map((tpl) => (
            <Chip key={tpl.kind} label={RULE_LABEL[tpl.kind].label} icon={RULE_LABEL[tpl.kind].icon} tone={t} onPress={() => openRule(tpl.kind)} />
          ))}
        </Row>
      </Section>

      <Section title="History">
        {goal.contributions.length === 0 ? (
          <Txt muted>No contributions yet. Your first found money is closer than you think.</Txt>
        ) : (
          <Card padded={false} style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
            {goal.contributions.slice(0, 20).map((ct, i) => (
              <View key={ct.id}>
                <ListRow
                  icon={ct.amount >= 0 ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'}
                  iconTone={ct.amount >= 0 ? t : 'gray'}
                  title={ct.source}
                  subtitle={shortDate(ct.date)}
                  right={
                    <Txt v="bodyStrong" tabular color={ct.amount >= 0 ? c.text : c.textMuted}>
                      {money(ct.amount, currency, { sign: ct.amount > 0, decimals: ct.amount % 1 ? 2 : 0 })}
                    </Txt>
                  }
                />
                {i < Math.min(20, goal.contributions.length) - 1 ? <Divider style={{ marginVertical: 0 }} /> : null}
              </View>
            ))}
          </Card>
        )}
      </Section>

      <Sheet
        visible={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'target' ? 'Target amount' : editing === 'monthly' ? 'Monthly commitment' : 'Goal name'}
        footer={
          <Button
            label="Save"
            onPress={() => {
              if (editing === 'name' && draft.trim()) updateGoal(goal.id, { name: draft.trim() });
              const n = parseFloat(draft);
              if (editing === 'target' && n > 0) updateGoal(goal.id, { target: n });
              if (editing === 'monthly' && n >= 0) updateGoal(goal.id, { monthlyCommitted: n });
              setEditing(null);
            }}
          />
        }>
        {editing === 'name' ? <Field value={draft} onChange={setDraft} autoFocus /> : <AmountInput value={draft} onChange={setDraft} autoFocus />}
        {editing === 'monthly' ? (
          <Txt v="caption" muted>
            Committed money comes off your flexible money each month, so your weekly number stays honest.
          </Txt>
        ) : null}
      </Sheet>

      <Sheet
        visible={!!ruleDraft}
        onClose={() => setRuleDraft(null)}
        title={ruleDraft ? RULE_LABEL[ruleDraft.kind].label : ''}
        footer={
          <Button
            label="Turn on rule"
            disabled={!!ruleDraft && RULE_TEMPLATES.find((x) => x.kind === ruleDraft.kind)?.needs !== undefined && !(parseFloat(draft) > 0)}
            onPress={() => {
              if (!ruleDraft) return;
              const n = parseFloat(draft);
              const tpl = RULE_TEMPLATES.find((x) => x.kind === ruleDraft.kind)!;
              if (tpl.needs && !(n > 0)) return;
              upsertRule(goal.id, { ...ruleDraft, enabled: true, amount: tpl.needs === 'amount' ? n : undefined, percent: tpl.needs === 'percent' ? Math.min(100, n) : undefined });
              tick();
              setRuleDraft(null);
            }}
          />
        }>
        {ruleDraft ? (
          <>
            <Txt muted>{RULE_TEMPLATES.find((x) => x.kind === ruleDraft.kind)!.example}</Txt>
            {RULE_TEMPLATES.find((x) => x.kind === ruleDraft.kind)!.needs === 'amount' ? <AmountInput value={draft} onChange={setDraft} label={ruleDraft.kind === 'roundup' ? 'Round to nearest' : ruleDraft.kind === 'threshold' ? 'Ask me when unassigned money is over' : 'Amount'} /> : null}
            {RULE_TEMPLATES.find((x) => x.kind === ruleDraft.kind)!.needs === 'percent' ? (
              <Row gap={8} wrap>
                {[25, 50, 75, 100].map((pc) => (
                  <Chip key={pc} label={`${pc}%`} selected={draft === String(pc)} onPress={() => setDraft(String(pc))} />
                ))}
              </Row>
            ) : null}
            {ruleDraft.kind === 'meal_surplus' ? (
              <Txt v="caption" muted>
                Only one goal can receive the meal-plan sweep — turning it on here moves it from any other goal.
              </Txt>
            ) : null}
            {goal.rules.some((r) => r.id === ruleDraft.id) ? (
              <Button label="Remove rule" variant="destructive" small onPress={() => { removeRule(goal.id, ruleDraft.id); setRuleDraft(null); }} />
            ) : null}
          </>
        ) : null}
      </Sheet>

      <Sheet
        visible={!!adding}
        onClose={() => setAdding(null)}
        title={adding === 'withdraw' ? 'Withdraw from goal' : 'Add money'}
        footer={
          <Button
            label={adding === 'withdraw' ? 'Record withdrawal' : 'Add to goal'}
            disabled={!(parseFloat(amount) > 0)}
            onPress={() => {
              const n = parseFloat(amount);
              tick();
              contribute(goal.id, adding === 'withdraw' ? -Math.min(n, goal.current) : n, adding === 'withdraw' ? 'Withdrawal' : 'Added by you');
              setAmount('');
              setAdding(null);
            }}
          />
        }>
        <AmountInput value={amount} onChange={setAmount} autoFocus />
        <Txt v="caption" muted>
          {adding === 'withdraw' ? 'That’s what it’s for. No judgement — life happens.' : 'Records a transfer you’ve made in your banking app.'}
        </Txt>
      </Sheet>

      <Sheet
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this goal?"
        footer={
          <>
            <Button label="Delete goal" variant="destructive" onPress={() => { deleteGoal(goal.id); router.back(); }} />
            <Button label="Keep it" variant="ghost" tone="gray" onPress={() => setConfirmDelete(false)} />
          </>
        }>
        <Txt muted>The goal and its rules are removed. Money you’ve recorded isn’t touched in your bank.</Txt>
      </Sheet>
    </Screen>
  );
}
