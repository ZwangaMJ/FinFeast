import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { MealCard, MealTile } from '@/components/cards';
import { Button, Card, EmptyState, Icon, IconButton, Pill, Row, Screen, Txt, useCurrency } from '@/components/ui';
import { RECIPE_BY_ID } from '@/data/recipes';
import { planCoverage, planWeekFoodSpend } from '@/lib/budget';
import { daysBetween, DAY_SHORT, parseIso, today, weekday } from '@/lib/dates';
import { money } from '@/lib/format';
import { dayNutrition, estimateRange, hasRecipesFor, planCost, PROTEIN_FLOOR_G } from '@/lib/mealPlanner';
import { MEAL_SLOTS } from '@/store/types';
import { useStore } from '@/store/useStore';
import { radius, useTheme } from '@/theme';

const SLOT_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' } as const;

export default function Meals() {
  const { c, tone } = useTheme();
  const currency = useCurrency();
  const fmt = (n: number) => money(n, currency);
  const s = useStore();
  const plan = s.plan;
  const todayIdx = plan ? Math.max(0, Math.min(6, daysBetween(plan.weekStart, today()))) : 0;
  // Selection resets to today whenever a new week's plan arrives
  const [picked, setPicked] = useState<{ week: string; day: number } | null>(null);
  const day = plan && picked?.week === plan.weekStart ? picked.day : todayIdx;
  const setDay = (d: number) => plan && setPicked({ week: plan.weekStart, day: d });

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

  return (
    <Screen
      title="This week’s meals"
      subtitle={`${fmt(lo)}–${fmt(hi)} est. · budget ${fmt(plan.ceiling)}`}
      right={
        <Row gap={8}>
          <IconButton icon="cube-outline" label="Pantry" onPress={() => router.push('/pantry')} />
          <IconButton icon="refresh" label="Regenerate the week" onPress={() => s.regenerateWeek(plan.mode)} />
        </Row>
      }
      footer={
        <Pressable
          onPress={() => router.push('/grocery')}
          accessibilityRole="button"
          accessibilityLabel={`Grocery list, ${fmt(est)} estimated`}
          style={({ pressed }) => ({ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.amberStrong, paddingHorizontal: 22, minHeight: 52, borderRadius: radius.pill, opacity: pressed ? 0.85 : 1 })}>
          <Icon name="cart-outline" size={20} color="#1F1B16" />
          <Txt v="bodyStrong" color="#1F1B16">
            Grocery list ({fmt(est)} est.)
          </Txt>
        </Pressable>
      }>
      {/* Day selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }} style={{ marginBottom: 14 }}>
        {plan.days.map((pd, i) => {
          const active = i === day;
          const isToday = i === todayIdx;
          return (
            <Pressable
              key={pd.date}
              onPress={() => setDay(i)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${DAY_SHORT[weekday(pd.date)]} ${parseIso(pd.date).getDate()}${isToday ? ', today' : ''}`}
              style={{ width: 54, minHeight: 68, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: active ? c.primary : c.surface, borderWidth: isToday && !active ? 1.5 : 0, borderColor: c.primary }}>
              <Txt v="caption" color={active ? c.onPrimary : c.textMuted}>
                {DAY_SHORT[weekday(pd.date)]}
              </Txt>
              <Txt v="h2" color={active ? c.onPrimary : c.text} tabular>
                {parseIso(pd.date).getDate()}
              </Txt>
            </Pressable>
          );
        })}
      </ScrollView>

      {s.pendingPlan ? (
        <Card tone="green" style={{ gap: 8, marginBottom: 14 }}>
          <Txt v="h3">A lighter plan is ready</Txt>
          <Txt v="small" muted>
            {s.pendingReason} Cheaper proteins, store brands and batch cooking for the rest of the week — about {fmt(pendingSaving)} less. Same nutrition floor.
          </Txt>
          <Row gap={8}>
            <Button label="Use this plan" small onPress={s.acceptPendingPlan} />
            <Button label="Keep current" small variant="ghost" tone="gray" onPress={s.dismissPendingPlan} />
          </Row>
        </Card>
      ) : null}

      {plan.status === 'budget_floor_conflict' ? (
        <Card tone="amber" style={{ gap: 8, marginBottom: 14 }}>
          <Txt v="h3">Your food budget is a little tight to eat well</Txt>
          <Txt v="small" muted>
            The cheapest week that still meets your calories and protein costs about {fmt(plan.shortfall)} more than your {fmt(plan.ceiling)} budget. We won’t plan below that — moving {fmt(plan.shortfall)} from flexible money covers it.
          </Txt>
          <Button label={`Move ${fmt(plan.shortfall)} to food`} small tone="amber" variant="tonal" style={{ alignSelf: 'flex-start' }} onPress={() => s.setWeeklyFoodBudget(Math.ceil(plan.ceiling + plan.shortfall))} />
        </Card>
      ) : null}

      {plan.mode === 'budget_light' && !s.pendingPlan ? (
        <Card tone="blue" style={{ gap: 6, marginBottom: 14 }}>
          <Row gap={8}>
            <Icon name="leaf-outline" color={tone('blue').fg} />
            <Txt v="h3" style={{ flex: 1 }}>
              Budget-light week
            </Txt>
          </Row>
          <Txt v="small" muted>
            Last week ran over plan, so this week leans on cheaper swaps and batch cooking. Prefer your usual mix?
          </Txt>
          <Button label="Switch back to normal" small variant="ghost" tone="blue" style={{ alignSelf: 'flex-start' }} onPress={() => s.regenerateWeek('normal')} />
        </Card>
      ) : null}

      {runningHot && !s.pendingPlan ? (
        <Card tone="amber" style={{ gap: 8, marginBottom: 14 }}>
          <Txt v="h3">Food spending is running warm this week</Txt>
          <Txt v="small" muted>
            {fmt(spent)} so far against a {fmt(est)} plan. Want cheaper swaps for the remaining days? You’ll see the full plan before anything changes.
          </Txt>
          <Button label="Show me a lighter plan" small tone="amber" variant="tonal" style={{ alignSelf: 'flex-start' }} onPress={() => s.proposeLighterPlan('Spending is ahead of plan this week.')} />
        </Card>
      ) : null}

      <Row style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <Row gap={8}>
          <Pill label={`${n.kcal} kcal`} tone={n.kcal < target * 0.9 || n.kcal > target * 1.1 ? 'amber' : 'green'} icon="flame-outline" />
          <Pill label={`${n.protein} g protein`} tone={n.protein < PROTEIN_FLOOR_G ? 'amber' : 'green'} icon="barbell-outline" />
        </Row>
        <Button label="New day" icon="shuffle-outline" small variant="ghost" onPress={() => s.regenerateDay(day)} />
      </Row>

      <View style={{ gap: 12 }}>
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
          <Card style={{ gap: 8 }}>
            <Txt v="label" muted>
              Snacks
            </Txt>
            {d.snacks.map((id, i) => {
              const r = RECIPE_BY_ID[id];
              return (
                <Row key={`${id}-${i}`} gap={10}>
                  <MealTile emoji={r.emoji} tint={r.tint} size={36} />
                  <Txt v="bodyStrong" style={{ flex: 1 }}>
                    {r.name}
                  </Txt>
                  <Txt v="small" muted tabular>
                    {r.kcal} kcal
                  </Txt>
                </Row>
              );
            })}
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}
