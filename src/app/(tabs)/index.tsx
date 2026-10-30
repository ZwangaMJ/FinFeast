import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { HeroCard, InsightCard, MealCard } from '@/components/cards';
import { Ring } from '@/components/charts';
import { Button, Card, Icon, Row, Screen, Section, Txt, useCurrency } from '@/components/ui';
import { useInsights } from '@/hooks/useInsights';
import { FOOD, planWeekFoodSpend, riskyDays, safetyNetDays, spend, VARIABLE_CATEGORIES, weeklyFlexible } from '@/lib/budget';
import { addDays, daysBetween, DAY_LONG, greeting, today, weekStart, weekday } from '@/lib/dates';
import { money, PRICE_FACTOR } from '@/lib/format';
import { planCost } from '@/lib/mealPlanner';
import { MEAL_SLOTS } from '@/store/types';
import { useStore } from '@/store/useStore';
import { useTheme } from '@/theme';

const SLOT_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' } as const;

export default function Home() {
  const { c, tone } = useTheme();
  const currency = useCurrency();
  const fmt = (n: number) => money(n, currency);
  const s = useStore();
  const insights = useInsights();

  const t = today();
  const ws = weekStart(t);
  const flexWeek = weeklyFlexible(s.income, s.bills, s.goals);
  const spentWeek = spend(s.transactions, ws, addDays(t, 1), VARIABLE_CATEGORIES);
  const flexLeft = flexWeek - spentWeek;
  const resetsIn = 7 - daysBetween(ws, t);

  const est = s.plan ? planCost(s.plan.days, s.profile.householdSize, s.pantry.map((p) => p.key), currency) : s.weeklyFoodBudget;
  const foodSpent = s.plan ? planWeekFoodSpend(s.transactions, s.plan) : spend(s.transactions, ws, addDays(t, 1), FOOD);
  const foodRatio = est > 0 ? foodSpent / est : 0;
  const dayIdx = s.plan ? daysBetween(s.plan.weekStart, t) : -1;
  const todayPlan = s.plan?.days[dayIdx];

  const safety = safetyNetDays(s.goals, s.bills, s.weeklyFoodBudget);
  const risky = riskyDays(s.transactions, 50 * PRICE_FACTOR[currency])[weekday(t)];
  const showStatementPrompt = !s.manualMode && s.documents.filter((d) => d.type === 'bank_statement' && d.status === 'confirmed' && d.addedAt.slice(0, 10) >= addDays(t, -30)).length === 0;
  const name = s.profile.name;

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <View>
          <Txt v="small" muted>
            {DAY_LONG[weekday(t)]}
          </Txt>
          <Txt v="title">
            {greeting()}
            {name ? `, ${name}` : ''}
          </Txt>
        </View>
        <Pressable onPress={() => router.navigate('/profile')} accessibilityRole="button" accessibilityLabel="Profile" style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: tone('green').bg, alignItems: 'center', justifyContent: 'center' }}>
          <Txt v="h3" color={tone('green').fg}>
            {(name || 'F').slice(0, 1).toUpperCase()}
          </Txt>
        </Pressable>
      </Row>

      {/* Safety Net strip */}
      <Pressable onPress={() => router.navigate('/goals')} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: tone('blue').bg, borderRadius: 999, paddingHorizontal: 14, minHeight: 40, marginBottom: 14 }}>
        <Icon name="shield-checkmark-outline" size={17} color={tone('blue').fg} />
        <Txt v="smallStrong" color={tone('blue').fg} style={{ flex: 1 }}>
          {safety > 0 ? `Safety net: ${safety} day${safety === 1 ? '' : 's'} of essentials covered` : 'Safety net: let’s cover your first day of essentials'}
        </Txt>
        <Icon name="chevron-forward" size={16} color={tone('blue').fg} />
      </Pressable>

      {s.manualMode ? (
        <Card tone="amber" style={{ marginBottom: 14, gap: 8 }}>
          <Row gap={8}>
            <Icon name="sparkles-outline" color={tone('amber').fg} />
            <Txt v="h3" style={{ flex: 1 }}>
              Let your budget build itself
            </Txt>
          </Row>
          <Txt v="small" muted>
            You’re on manual numbers. Add a payslip or statement and we’ll find your bills and real food spend.
          </Txt>
          <Button label="Add a document" small tone="amber" variant="tonal" style={{ alignSelf: 'flex-start' }} onPress={() => router.push('/upload')} />
        </Card>
      ) : null}

      <HeroCard
        label="Flexible this week"
        value={fmt(Math.max(0, Math.round(flexLeft)))}
        context={flexLeft >= 0 ? `left of ${fmt(Math.round(flexWeek))} · resets in ${resetsIn} day${resetsIn === 1 ? '' : 's'}` : `${fmt(Math.abs(flexLeft))} past this week’s flexible money — next week’s plan can make it back`}
        cta={{ label: 'See where it goes', onPress: () => router.navigate('/money') }}
      />

      {risky?.risky && s.settings.riskAlerts ? (
        <Card tone="amber" style={{ marginTop: 14, gap: 6 }}>
          <Txt v="h3">{DAY_LONG[weekday(t)]} takeaway alert</Txt>
          <Txt v="small" muted>
            You’ve spent about {fmt(risky.avg)} on {DAY_LONG[weekday(t)]}s lately. Tonight’s dinner is planned — cook it and you keep most of that.
          </Txt>
        </Card>
      ) : null}

      {/* Week food ring + today's meals */}
      <Section title="This week’s food" action={{ label: 'Plan', onPress: () => router.navigate('/meals') }}>
        <Card style={{ gap: 14 }}>
          <Row gap={18}>
            <Ring value={foodRatio} size={112} stroke={11} tone="green" overTone="amber" accessibilityLabel={`Weekly food budget: ${Math.round(foodRatio * 100)}% used, ${fmt(Math.max(0, est - foodSpent))} left`}>
              <Txt v="h2" tabular>
                {Math.round(foodRatio * 100)}%
              </Txt>
              <Txt v="caption" muted>
                used
              </Txt>
            </Ring>
            <View style={{ flex: 1, gap: 4 }}>
              <Txt v="display" color={foodRatio > 1 ? c.amber : c.text}>
                {fmt(Math.abs(Math.round(est - foodSpent)))}
              </Txt>
              <Txt muted>{foodRatio > 1 ? 'over the plan so far' : `left of ${fmt(Math.round(est))} planned`}</Txt>
              <Button label="Add receipt" icon="camera-outline" small variant="secondary" style={{ alignSelf: 'flex-start', marginTop: 6 }} onPress={() => router.push({ pathname: '/upload', params: { mode: 'receipt' } })} />
            </View>
          </Row>
        </Card>
        {todayPlan ? (
          <View style={{ gap: 10, marginTop: 12 }}>
            {MEAL_SLOTS.map((slot) => (
              <MealCard key={slot} compact slotLabel={SLOT_LABEL[slot]} meal={todayPlan.slots[slot]} onPress={() => router.push(`/meal/${dayIdx}-${slot}`)} />
            ))}
          </View>
        ) : null}
      </Section>

      {/* Insight of the day */}
      <Section title="Insight of the day" action={insights.length > 1 ? { label: `All ${insights.length}`, onPress: () => router.push('/insights') } : undefined}>
        {insights[0] ? (
          <InsightCard insight={insights[0]} compact />
        ) : (
          <Card>
            <Txt muted>Nothing to change today — you’re on plan. We’ll tell you the moment we find money.</Txt>
          </Card>
        )}
      </Section>

      {showStatementPrompt ? (
        <Card style={{ marginTop: 14, gap: 8 }} onPress={() => router.push('/upload')} accessibilityLabel="Add this month's statement">
          <Row gap={10}>
            <Icon name="reader-outline" color={c.primary} />
            <Txt v="bodyStrong" style={{ flex: 1 }}>
              Add this month’s statement to keep your plan sharp
            </Txt>
            <Icon name="chevron-forward" size={18} color={c.textFaint} />
          </Row>
        </Card>
      ) : null}

      {/* Quick actions */}
      <Section title="Quick actions">
        <Row gap={10}>
          {[
            { icon: 'receipt-outline', label: 'Add receipt', onPress: () => router.push({ pathname: '/upload', params: { mode: 'receipt' } }) },
            { icon: 'restaurant-outline', label: 'Plan dinner', onPress: () => router.navigate('/meals') },
            { icon: 'swap-vertical-outline', label: 'Move money', onPress: () => router.navigate('/goals') },
          ].map((a) => (
            <Card key={a.label} onPress={a.onPress} style={{ flex: 1, alignItems: 'center', gap: 8, paddingVertical: 16 }} accessibilityLabel={a.label}>
              <Icon name={a.icon} size={24} color={c.primary} />
              <Txt v="smallStrong" center>
                {a.label}
              </Txt>
            </Card>
          ))}
        </Row>
      </Section>
    </Screen>
  );
}
