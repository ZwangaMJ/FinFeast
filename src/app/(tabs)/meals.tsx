import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { MealCard } from '@/components/cards';
import { FoodImage } from '@/components/FoodImage';
import { Button, Card, EmptyState, FadeSwap, Group, Icon, IconButton, ListRow, Row, Screen, Sheet, StatusBadge, Touchable, Txt, useCurrency } from '@/components/ui';
import { planCoverage, planWeekFoodSpend } from '@/lib/budget';
import { getRecipe } from '@/lib/catalog';
import { daysBetween, DAY_LONG, DAY_SHORT, parseIso, shortDate, today, weekday } from '@/lib/dates';
import { money } from '@/lib/format';
import { selection, tick } from '@/lib/haptics';
import { dayNutrition, estimateRange, hasRecipesFor, planCost, PROTEIN_FLOOR_G } from '@/lib/mealPlanner';
import { MEAL_SLOTS, type MealPlan } from '@/store/types';
import { useStore } from '@/store/useStore';
import { radius, space, useTheme, type Tone } from '@/theme';

const SLOT_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' } as const;

export default function Meals() {
  const { c } = useTheme();
  const currency = useCurrency();
  const fmt = (n: number) => money(n, currency);
  const s = useStore();
  const plan = s.plan;
  const todayIdx = plan ? Math.max(0, Math.min(6, daysBetween(plan.weekStart, today()))) : 0;
  // Selection resets to today whenever a new week's plan arrives
  const [picked, setPicked] = useState<{ week: string; day: number; from: number } | null>(null);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const day = plan && picked?.week === plan.weekStart ? picked.day : todayIdx;
  const setDay = (d: number) => {
    if (!plan || d === day) return;
    selection();
    setPicked({ week: plan.weekStart, day: d, from: day });
  };

  if (!hasRecipesFor(s.profile)) {
    return (
      <Screen title="Meals">
        <EmptyState icon="nutrition-outline" title="We need a little more room" body="Your diet and allergy settings rule out every recipe for at least one meal. Loosen one setting in Profile and we’ll build your week." action={<Button label="Open Profile" small onPress={() => router.navigate('/profile')} />} />
      </Screen>
    );
  }
  if (!plan) {
    return (
      <Screen title="Meals">
        <EmptyState icon="restaurant-outline" title="No plan yet" body="We’ll build a week of meals that fits your food budget." action={<Button label="Build my week" small onPress={() => s.ensurePlan()} />} />
      </Screen>
    );
  }

  const pantryKeys = s.pantry.map((p) => p.key);
  const est = planCost(plan.days, s.profile.householdSize, pantryKeys, currency);
  const [lo, hi] = estimateRange(est);
  const spent = planWeekFoodSpend(s.transactions, plan);
  // Trigger rule: week actual > estimate by >10% → offer a budget-light plan for the remaining days
  const runningHot = spent > est * planCoverage(plan) * 1.1 && todayIdx < 6 && plan.mode !== 'budget_light';
  const d = plan.days[day];
  const n = dayNutrition(d);
  const target = s.profile.calorieTarget;
  const pendingSaving = s.pendingPlan ? est - planCost(s.pendingPlan.days, s.profile.householdSize, pantryKeys, currency) : 0;

  // Limits, stated in words as well as colour
  const overBudget = est > plan.ceiling;
  const kcalState = n.kcal < target * 0.9 ? 'low' : n.kcal > target * 1.1 ? 'high' : 'on target';
  const proteinLow = n.protein < PROTEIN_FLOOR_G;
  const slideFrom = picked && picked.week === plan.weekStart ? (picked.day > picked.from ? 16 : -16) : 0;

  return (
    <Screen
      title="Meals"
      subtitle={`Week of ${shortDate(plan.weekStart)} · ${fmt(lo)}–${fmt(hi)}`}
      right={
        <Row gap={space.xs}>
          <IconButton icon="book-outline" label="My meals" onPress={() => router.push('/recipes')} />
          <IconButton icon="cube-outline" label="Pantry" onPress={() => router.push('/pantry?returnTo=meals')} />
          <IconButton icon="refresh" label="Build a new week" onPress={() => setConfirmRebuild(true)} />
        </Row>
      }
      footer={
        <Touchable
          onPress={() => router.push('/grocery')}
          accessibilityLabel={`Grocery list, ${fmt(est)} estimated`}
          style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: space.sm - 2, backgroundColor: c.amberStrong, paddingHorizontal: space.lg + 2, minHeight: 52, borderRadius: radius.pill, shadowColor: '#3C2A10', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}>
          <Icon name="cart" size={20} color="#1F1B16" />
          <Txt v="bodyStrong" color="#1F1B16" tabular>
            Grocery list · {fmt(est)}
          </Txt>
        </Touchable>
      }>
      <WeekStrip plan={plan} day={day} todayIdx={todayIdx} onPick={setDay} />

      <PlanNotice plan={plan} runningHot={runningHot} spent={spent} est={est} pendingSaving={pendingSaving} />

      {/* Budget vs nutrition limits for the selected day / week */}
      <Row gap={space.xs} wrap style={{ marginTop: space.md }}>
        <StatusBadge
          icon={overBudget ? 'alert-circle' : 'wallet'}
          label="Week"
          value={fmt(est)}
          note={overBudget ? `over ${fmt(plan.ceiling)}` : `of ${fmt(plan.ceiling)}`}
          tone={overBudget ? 'amber' : 'green'}
          accessibilityLabel={`Week grocery estimate ${fmt(est)} against a ${fmt(plan.ceiling)} budget, ${overBudget ? 'over' : 'within'} budget`}
        />
        <StatusBadge icon="flame" label="Calories" value={n.kcal.toLocaleString()} note={kcalState} tone={kcalState === 'on target' ? 'green' : 'amber'} accessibilityLabel={`${n.kcal} calories today, ${kcalState}`} />
        <StatusBadge icon="barbell" label="Protein" value={`${n.protein} g`} note={proteinLow ? `low · ${PROTEIN_FLOOR_G} g min` : 'enough'} tone={proteinLow ? 'amber' : 'green'} />
      </Row>

      <FadeSwap swapKey={`${plan.weekStart}-${day}`} axis="x" from={slideFrom}>
        <Row style={{ justifyContent: 'space-between', marginTop: space.xl, marginBottom: space.sm - 2 }}>
          <View>
            <Txt v="h2">{day === todayIdx ? 'Today' : DAY_LONG[weekday(d.date)]}</Txt>
            <Txt v="caption" muted>
              {shortDate(d.date)} · per person
            </Txt>
          </View>
          <Button
            label="New day"
            icon="shuffle-outline"
            small
            variant="secondary"
            accessibilityLabel={`Plan new meals for ${DAY_LONG[weekday(d.date)]}`}
            onPress={() => {
              tick();
              s.regenerateDay(day);
            }}
          />
        </Row>

        <View style={{ gap: space.sm }}>
          {MEAL_SLOTS.map((slot) => (
            <MealCard
              key={slot}
              slotLabel={SLOT_LABEL[slot]}
              meal={d.slots[slot]}
              onPress={() => router.push(`/meal/${day}-${slot}`)}
              onSwap={() => s.regenerateMeal(day, slot)}
              onCooked={() => s.markCooked(day, slot, !d.slots[slot].cooked)}
            />
          ))}
          {d.snacks.length ? (
            <Group inset={48}>
              {d.snacks.map((id, i) => {
                const r = getRecipe(id);
                return (
                  <ListRow
                    key={`${id}-${i}`}
                    title={r.name}
                    subtitle="Snack"
                    right={
                      <Row gap={space.xs}>
                        <Txt v="small" muted tabular>
                          {r.kcal} kcal
                        </Txt>
                        <FoodImage query={r.name} fallbackEmoji={r.emoji} tint={r.tint} image={r.image} size={32} radius={radius.sm} />
                      </Row>
                    }
                  />
                );
              })}
            </Group>
          ) : null}
        </View>
      </FadeSwap>

      <Sheet
        visible={confirmRebuild}
        onClose={() => setConfirmRebuild(false)}
        title="Build a new week?"
        footer={
          <>
            <Button
              label="Build a new week"
              icon="refresh"
              onPress={() => {
                tick();
                setConfirmRebuild(false);
                s.regenerateWeek(plan.mode);
              }}
            />
            <Button label="Keep this plan" variant="ghost" tone="gray" onPress={() => setConfirmRebuild(false)} />
          </>
        }>
        <Txt muted>Every meal this week is replaced with a new plan that fits the same budget, diet and calorie target. Meals you’ve marked cooked are replaced too.</Txt>
      </Sheet>
    </Screen>
  );
}

/** Seven equal columns — no horizontal scrolling; today carries a dot, the selection a filled pill. */
function WeekStrip({ plan, day, todayIdx, onPick }: { plan: MealPlan; day: number; todayIdx: number; onPick: (d: number) => void }) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: space.xxs + 2 }}>
      {plan.days.map((pd, i) => {
        const active = i === day;
        const isToday = i === todayIdx;
        const cooked = Object.values(pd.slots).filter((m) => m.cooked).length;
        return (
          <Touchable
            key={pd.date}
            onPress={() => onPick(i)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${DAY_LONG[weekday(pd.date)]} ${parseIso(pd.date).getDate()}${isToday ? ', today' : ''}${cooked ? `, ${cooked} of 3 cooked` : ''}`}
            scaleTo={0.94}
            style={{ flex: 1, minHeight: 64, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: active ? c.primary : c.surface }}>
            <Txt v="caption" color={active ? c.onPrimary : c.textMuted}>
              {DAY_SHORT[weekday(pd.date)]}
            </Txt>
            <Txt v="h3" color={active ? c.onPrimary : c.text} tabular>
              {parseIso(pd.date).getDate()}
            </Txt>
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: isToday ? (active ? c.onPrimary : c.primary) : 'transparent' }} />
          </Touchable>
        );
      })}
    </View>
  );
}

/**
 * One recommendation at a time (spec §1.4): the highest-priority plan state wins —
 * a proposed lighter plan, then a budget-floor conflict, then spending running warm,
 * then the budget-light reminder.
 */
function PlanNotice({ plan, runningHot, spent, est, pendingSaving }: { plan: MealPlan; runningHot: boolean; spent: number; est: number; pendingSaving: number }) {
  const { tone } = useTheme();
  const currency = useCurrency();
  const fmt = (n: number) => money(n, currency);
  const s = useStore();

  type Notice = { tone: Tone; icon: string; title: string; body: string; primary: { label: string; onPress: () => void }; secondary?: { label: string; onPress: () => void } };
  const notice: Notice | null = s.pendingPlan
    ? {
        tone: 'green',
        icon: 'leaf',
        title: `A lighter plan saves about ${fmt(pendingSaving)}`,
        body: `${s.pendingReason ?? ''} Cheaper proteins, store brands and batch cooking for the rest of the week — same nutrition floor.`.trim(),
        primary: { label: 'Use this plan', onPress: s.acceptPendingPlan },
        secondary: { label: 'Keep current', onPress: s.dismissPendingPlan },
      }
    : plan.status === 'budget_floor_conflict'
      ? {
          tone: 'amber',
          icon: 'nutrition',
          title: 'Your food budget is a little tight to eat well',
          body: `The cheapest week that still meets your calories and protein costs about ${fmt(plan.shortfall)} more than ${fmt(plan.ceiling)}. We won’t plan below that.`,
          primary: { label: `Move ${fmt(plan.shortfall)} to food`, onPress: () => s.setWeeklyFoodBudget(Math.ceil(plan.ceiling + plan.shortfall)) },
        }
      : runningHot
        ? {
            tone: 'amber',
            icon: 'trending-up',
            title: 'Food spending is running warm',
            body: `${fmt(spent)} so far against a ${fmt(est)} plan. You’ll see the full lighter plan before anything changes.`,
            primary: { label: 'Show a lighter plan', onPress: () => s.proposeLighterPlan('Spending is ahead of plan this week.') },
          }
        : plan.mode === 'budget_light'
          ? {
              tone: 'blue',
              icon: 'leaf',
              title: 'Budget-light week',
              body: 'Last week ran over plan, so this week leans on cheaper swaps and batch cooking.',
              primary: { label: 'Switch back to normal', onPress: () => s.regenerateWeek('normal') },
            }
          : null;
  if (!notice) return null;
  const tt = tone(notice.tone);
  return (
    <FadeSwap swapKey={notice.title}>
      <Card style={{ marginTop: space.md, gap: space.sm }}>
        <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
          <View style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: tt.bg, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={notice.icon} size={18} color={tt.fg} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt v="h3">{notice.title}</Txt>
            <Txt v="small" muted>
              {notice.body}
            </Txt>
          </View>
        </Row>
        <Row gap={space.xs}>
          <Button label={notice.primary.label} small variant="tonal" tone={notice.tone} style={{ flex: 1 }} onPress={notice.primary.onPress} />
          {notice.secondary ? <Button label={notice.secondary.label} small variant="ghost" tone="gray" onPress={notice.secondary.onPress} /> : null}
        </Row>
      </Card>
    </FadeSwap>
  );
}
