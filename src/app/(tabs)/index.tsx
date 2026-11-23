import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { HeroCard, InsightCard, MealCard } from '@/components/cards';
import { Ring } from '@/components/charts';
import { Button, Card, Group, Icon, ListRow, Row, Screen, Section, Touchable, Txt, useCurrency } from '@/components/ui';
import { useInsights } from '@/hooks/useInsights';
import { FOOD, riskyDays, safetyNetDays, spend, VARIABLE_CATEGORIES, weeklyFlexible } from '@/lib/budget';
import { addDays, daysBetween, DAY_LONG, greeting, shortDate, today, weekStart, weekday } from '@/lib/dates';
import { money, PRICE_FACTOR } from '@/lib/format';
import { success } from '@/lib/haptics';
import { MEAL_SLOTS } from '@/store/types';
import { useStore } from '@/store/useStore';
import { radius, space, TOUCH, useTheme } from '@/theme';

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

  const est = s.weeklyFoodBudget;
  const foodSpent = spend(s.transactions, ws, addDays(t, 1), FOOD);
  const foodRatio = est > 0 ? foodSpent / est : 0;
  const dayIdx = s.plan ? daysBetween(s.plan.weekStart, t) : -1;
  const todayPlan = s.plan?.days[dayIdx];

  const safety = safetyNetDays(s.goals, s.bills, s.weeklyFoodBudget);
  const risky = riskyDays({ transactions: s.transactions, asOf: t, plan: s.plan, bills: s.bills, minAmount: 50 * PRICE_FACTOR[currency] })[weekday(t)];
  const showStatementPrompt = !s.manualMode && s.documents.filter((d) => d.type === 'bank_statement' && d.status === 'confirmed' && d.addedAt.slice(0, 10) >= addDays(t, -30)).length === 0;
  const hasFinancialData = !!s.income || s.bills.length > 0 || s.transactions.length > 0 || s.weeklyFoodBudget > 0;
  const hasFoodData = s.weeklyFoodBudget > 0 || s.transactions.some((transaction) => FOOD.includes(transaction.category));
  const hasGoalBalance = s.goals.some((goal) => goal.type === 'emergency' && goal.current > 0);
  const pendingFound = s.foundMoney.filter((f) => f.status === 'pending');
  const name = s.profile.name;
  const initial = Array.from((name || 'F').trim().normalize('NFC'))[0]?.toLocaleUpperCase() ?? 'F';

  // "At a glance" rows live inside the hero card so the numbers read as one story
  const glance = [
    <ListRow
      key="food"
      icon="basket"
      iconTone="amber"
      title="Food this week"
      subtitle={
        est > 0
          ? foodRatio > 1
            ? `${fmt(Math.round(foodSpent - est))} past the ${fmt(Math.round(est))} plan`
            : `${fmt(Math.max(0, Math.round(est - foodSpent)))} left of ${fmt(Math.round(est))}`
          : hasFoodData
            ? `${fmt(Math.round(foodSpent))} spent · set a budget to compare`
            : 'Add a statement or a food budget'
      }
      right={
        est > 0 ? (
          <Ring value={foodRatio} size={34} stroke={4} tone="green" overTone="amber" accessibilityLabel={`Weekly food budget ${Math.round(foodRatio * 100)}% used`} />
        ) : undefined
      }
      chevron
      onPress={() => router.navigate(est > 0 ? '/meals' : '/profile')}
    />,
    <ListRow
      key="safety"
      icon="shield-checkmark"
      iconTone="blue"
      title="Safety net"
      subtitle={hasGoalBalance ? `${safety} day${safety === 1 ? '' : 's'} of essentials covered` : 'Add your savings balance to measure it'}
      chevron
      onPress={() => router.navigate('/goals')}
    />,
    ...(pendingFound.length
      ? [
          <ListRow
            key="found"
            icon="sparkles"
            iconTone="green"
            title={`${fmt(pendingFound.reduce((a, f) => a + f.amount, 0))} found money waiting`}
            subtitle="Choose where it goes"
            chevron
            onPress={() => router.navigate('/goals')}
          />,
        ]
      : []),
  ];

  return (
    <Screen>
      {/* Header: date, large-title greeting, profile */}
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: space.lg }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt v="label" muted>
            {DAY_LONG[weekday(t)]} · {shortDate(t)}
          </Txt>
          <Txt v="title" numberOfLines={2} style={{ flexShrink: 1 }}>
            {greeting()}
            {name ? `, ${name}` : ''}
          </Txt>
        </View>
        <Touchable
          onPress={() => router.navigate('/profile')}
          accessibilityLabel="Profile"
          scaleTo={0.92}
          style={{ width: TOUCH, height: TOUCH, flexShrink: 0, borderRadius: TOUCH / 2, backgroundColor: tone('purple').bg, alignItems: 'center', justifyContent: 'center' }}>
          <Txt v="h3" color={tone('purple').fg}>
            {initial}
          </Txt>
        </Touchable>
      </Row>

      {s.income ? (
        <HeroCard
          label="Flexible this week"
          value={fmt(Math.max(0, Math.round(flexLeft)))}
          context={
            flexLeft >= 0
              ? `left of ${fmt(Math.round(flexWeek))} · resets in ${resetsIn} day${resetsIn === 1 ? '' : 's'}`
              : `${fmt(Math.abs(Math.round(flexLeft)))} past this week’s flexible money — next week’s plan can make it back`
          }
          cta={{ label: 'Details', onPress: () => router.navigate('/money') }}
          meter={
            flexWeek > 0
              ? { value: spentWeek / flexWeek, tone: flexLeft >= 0 ? 'green' : 'amber', accessibilityLabel: `${Math.round((spentWeek / flexWeek) * 100)}% of this week’s flexible money spent` }
              : undefined
          }>
          {glance}
        </HeroCard>
      ) : (
        <>
          <Card style={{ gap: space.sm }}>
            <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
              <View style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: tone('purple').bg, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="document-text" size={18} color={tone('purple').fg} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt v="h3">Let your budget build itself</Txt>
                <Txt v="small" muted>
                  Add a text-based payslip or bank statement PDF and we’ll find your income, bills and real food spend.
                </Txt>
              </View>
            </Row>
            <Button label="Add a document" icon="add" onPress={() => router.push('/upload')} />
          </Card>
          <Group style={{ marginTop: space.sm }}>{glance}</Group>
        </>
      )}

      {s.manualMode && s.income ? (
        <Group style={{ marginTop: space.sm }}>
          <ListRow icon="sparkles-outline" iconTone="purple" title="Using your own numbers" subtitle="Add a statement to replace them with real bills and spending" chevron onPress={() => router.push('/upload')} />
        </Group>
      ) : null}

      {hasFinancialData && risky?.risky && s.settings.riskAlerts ? <RiskyDayCallout day={DAY_LONG[weekday(t)]} average={fmt(risky.avg)} /> : null}

      {/* Today's meals as one grouped table */}
      {todayPlan ? (
        <Section title="Today’s meals" action={{ label: 'Week', onPress: () => router.navigate('/meals') }}>
          <Group inset={56}>
            {MEAL_SLOTS.map((slot) => (
              <MealCard key={slot} compact slotLabel={SLOT_LABEL[slot]} meal={todayPlan.slots[slot]} onPress={() => router.push(`/meal/${dayIdx}-${slot}`)} />
            ))}
            <ListRow icon="add-circle-outline" iconTone="green" title="Add or edit meals" subtitle="Your own meals join the plan" chevron onPress={() => router.push('/recipes')} />
          </Group>
        </Section>
      ) : null}

      <Section title="Insight of the day" action={insights.length > 1 ? { label: `All ${insights.length}`, onPress: () => router.push('/insights') } : undefined}>
        {insights[0] ? (
          <InsightCard insight={insights[0]} compact />
        ) : (
          <Card>
            <Txt v="small" muted>
              {hasFinancialData ? 'Nothing to change today — you’re on plan.' : 'Insights appear once your real financial data is in.'}
            </Txt>
          </Card>
        )}
      </Section>

      {showStatementPrompt && s.income ? (
        <Group style={{ marginTop: space.sm }}>
          <ListRow icon="reader-outline" iconTone="purple" title="Add this month’s statement" subtitle="Keeps your forecast and insights sharp" chevron onPress={() => router.push('/upload')} />
        </Group>
      ) : null}

      <Section title="Quick actions">
        <Row gap={space.sm - 2}>
          {[
            { icon: 'receipt-outline', label: 'Add receipt', onPress: () => router.push({ pathname: '/upload', params: { mode: 'receipt' } }) },
            { icon: 'restaurant-outline', label: 'Plan dinner', onPress: () => router.navigate('/meals') },
            { icon: 'swap-vertical-outline', label: 'Move money', onPress: () => router.navigate('/goals') },
          ].map((a) => (
            <Card key={a.label} onPress={a.onPress} style={{ flex: 1, alignItems: 'center', gap: space.xs, paddingVertical: space.md, minHeight: 88 }} accessibilityLabel={a.label}>
              <Icon name={a.icon} size={24} color={c.primary} />
              <Txt v="caption" center>
                {a.label}
              </Txt>
            </Card>
          ))}
        </Row>
      </Section>
    </Screen>
  );
}

/**
 * Risky-day heads-up. Notifications are offered here — at the moment the user can
 * see what they'd get — rather than up front in onboarding.
 */
function RiskyDayCallout({ day, average }: { day: string; average: string }) {
  const { tone } = useTheme();
  const notifications = useStore((s) => s.settings.notifications);
  const setSettings = useStore((s) => s.setSettings);
  const [justEnabled, setJustEnabled] = useState(false);
  return (
    <Card style={{ marginTop: space.sm, gap: space.sm }}>
      <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
        <View style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: tone('amber').bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="restaurant" size={18} color={tone('amber').fg} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt v="h3">{day}s tend to run higher</Txt>
          <Txt v="small" muted>
            You’ve averaged {average} on eating out on {day}s. Tonight’s dinner is planned — cooking it keeps most of that.
          </Txt>
        </View>
      </Row>
      {!notifications ? (
        <Button
          label={`Remind me on ${day} mornings`}
          icon="notifications-outline"
          small
          variant="secondary"
          onPress={() => {
            success();
            setSettings({ notifications: true, riskAlerts: true });
            setJustEnabled(true);
          }}
        />
      ) : justEnabled ? (
        <Row gap={6}>
          <Icon name="checkmark-circle" size={16} color={tone('green').fg} />
          <Txt v="caption" color={tone('green').fg}>
            We’ll send one friendly nudge on mornings like this. Change it anytime in Profile.
          </Txt>
        </Row>
      ) : null}
    </Card>
  );
}
