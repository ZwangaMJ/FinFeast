import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { DocumentFlow } from '@/components/DocumentFlow';
import { MealTile } from '@/components/cards';
import { AmountInput, Button, Card, Chip, Field, Icon, Row, Screen, Stepper, Txt, TrustStrip } from '@/components/ui';
import { RECIPE_BY_ID } from '@/data/recipes';
import { weeklyFlexible } from '@/lib/budget';
import { DAY_SHORT, weekday } from '@/lib/dates';
import { CURRENCY_LABELS, money, PRICE_FACTOR } from '@/lib/format';
import { success } from '@/lib/haptics';
import { estimateRange, planCost } from '@/lib/mealPlanner';
import type { Allergen, Currency, DietPattern, GoalPriority } from '@/store/types';
import { useStore } from '@/store/useStore';
import { useTheme } from '@/theme';

const DIETS: { v: DietPattern; l: string }[] = [
  { v: 'omnivore', l: 'Everything' },
  { v: 'vegetarian', l: 'Vegetarian' },
  { v: 'vegan', l: 'Vegan' },
  { v: 'pescatarian', l: 'Pescatarian' },
  { v: 'halal', l: 'Halal' },
  { v: 'kosher', l: 'Kosher' },
];
const ALLERGENS: { v: Allergen; l: string }[] = [
  { v: 'gluten', l: 'Gluten' },
  { v: 'dairy', l: 'Dairy' },
  { v: 'nuts', l: 'Nuts' },
  { v: 'eggs', l: 'Eggs' },
  { v: 'fish', l: 'Fish' },
  { v: 'soy', l: 'Soy' },
];
const PRIORITIES: { v: GoalPriority; l: string; icon: string }[] = [
  { v: 'safety', l: 'Build a safety net', icon: 'shield-checkmark-outline' },
  { v: 'debt', l: 'Pay down debt', icon: 'trending-down-outline' },
  { v: 'invest', l: 'Start investing', icon: 'trending-up-outline' },
  { v: 'understand', l: 'Just understand my money', icon: 'eye-outline' },
];

export default function Onboarding() {
  const [step, setStep] = useState(1);
  const [docReady, setDocReady] = useState(false);
  const [manual, setManual] = useState(false);

  const next = (n?: number) => setStep((s) => n ?? s + 1);

  return (
    <Screen edges={['top', 'bottom']}>
      {step > 1 && step < 5 ? <Progress step={step} onBack={() => (manual ? setManual(false) : setStep((s) => (s === 4 && docReady ? 2 : s - 1)))} /> : null}
      {step === 1 ? (
        <Welcome
          onStart={() => next(2)}
          onDoc={() => {
            setDocReady(true);
            next(2);
          }}
        />
      ) : null}
      {step === 2 ? <Account onDone={() => next(docReady ? 4 : 3)} /> : null}
      {step === 3 ? <ProfileSnapshot onDone={() => next(4)} /> : null}
      {step === 4 && !manual ? (
        <DocumentFlow mode="onboarding" onDone={() => next(5)} onManual={() => setManual(true)} />
      ) : null}
      {step === 4 && manual ? <ManualMode onDone={() => next(5)} /> : null}
      {step === 5 ? <FirstPlan /> : null}
    </Screen>
  );
}

function Progress({ step, onBack }: { step: number; onBack: () => void }) {
  const { c } = useTheme();
  return (
    <Row style={{ marginBottom: 18 }} gap={12}>
      <Button label="Back" icon="chevron-back" variant="ghost" tone="gray" small onPress={onBack} />
      <Row gap={6} style={{ flex: 1, justifyContent: 'flex-end' }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <View key={i} style={{ width: i === step ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i <= step ? c.primary : c.border }} />
        ))}
      </Row>
      <Txt v="caption" muted accessibilityLabel={`Step ${step} of 5`}>
        {step}/5
      </Txt>
    </Row>
  );
}

function Welcome({ onStart, onDoc }: { onStart: () => void; onDoc: () => void }) {
  const { tone } = useTheme();
  return (
    <View style={{ gap: 18, paddingTop: 24 }}>
      <View style={{ alignSelf: 'flex-start', flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: tone('green').bg, alignItems: 'center', justifyContent: 'center' }}>
          <Txt style={{ fontSize: 24, lineHeight: 30 }}>🌱</Txt>
        </View>
        <Txt v="h2">FinFeast</Txt>
      </View>
      <Txt v="hero" style={{ fontSize: 40, lineHeight: 46 }}>
        Eat well. Spend less. Grow the difference.
      </Txt>
      <Txt muted style={{ fontSize: 17, lineHeight: 25 }}>
        Food is the part of your budget you control most. FinFeast plans your meals around your money — and sends every rand you don’t spend to your savings.
      </Txt>
      <View style={{ gap: 10, marginTop: 6 }}>
        {[
          { icon: 'document-text-outline', t: 'Add a payslip or statement — your budget builds itself' },
          { icon: 'restaurant-outline', t: 'Get a weekly meal plan priced to fit' },
          { icon: 'leaf-outline', t: 'Watch the money you find grow your safety net' },
        ].map((x) => (
          <Row key={x.t} gap={12}>
            <Icon name={x.icon} size={20} color={tone('green').fg} />
            <Txt style={{ flex: 1 }}>{x.t}</Txt>
          </Row>
        ))}
      </View>
      <TrustStrip text="Your data stays on this device for now. Delete everything anytime." />
      <Button label="Start free" onPress={onStart} style={{ marginTop: 6 }} />
      <Button label="I have a document ready" variant="secondary" icon="document-attach-outline" onPress={onDoc} />
    </View>
  );
}

function Account({ onDone }: { onDone: () => void }) {
  const setProfile = useStore((s) => s.setProfile);
  const savedProfile = useStore((s) => s.profile);
  const [name, setName] = useState(savedProfile.name);
  const finish = () => {
    setProfile({ ...(name.trim() ? { name: name.trim() } : {}) });
    onDone();
  };
  return (
    <View style={{ gap: 14 }}>
      <Txt v="title">Set up your profile</Txt>
      <Txt muted>No sign-in needed. Your data stays on this device while account sync is being set up.</Txt>
      <Field label="What should we call you?" value={name} onChange={setName} placeholder="First name" />
      <Button label="Continue" onPress={finish} />
    </View>
  );
}

function ProfileSnapshot({ onDone }: { onDone: () => void }) {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const toggleAllergy = (a: Allergen) => setProfile({ allergies: profile.allergies.includes(a) ? profile.allergies.filter((x) => x !== a) : [...profile.allergies, a] });
  return (
    <View style={{ gap: 16 }}>
      <Txt v="title">A quick snapshot</Txt>
      <Txt muted>About a minute. This shapes your meal plans and goals — skip anything.</Txt>
      <Card style={{ gap: 10 }}>
        <Txt v="h3">How many people do you cook for?</Txt>
        <Stepper value={profile.householdSize} min={1} max={10} onChange={(n) => setProfile({ householdSize: n })} />
      </Card>
      <Card style={{ gap: 10 }}>
        <Txt v="h3">Where do you shop?</Txt>
        <Row gap={8} wrap>
          {(Object.keys(CURRENCY_LABELS) as Currency[]).map((cur) => (
            <Chip key={cur} label={CURRENCY_LABELS[cur]} selected={profile.currency === cur} onPress={() => setProfile({ currency: cur })} />
          ))}
        </Row>
      </Card>
      <Card style={{ gap: 10 }}>
        <Txt v="h3">How do you eat?</Txt>
        <Row gap={8} wrap>
          {DIETS.map((d) => (
            <Chip key={d.v} label={d.l} selected={profile.diet === d.v} onPress={() => setProfile({ diet: d.v })} />
          ))}
        </Row>
        <Txt v="h3" style={{ marginTop: 6 }}>
          Allergies or foods to avoid
        </Txt>
        <Row gap={8} wrap>
          {ALLERGENS.map((a) => (
            <Chip key={a.v} label={a.l} tone="red" selected={profile.allergies.includes(a.v)} onPress={() => toggleAllergy(a.v)} />
          ))}
        </Row>
      </Card>
      <Card style={{ gap: 10 }}>
        <Txt v="h3">What matters most right now?</Txt>
        <Row gap={8} wrap>
          {PRIORITIES.map((p) => (
            <Chip key={p.v} label={p.l} icon={p.icon} tone="blue" selected={profile.goalPriority === p.v} onPress={() => setProfile({ goalPriority: p.v })} />
          ))}
        </Row>
      </Card>
      <Button label="Continue" onPress={onDone} />
      <Button label="Skip for now" variant="ghost" tone="gray" onPress={onDone} />
    </View>
  );
}

function ManualMode({ onDone }: { onDone: () => void }) {
  const currency = useStore((s) => s.profile.currency);
  const setManual = useStore((s) => s.setManualBaseline);
  const f = PRICE_FACTOR[currency];
  const [income, setIncome] = useState('');
  const [food, setFood] = useState(String(Math.round(700 * f)));
  const ok = parseFloat(income) > 0 && parseFloat(food) > 0;
  return (
    <View style={{ gap: 16 }}>
      <Txt v="title">Two numbers to start</Txt>
      <Txt muted>Rough is fine — you can add a document later and we’ll sharpen everything.</Txt>
      <AmountInput label="Monthly take-home pay" value={income} onChange={setIncome} autoFocus />
      <AmountInput label="Weekly food budget (groceries)" value={food} onChange={setFood} />
      <Button
        label="Build my plan"
        disabled={!ok}
        onPress={() => {
          setManual(parseFloat(income), parseFloat(food));
          onDone();
        }}
      />
    </View>
  );
}

function FirstPlan() {
  const { tone } = useTheme();
  const complete = useStore((s) => s.completeOnboarding);
  const s = useStore();
  const setSettings = useStore((st) => st.setSettings);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    complete();
    success();
  }, [complete]);

  const c = s.profile.currency;
  const flex = Math.max(0, Math.round(weeklyFlexible(s.income, s.bills, s.goals) / 10) * 10);
  const ef = s.goals.find((g) => g.type === 'emergency');
  const plan = s.plan;
  const est = plan ? planCost(plan.days, s.profile.householdSize, s.pantry.map((p) => p.key), c) : 0;
  const [lo, hi] = estimateRange(est);

  return (
    <View style={{ gap: 14, paddingTop: 12 }}>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Txt style={{ fontSize: 56, lineHeight: 66 }}>🎉</Txt>
        <Txt v="title" center>
          {s.profile.name ? `You’re set, ${s.profile.name}` : 'You’re all set'}
        </Txt>
      </View>
      <Card style={{ gap: 4 }}>
        <Txt v="label" color={tone('green').fg}>
          Flexible this week
        </Txt>
        <Txt v="hero">{money(flex, c)}</Txt>
        <Txt muted>After bills and savings — yours to spend well.</Txt>
      </Card>
      {plan ? (
        <Card style={{ gap: 10 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt v="h3">Your first dinners</Txt>
            <Txt v="small" muted tabular>
              Week ≈ {money(lo, c)}–{money(hi, c)}
            </Txt>
          </Row>
          {plan.days.slice(0, 3).map((d) => {
            const r = RECIPE_BY_ID[d.slots.dinner.recipeId];
            return (
              <Row key={d.date} gap={12}>
                <MealTile emoji={r.emoji} tint={r.tint} size={44} />
                <View style={{ flex: 1 }}>
                  <Txt v="caption" muted>
                    {DAY_SHORT[weekday(d.date)]}
                  </Txt>
                  <Txt v="bodyStrong">{r.name}</Txt>
                </View>
              </Row>
            );
          })}
          <Txt v="caption" muted>
            The full week is ready in Meals.
          </Txt>
        </Card>
      ) : null}
      {ef ? (
        <Card tone="blue" style={{ gap: 4 }}>
          <Row gap={8}>
            <Icon name="shield-checkmark-outline" color={tone('blue').fg} />
            <Txt v="h3" color={tone('blue').fg}>
              Emergency Fund created
            </Txt>
          </Row>
          <Txt v="small" muted>
            Target {money(ef.target, c)} — about 3 months of essentials. Grocery underspend flows here automatically.
          </Txt>
        </Card>
      ) : null}
      {!asked ? (
        <Card tone="amber" style={{ gap: 8 }}>
          <Txt v="h3">Get your Friday takeaway alert?</Txt>
          <Txt v="small" muted>
            One friendly nudge on days you tend to spend more, and when found money is waiting. Never more than one tip at a time.
          </Txt>
          <Row gap={8}>
            <Button
              label="Turn on"
              small
              tone="amber"
              variant="tonal"
              onPress={() => {
                setSettings({ notifications: true, riskAlerts: true });
                setAsked(true);
              }}
            />
            <Button label="Not now" small variant="ghost" tone="gray" onPress={() => setAsked(true)} />
          </Row>
        </Card>
      ) : null}
      <Button label="See this week’s plan" icon="arrow-forward" onPress={() => router.replace('/meals')} />
    </View>
  );
}
