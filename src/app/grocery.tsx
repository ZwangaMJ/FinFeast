import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Card, EmptyState, Icon, IconButton, Pill, Row, Screen, Txt, useCurrency } from '@/components/ui';
import { INGREDIENTS } from '@/data/recipes';
import { DAY_SHORT, weekday } from '@/lib/dates';
import { money } from '@/lib/format';
import { buildGroceryList, estimateRange } from '@/lib/mealPlanner';
import { useStore } from '@/store/useStore';
import { useTheme } from '@/theme';

export default function Grocery() {
  const { c } = useTheme();
  const currency = useCurrency();
  const plan = useStore((s) => s.plan);
  const household = useStore((s) => s.profile.householdSize);
  const pantry = useStore((s) => s.pantry);
  const checked = useStore((s) => s.groceryChecked);
  const toggle = useStore((s) => s.toggleGrocery);
  const clear = useStore((s) => s.clearGroceryChecks);
  const togglePantry = useStore((s) => s.togglePantry);

  const items = useMemo(() => (plan ? buildGroceryList(plan.days, household, pantry.map((p) => p.key), currency) : []), [plan, household, pantry, currency]);
  const toBuy = items.filter((i) => i.packs > 0);
  const inPantry = items.filter((i) => i.packs === 0);
  const total = toBuy.reduce((a, i) => a + i.estPrice, 0);
  const [lo, hi] = estimateRange(total);
  const left = toBuy.filter((i) => !checked.includes(i.id)).reduce((a, i) => a + i.estPrice, 0);
  const aisles = [...new Set(toBuy.map((i) => i.aisle))];

  if (!plan) {
    return (
      <Screen back={() => router.back()}>
        <EmptyState icon="cart-outline" title="No list yet" body="Build a meal plan and your grocery list writes itself." />
      </Screen>
    );
  }

  return (
    <Screen title="Grocery list" back={() => router.back()} right={<IconButton icon="cube-outline" label="Pantry" onPress={() => router.push('/pantry')} />}>
      <Card style={{ gap: 4, marginBottom: 6 }}>
        <Txt v="label" color={c.amber}>
          Estimated this week
        </Txt>
        <Txt v="hero">{money(total, currency)}</Txt>
        <Txt muted>
          Likely {money(lo, currency)}–{money(hi, currency)} · {money(left, currency)} still to buy
        </Txt>
        <Txt v="caption" muted style={{ marginTop: 4 }}>
          This becomes your food budget line in Money. Items are consolidated across meals — one cabbage, several dishes.
        </Txt>
      </Card>

      {aisles.map((aisle) => (
        <View key={aisle} style={{ marginTop: 18, gap: 8 }}>
          <Txt v="label" muted>
            {aisle}
          </Txt>
          <Card padded={false} style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
            {toBuy
              .filter((i) => i.aisle === aisle)
              .map((i) => {
                const done = checked.includes(i.id);
                return (
                  <Pressable
                    key={i.id}
                    onPress={() => toggle(i.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: done }}
                    accessibilityLabel={`${i.name}, ${i.qty}, ${money(i.estPrice, currency)}`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 6 }}>
                    <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: done ? c.primary : c.border, backgroundColor: done ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                      {done ? <Icon name="checkmark" size={16} color={c.onPrimary} /> : null}
                    </View>
                    <View style={{ flex: 1, opacity: done ? 0.5 : 1 }}>
                      <Txt v="bodyStrong" style={done ? { textDecorationLine: 'line-through' } : undefined}>
                        {i.name}
                      </Txt>
                      <Txt v="caption" muted>
                        {i.qty} · {i.usedIn.map((d) => DAY_SHORT[weekday(plan.days[d].date)]).join(', ')}
                      </Txt>
                    </View>
                    {i.id.endsWith('~swap') ? <Pill label="Swap" tone="green" /> : null}
                    <Txt v="smallStrong" tabular>
                      {money(i.estPrice, currency)}
                    </Txt>
                  </Pressable>
                );
              })}
          </Card>
        </View>
      ))}

      {inPantry.length ? (
        <View style={{ marginTop: 18, gap: 8 }}>
          <Txt v="label" muted>
            Already in your pantry
          </Txt>
          <Card style={{ gap: 6 }}>
            {inPantry.map((i) => (
              <Row key={i.id} gap={10}>
                <Pill label="Pantry" tone="blue" icon="cube-outline" />
                <Txt style={{ flex: 1 }}>{i.name}</Txt>
                {INGREDIENTS[i.key].staple ? (
                  <Txt v="caption" muted>
                    staple
                  </Txt>
                ) : (
                  <Button label="Ran out" small variant="ghost" tone="gray" onPress={() => togglePantry(i.key)} />
                )}
              </Row>
            ))}
            <Txt v="caption" muted>
              Staples like oil, spices and stock are assumed in your cupboard. Tap “Ran out” on anything else and the list re-prices.
            </Txt>
          </Card>
        </View>
      ) : null}

      {checked.length ? <Button label="Clear ticks" variant="ghost" tone="gray" style={{ marginTop: 16 }} onPress={clear} /> : null}
    </Screen>
  );
}
