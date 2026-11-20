import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Ring } from '@/components/charts';
import { Button, Card, Chip, Icon, IconButton, Pill, Row, Sheet, Txt, useCurrency, type IconName } from '@/components/ui';
import { RECIPE_BY_ID } from '@/data/recipes';
import { monthsToGoal } from '@/lib/budget';
import { money } from '@/lib/format';
import { tick } from '@/lib/haptics';
import type { Insight } from '@/lib/insights';
import { servingCost } from '@/lib/mealPlanner';
import type { Confidence, Currency, FoundMoney, Goal, PlannedMeal, Rule } from '@/store/types';
import { useStore } from '@/store/useStore';
import { radius, useTheme, type Tone } from '@/theme';

/** The app's signature element: one serif figure, one line of context, one CTA. */
export function HeroCard({ label, value, context, cta, tone = 'green' }: { label: string; value: string; context: string; cta?: { label: string; onPress: () => void }; tone?: Tone }) {
  const { tone: t } = useTheme();
  return (
    <Card style={{ gap: 6 }}>
      <Txt v="label" color={t(tone).fg}>
        {label}
      </Txt>
      <Txt v="hero" accessibilityLabel={`${value} ${label}`}>
        {value}
      </Txt>
      <Txt muted>{context}</Txt>
      {cta ? <Button label={cta.label} onPress={cta.onPress} variant="tonal" tone={tone} small style={{ alignSelf: 'flex-start', marginTop: 8 }} /> : null}
    </Card>
  );
}

const INSIGHT_TONE: Record<Insight['type'], Tone> = { subscription: 'blue', creep: 'amber', fixed_costs: 'gray', dining: 'amber', grocery: 'green', waste: 'green', reallocation: 'blue' };

export function InsightCard({ insight, compact }: { insight: Insight; compact?: boolean }) {
  const { tone } = useTheme();
  const act = useStore((s) => s.actOnInsight);
  const dismiss = useStore((s) => s.dismissInsight);
  const tt = tone(INSIGHT_TONE[insight.type]);
  const onAction = () => {
    act(insight);
    if (insight.action.kind === 'plan') router.navigate('/meals');
    if (insight.action.kind === 'swap') router.navigate('/meals');
    if (insight.action.kind === 'assign' || insight.action.kind === 'cancel') router.navigate('/goals');
    if (insight.action.kind === 'review') router.navigate('/money');
  };
  return (
    <Card style={{ gap: 10 }}>
      <Row gap={10} style={{ alignItems: 'flex-start' }}>
        <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: tt.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={insight.icon} size={19} color={tt.fg} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt v="h3">{insight.headline}</Txt>
          {!compact ? (
            <Txt v="small" muted>
              {insight.detail}
            </Txt>
          ) : null}
        </View>
        <Pill label={insight.amountLabel} tone={INSIGHT_TONE[insight.type]} />
      </Row>
      {compact ? (
        <Txt v="small" muted numberOfLines={2}>
          {insight.detail}
        </Txt>
      ) : null}
      <Row gap={8}>
        <Button label={insight.action.label} onPress={onAction} small tone={INSIGHT_TONE[insight.type]} variant="tonal" />
        <Button label="Not for me" onPress={() => dismiss(insight.id)} small variant="ghost" tone="gray" />
      </Row>
    </Card>
  );
}

export function FoundMoneyCard({ fm }: { fm: FoundMoney }) {
  const { c, tone } = useTheme();
  const currency = useCurrency();
  const goals = useStore((s) => s.goals);
  const allocate = useStore((s) => s.allocateFoundMoney);
  const keep = useStore((s) => s.keepFoundMoney);
  const [split, setSplit] = useState(false);
  const target = goals.find((g) => g.type === 'emergency') ?? goals[0];

  if (fm.status !== 'pending') {
    const names = (fm.allocations ?? []).map((a) => goals.find((g) => g.id === a.goalId)?.name).filter(Boolean);
    return (
      <Row gap={12} style={{ paddingVertical: 8 }}>
        <Icon name={fm.status === 'allocated' ? 'checkmark-circle' : 'wallet-outline'} color={fm.status === 'allocated' ? c.primary : c.textMuted} />
        <View style={{ flex: 1 }}>
          <Txt v="smallStrong">{fm.headline}</Txt>
          <Txt v="caption" muted>
            {fm.status === 'allocated' ? `${fm.auto ? 'Sent by your rule' : 'Sent'} to ${names.join(' & ')}` : 'Kept for spending'}
          </Txt>
        </View>
        <Txt v="smallStrong" tabular>
          {money(fm.amount, currency)}
        </Txt>
      </Row>
    );
  }

  return (
    <Card tone="green" style={{ gap: 10 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Pill label="Found money" tone="green" icon="sparkles-outline" />
        <Txt v="caption" color={tone('green').fg}>
          {fm.createdAt}
        </Txt>
      </Row>
      <Txt v="display" color={tone('green').fg}>
        {money(fm.amount, currency)}
      </Txt>
      <Txt v="bodyStrong">{fm.headline}</Txt>
      <Txt v="small" muted>
        {fm.source}
      </Txt>
      {target ? (
        <Button
          label={`Send to ${target.name}`}
          icon="arrow-forward-circle-outline"
          onPress={() => {
            tick();
            allocate(fm.id, [{ goalId: target.id, amount: fm.amount }]);
          }}
        />
      ) : null}
      <Row gap={8}>
        <Button label="Split" icon="git-branch-outline" variant="secondary" small style={{ flex: 1 }} onPress={() => setSplit(true)} disabled={goals.length === 0} />
        <Button label="Keep for spending" variant="secondary" small style={{ flex: 1 }} onPress={() => keep(fm.id)} />
      </Row>
      <SplitSheet fm={fm} goals={goals} visible={split} onClose={() => setSplit(false)} onConfirm={(alloc) => { tick(); allocate(fm.id, alloc); setSplit(false); }} />
    </Card>
  );
}

function SplitSheet({ fm, goals, visible, onClose, onConfirm }: { fm: FoundMoney; goals: Goal[]; visible: boolean; onClose: () => void; onConfirm: (a: { goalId: string; amount: number }[]) => void }) {
  const currency = useCurrency();
  const [shares, setShares] = useState<Record<string, number>>(() => Object.fromEntries(goals.map((g, i) => [g.id, i === 0 ? 50 : i === 1 ? 50 : 0])));
  const total = Object.values(shares).reduce((a, b) => a + b, 0);
  const set = (id: string, v: number) => setShares((s) => ({ ...s, [id]: Math.max(0, Math.min(100 - (total - (s[id] ?? 0)), v)) }));
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={`Split ${money(fm.amount, currency)}`}
      footer={
        <Button
          label={total < 100 ? `Confirm · keep ${100 - total}% for spending` : 'Confirm split'}
          disabled={total === 0}
          onPress={() => onConfirm(goals.filter((g) => (shares[g.id] ?? 0) > 0).map((g) => ({ goalId: g.id, amount: Math.round((fm.amount * shares[g.id]) / 100) })))}
        />
      }>
      {goals.map((g) => (
        <View key={g.id} style={{ gap: 8 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt v="bodyStrong">{g.name}</Txt>
            <Txt v="bodyStrong" tabular>
              {shares[g.id] ?? 0}% · {money(Math.round((fm.amount * (shares[g.id] ?? 0)) / 100), currency)}
            </Txt>
          </Row>
          <Row gap={6} wrap>
            {[0, 25, 50, 75, 100].map((p) => (
              <Chip key={p} small label={`${p}%`} selected={(shares[g.id] ?? 0) === p} onPress={() => set(g.id, p)} />
            ))}
          </Row>
        </View>
      ))}
    </Sheet>
  );
}

const CAL_DOT = (kcal: number, target: number) => (kcal > target * 0.42 ? 'amber' : kcal < target * 0.18 ? 'blue' : 'green') as Tone;

export function MealTile({ emoji, tint, size = 64 }: { emoji: string; tint: Tone; size?: number }) {
  const { tone } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: tone(tint).bg, alignItems: 'center', justifyContent: 'center' }}>
      <Txt style={{ fontSize: size * 0.5, lineHeight: size * 0.62 }}>{emoji}</Txt>
    </View>
  );
}

export function MealCard({ slotLabel, meal, onPress, onSwap, onCooked, compact }: { slotLabel: string; meal: PlannedMeal; onPress: () => void; onSwap?: () => void; onCooked?: () => void; compact?: boolean }) {
  const { c, tone } = useTheme();
  const currency = useCurrency();
  const target = useStore((s) => s.profile.calorieTarget);
  const recipe = RECIPE_BY_ID[meal.recipeId];
  const tried = useStore((s) => s.tried.includes(meal.recipeId));
  const cost = servingCost(meal.recipeId, meal.swaps, currency);
  const dot = CAL_DOT(recipe.kcal, target);
  return (
    <Card padded={false} style={{ padding: 12, opacity: meal.cooked ? 0.75 : 1 }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${slotLabel}: ${recipe.name}, ${money(cost, currency)} per serving, ${recipe.kcal} calories`}
        style={({ pressed }) => [{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }, pressed && { opacity: 0.8 }]}>
        <MealTile emoji={recipe.emoji} tint={recipe.tint} size={compact ? 52 : 64} />
        <View style={{ flex: 1, gap: 3 }}>
          <Row gap={6}>
            <Txt v="label" muted>
              {slotLabel}
            </Txt>
            {!tried ? <Pill label="New" tone="blue" /> : null}
            {meal.cooked ? <Pill label="Cooked" tone="green" icon="checkmark" /> : null}
          </Row>
          <Txt v="h3" numberOfLines={2}>
            {recipe.name}
          </Txt>
          <Row gap={10}>
            <Txt v="small" muted tabular>
              {money(cost, currency, { decimals: currency === 'ZAR' ? 0 : 2 })}/serving
            </Txt>
            <Row gap={4}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone(dot).fg }} />
              <Txt v="small" muted tabular>
                {recipe.kcal} kcal
              </Txt>
            </Row>
            <Txt v="small" muted>
              {recipe.minutes} min
            </Txt>
          </Row>
          {meal.batchNote || meal.leftoverOf !== undefined ? (
            <Row gap={4}>
              <Icon name="layers-outline" size={14} color={c.amber} />
              <Txt v="caption" color={c.amber}>
                {meal.batchNote ?? 'Leftovers from last night — no cooking'}
              </Txt>
            </Row>
          ) : null}
          {meal.swaps.length ? (
            <Txt v="caption" color={c.primary}>
              {meal.swaps.length} cheaper swap{meal.swaps.length > 1 ? 's' : ''} applied
            </Txt>
          ) : null}
        </View>
      </Pressable>
      {!compact && (onSwap || onCooked) ? (
        <Row gap={8} style={{ marginTop: 10, justifyContent: 'flex-end' }}>
          {onSwap ? <Button label="Swap" icon="shuffle-outline" small variant="secondary" onPress={onSwap} /> : null}
          {onCooked ? <Button label={meal.cooked ? 'Undo' : 'Cooked it'} icon={meal.cooked ? 'arrow-undo-outline' : 'checkmark-outline'} small variant="tonal" onPress={onCooked} /> : null}
        </Row>
      ) : null}
    </Card>
  );
}

export const RULE_LABEL: Record<Rule['kind'], { label: string; icon: IconName }> = {
  meal_surplus: { label: 'Meal-plan surplus', icon: 'restaurant-outline' },
  fixed: { label: 'Payday sweep', icon: 'calendar-outline' },
  percent: { label: 'Found Money split', icon: 'pie-chart-outline' },
  roundup: { label: 'Food round-ups', icon: 'arrow-up-circle-outline' },
  threshold: { label: 'Month-end check', icon: 'help-circle-outline' },
};

export function ruleSummary(r: Rule, currency: Currency) {
  switch (r.kind) {
    case 'meal_surplus':
      return 'Grocery underspend each week';
    case 'fixed':
      return `${money(r.amount ?? 0, currency)} every payday`;
    case 'percent':
      return `${r.percent ?? 0}% of any Found Money`;
    case 'roundup':
      return `Round food spend up to nearest ${money(r.amount ?? 10, currency)}`;
    case 'threshold':
      return `Ask me if month ends > ${money(r.amount ?? 0, currency)} unassigned`;
  }
}

export const GOAL_TONE: Record<Goal['type'], Tone> = { emergency: 'green', short_term: 'amber', investment: 'blue' };
export const GOAL_ICON: Record<Goal['type'], IconName> = { emergency: 'shield-checkmark-outline', short_term: 'flag-outline', investment: 'trending-up-outline' };

export function GoalRingCard({ goal }: { goal: Goal }) {
  const { c } = useTheme();
  const currency = useCurrency();
  const p = goal.target > 0 ? goal.current / goal.target : 0;
  const months = monthsToGoal(goal);
  return (
    <Card onPress={() => router.push(`/goal/${goal.id}`)} accessibilityLabel={`${goal.name}: ${Math.round(p * 100)}% of ${money(goal.target, currency)}`}>
      <Row gap={16}>
        <Ring value={p} size={84} stroke={8} tone={GOAL_TONE[goal.type]} overTone={GOAL_TONE[goal.type]} accessibilityLabel={`${goal.name} ${Math.round(p * 100)}% funded`}>
          <Txt v="h3" tabular>
            {Math.round(Math.min(1, p) * 100)}%
          </Txt>
        </Ring>
        <View style={{ flex: 1, gap: 4 }}>
          <Row gap={6}>
            <Icon name={GOAL_ICON[goal.type]} size={16} color={c.textMuted} />
            <Txt v="h3" numberOfLines={1} style={{ flex: 1 }}>
              {goal.name}
            </Txt>
          </Row>
          <Txt v="small" muted tabular>
            {money(goal.current, currency)} of {money(goal.target, currency)}
          </Txt>
          <Txt v="small" muted>
            {goal.monthlyCommitted > 0 ? `${money(goal.monthlyCommitted, currency)}/mo · ` : ''}
            {months === 0 ? 'Fully funded 🎉' : Number.isFinite(months) ? `~${months} months to go` : 'Add a rule to get moving'}
          </Txt>
          <Row gap={6} wrap style={{ marginTop: 4 }}>
            {goal.rules.filter((r) => r.enabled).map((r) => (
              <Pill key={r.id} label={RULE_LABEL[r.kind].label} tone={GOAL_TONE[goal.type]} icon={RULE_LABEL[r.kind].icon} />
            ))}
          </Row>
        </View>
        <Icon name="chevron-forward" size={18} color={c.textFaint} />
      </Row>
    </Card>
  );
}

const CONF: Record<Confidence, { tone: Tone; label: string; icon: IconName }> = {
  high: { tone: 'green', label: 'High confidence', icon: 'checkmark-circle' },
  medium: { tone: 'amber', label: 'Check this', icon: 'alert-circle-outline' },
  low: { tone: 'gray', label: 'Needs you', icon: 'help-circle-outline' },
};

/** Document review card: label, value, confidence tint, inline edit, expandable source line. */
export function ReviewFieldCard({
  label,
  value,
  confidence,
  source,
  onEdit,
  children,
  unchanged,
}: {
  label: string;
  value: string;
  confidence: Confidence;
  source?: string;
  onEdit?: () => void;
  children?: ReactNode;
  unchanged?: boolean;
}) {
  const { tone } = useTheme();
  const [open, setOpen] = useState(false);
  const conf = CONF[confidence];
  return (
    <Card tone={conf.tone} style={{ gap: 8 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt v="smallStrong" muted style={{ flex: 1 }}>
          {label}
        </Txt>
        <Pill label={unchanged ? 'Unchanged' : conf.label} tone={unchanged ? 'gray' : conf.tone} icon={unchanged ? 'remove-circle-outline' : conf.icon} />
      </Row>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt v="display" style={{ flex: 1 }}>
          {value}
        </Txt>
        {onEdit ? <IconButton icon="pencil" label={`Edit ${label}`} onPress={onEdit} /> : null}
      </Row>
      {children}
      {source ? (
        <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" style={{ minHeight: 32, justifyContent: 'center' }}>
          <Row gap={4}>
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color={tone(conf.tone).fg} />
            <Txt v="caption" color={tone(conf.tone).fg}>
              {open ? 'Hide source line' : 'Show where we found this'}
            </Txt>
          </Row>
          {open ? (
            <Txt v="caption" muted style={{ fontFamily: 'monospace', marginTop: 6 }}>
              {source}
            </Txt>
          ) : null}
        </Pressable>
      ) : null}
    </Card>
  );
}
