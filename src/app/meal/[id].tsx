import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { MealTile } from '@/components/cards';
import { Button, Card, Divider, EmptyState, Icon, Pill, Row, Screen, Section, ToggleRow, Txt, useCurrency } from '@/components/ui';
import { INGREDIENTS, RECIPE_BY_ID } from '@/data/recipes';
import { DAY_LONG, weekday } from '@/lib/dates';
import { money } from '@/lib/format';
import { servingCost, swapOptions, unitPrice } from '@/lib/mealPlanner';
import type { MealSlot } from '@/store/types';
import { useStore } from '@/store/useStore';
import { useTheme } from '@/theme';

export default function MealDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [dayStr, slotStr] = (id ?? '').split('-');
  const day = Number(dayStr);
  const slot = slotStr as MealSlot;
  const { c, tone } = useTheme();
  const currency = useCurrency();
  const plan = useStore((s) => s.plan);
  const household = useStore((s) => s.profile.householdSize);
  const pantry = useStore((s) => s.pantry);
  const toggleSwap = useStore((s) => s.toggleSwap);
  const regenerateMeal = useStore((s) => s.regenerateMeal);
  const markCooked = useStore((s) => s.markCooked);
  const meal = plan?.days[day]?.slots[slot];

  if (!plan || !meal) {
    return (
      <Screen back={() => router.back()}>
        <EmptyState icon="restaurant-outline" title="Meal not found" body="This plan may have been regenerated." />
      </Screen>
    );
  }

  const r = RECIPE_BY_ID[meal.recipeId];
  const perServing = servingCost(r.id, meal.swaps, currency);
  const swaps = swapOptions(r.id, currency);
  const fmt2 = (n: number) => money(n, currency, { decimals: 2 });
  const isLeftover = meal.leftoverOf !== undefined;

  return (
    <Screen
      back={() => router.back()}
      edges={['top', 'bottom']}
      footer={
        <Row gap={10}>
          <Button label="Swap meal" icon="shuffle-outline" variant="secondary" style={{ flex: 1 }} onPress={() => regenerateMeal(day, slot)} />
          <Button label={meal.cooked ? 'Cooked ✓' : 'Cooked it'} icon={meal.cooked ? undefined : 'checkmark'} style={{ flex: 1 }} onPress={() => markCooked(day, slot, !meal.cooked)} />
        </Row>
      }>
      <View style={{ alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <MealTile emoji={r.emoji} tint={r.tint} size={120} />
        <Txt v="label" muted>
          {DAY_LONG[weekday(plan.days[day].date)]} · {slot}
        </Txt>
        <Txt v="title" center>
          {r.name}
        </Txt>
        <Row gap={6} wrap style={{ justifyContent: 'center' }}>
          <Pill label={`${r.kcal} kcal`} icon="flame-outline" tone="green" />
          <Pill label={`${r.protein} g protein`} icon="barbell-outline" tone="green" />
          <Pill label={`${r.minutes} min`} icon="time-outline" tone="gray" />
          {r.vegan ? <Pill label="Vegan" tone="green" /> : r.meat === 'none' ? <Pill label="Vegetarian" tone="green" /> : null}
          {r.batch ? <Pill label="Batch-friendly" tone="amber" icon="layers-outline" /> : null}
        </Row>
      </View>

      <Card style={{ gap: 4 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <Txt v="display">{fmt2(perServing)}</Txt>
            <Txt v="small" muted>
              per serving
            </Txt>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Txt v="h2" tabular>
              {fmt2(perServing * household)}
            </Txt>
            <Txt v="small" muted>
              for {household} {household === 1 ? 'person' : 'people'}
            </Txt>
          </View>
        </Row>
        {isLeftover ? (
          <Row gap={6} style={{ marginTop: 8 }}>
            <Icon name="layers-outline" size={16} color={c.amber} />
            <Txt v="small" color={c.amber}>
              Leftovers from {DAY_LONG[weekday(plan.days[meal.leftoverOf!].date)]}’s dinner — no extra cooking.
            </Txt>
          </Row>
        ) : meal.batchNote ? (
          <Row gap={6} style={{ marginTop: 8 }}>
            <Icon name="layers-outline" size={16} color={c.amber} />
            <Txt v="small" color={c.amber}>
              {meal.batchNote} — cook a double batch.
            </Txt>
          </Row>
        ) : null}
      </Card>

      {swaps.length ? (
        <Section title="Cheaper swaps">
          <Card tone="green" style={{ gap: 2 }}>
            {swaps.map((sw) => (
              <ToggleRow
                key={sw.key}
                icon="swap-horizontal-outline"
                title={sw.label}
                subtitle={`${sw.from} → ${sw.to} · saves ${fmt2(sw.saving * household)}`}
                value={meal.swaps.includes(sw.key)}
                onChange={() => toggleSwap(day, slot, sw.key)}
              />
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Ingredients">
        <Card style={{ gap: 2 }}>
          {r.ingredients.map((i, idx) => {
            const ing = INGREDIENTS[i.key];
            const swapped = meal.swaps.includes(i.key) && !!ing.swap;
            const inPantry = pantry.some((p) => p.key === i.key) || ing.staple;
            return (
              <View key={i.key}>
                <Row gap={10} style={{ minHeight: 44 }}>
                  <View style={{ flex: 1 }}>
                    <Txt v="bodyStrong">{swapped ? ing.swap!.name : ing.name}</Txt>
                    <Txt v="caption" muted>
                      ≈ {Math.round(i.use * household * 100)}% of a {ing.pack} pack
                    </Txt>
                  </View>
                  {inPantry ? <Pill label="Pantry" tone="blue" /> : null}
                  <Txt v="small" tabular>
                    {fmt2(i.use * household * unitPrice(i.key, swapped, currency))}
                  </Txt>
                </Row>
                {idx < r.ingredients.length - 1 ? <Divider style={{ marginVertical: 2 }} /> : null}
              </View>
            );
          })}
        </Card>
        <Txt v="caption" muted style={{ marginTop: 6 }}>
          Cost shares are what this meal uses; your grocery list buys whole packs and shares them across the week.
        </Txt>
      </Section>

      {r.steps.length ? (
        <Section title="Method">
          <Card style={{ gap: 12 }}>
            {r.steps.map((st, i) => (
              <Row key={i} gap={12} style={{ alignItems: 'flex-start' }}>
                <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: tone('amber').bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt v="caption" color={tone('amber').fg}>
                    {i + 1}
                  </Txt>
                </View>
                <Txt style={{ flex: 1 }}>{st}</Txt>
              </Row>
            ))}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
