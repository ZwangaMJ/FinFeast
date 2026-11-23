import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { FoodImage, ProviderLink } from '@/components/FoodImage';
import { GroceryForm } from '@/components/GroceryForm';
import { Button, Card, EmptyState, Icon, IconButton, Pill, Row, Screen, Txt, useCurrency } from '@/components/ui';
import { foodActions, useGroceries } from '@/hooks/useFood';
import { getIngredient, getRecipe, hasRecipe, VIRTUAL_PREFIX } from '@/lib/catalog';
import { DAY_SHORT, weekday } from '@/lib/dates';
import { money, PRICE_FACTOR } from '@/lib/format';
import { buildGroceryList, estimateRange } from '@/lib/mealPlanner';
import type { Currency, GroceryEntry } from '@/store/types';
import { useStore } from '@/store/useStore';
import { space, useTheme } from '@/theme';

/** A user item's cost in the profile currency (items keep the currency they were entered in). */
const itemCost = (g: GroceryEntry, currency: Currency) => (g.estCost === null ? 0 : (g.estCost / PRICE_FACTOR[g.costCurrency]) * PRICE_FACTOR[currency]);

function Checkbox({ done }: { done: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: done ? c.primary : c.border, backgroundColor: done ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
      {done ? <Icon name="checkmark" size={16} color={c.onPrimary} /> : null}
    </View>
  );
}

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
  const mine = useGroceries();
  const [editing, setEditing] = useState<GroceryEntry | 'new' | null>(null);

  const items = useMemo(() => (plan ? buildGroceryList(plan.days, household, pantry.map((p) => p.key), currency) : []), [plan, household, pantry, currency]);
  const toBuy = items.filter((i) => i.packs > 0);
  const inPantry = items.filter((i) => i.packs === 0);
  const total = toBuy.reduce((a, i) => a + i.estPrice, 0) + mine.reduce((a, g) => a + itemCost(g, currency), 0);
  const [lo, hi] = estimateRange(total);
  const left = toBuy.filter((i) => !checked.includes(i.id)).reduce((a, i) => a + i.estPrice, 0) + mine.filter((g) => !g.checked).reduce((a, g) => a + itemCost(g, currency), 0);
  const aisles = [...new Set(toBuy.map((i) => i.aisle))];
  const anyChecked = checked.length > 0 || mine.some((g) => g.checked);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/meals'));

  if (!plan && !mine.length) {
    return (
      <Screen back={back}>
        <EmptyState icon="cart-outline" title="No list yet" body="Build a meal plan and your grocery list writes itself, or add your own items." action={<Button label="Add item" icon="add" onPress={() => setEditing('new')} />} />
        <GroceryForm key="new" visible={editing === 'new'} onClose={() => setEditing(null)} />
      </Screen>
    );
  }

  return (
    <Screen title="Grocery list" back={back} right={<IconButton icon="cube-outline" label="Pantry" onPress={() => router.push('/pantry?returnTo=grocery')} />}>
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

      <View style={{ marginTop: 18, gap: 8 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="label" muted>
            My items
          </Txt>
          <Button label="Add item" icon="add" small variant="ghost" onPress={() => setEditing('new')} accessibilityLabel="Add grocery item" />
        </Row>
        {mine.length ? (
          <Card padded={false} style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
            {mine.map((g) => {
              const meal = g.mealId && hasRecipe(g.mealId) ? getRecipe(g.mealId).name : null;
              const qty = [g.quantity ?? null, g.unit].filter((x) => x !== null && x !== '').join(' ');
              const detail = [qty, meal ? `for ${meal}` : null].filter(Boolean).join(' · ');
              return (
                <Row key={g.id} gap={10} style={{ minHeight: 56, paddingVertical: 6 }}>
                  <Pressable
                    onPress={() => foodActions.toggleGroceryItem(g.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: g.checked }}
                    aria-checked={g.checked}
                    accessibilityLabel={`${g.name}${detail ? `, ${detail}` : ''}`}
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Checkbox done={g.checked} />
                    <FoodImage query={g.name} fallbackEmoji={g.emoji} kind="grocery" image={g.image} tint="blue" size={36} />
                    <View style={{ flex: 1, opacity: g.checked ? 0.5 : 1 }}>
                      <Txt v="bodyStrong" style={g.checked ? { textDecorationLine: 'line-through' } : undefined}>
                        {g.name}
                      </Txt>
                      {detail ? (
                        <Txt v="caption" muted>
                          {detail}
                        </Txt>
                      ) : null}
                    </View>
                    {g.estCost !== null ? (
                      <Txt v="smallStrong" tabular>
                        {money(itemCost(g, currency), currency)}
                      </Txt>
                    ) : null}
                  </Pressable>
                  <IconButton icon="create-outline" label={`Edit ${g.name}`} onPress={() => setEditing(g)} />
                  <IconButton icon="trash-outline" label={`Delete ${g.name}`} onPress={() => foodActions.deleteGroceryItem(g.id)} />
                </Row>
              );
            })}
          </Card>
        ) : (
          <Txt v="small" muted>
            Add anything the meal plan doesn’t cover, like toiletries or a treat.
          </Txt>
        )}
      </View>

      {plan
        ? aisles.map((aisle) => (
            <View key={aisle} style={{ marginTop: 18, gap: 8 }}>
              <Txt v="label" muted>
                {aisle === 'Other' ? 'Your meals' : aisle}
              </Txt>
              <Card padded={false} style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
                {toBuy
                  .filter((i) => i.aisle === aisle)
                  .map((i) => {
                    const done = checked.includes(i.id);
                    const custom = i.key.startsWith(VIRTUAL_PREFIX) ? getRecipe(i.key.slice(VIRTUAL_PREFIX.length)).customIngredients?.map((x) => x.name) : undefined;
                    return (
                      <Pressable
                        key={i.id}
                        onPress={() => toggle(i.id)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: done }}
                        aria-checked={done}
                        accessibilityLabel={`${i.name}, ${i.qty}, ${money(i.estPrice, currency)}`}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 6 }}>
                        <Checkbox done={done} />
                        <View style={{ flex: 1, opacity: done ? 0.5 : 1 }}>
                          <Txt v="bodyStrong" style={done ? { textDecorationLine: 'line-through' } : undefined}>
                            {i.name}
                          </Txt>
                          <Txt v="caption" muted>
                            {i.qty} · {i.usedIn.map((d) => DAY_SHORT[weekday(plan.days[d].date)]).join(', ')}
                            {custom?.length ? ` · ${custom.join(', ')}` : ''}
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
          ))
        : null}

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
                {getIngredient(i.key).staple ? (
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

      {anyChecked ? <Button label="Clear ticks" variant="ghost" tone="gray" style={{ marginTop: 16 }} onPress={clear} /> : null}

      {mine.find((g) => g.image) ? (
        <View style={{ marginTop: space.md, alignSelf: 'center' }}>
          <ProviderLink provider={mine.find((g) => g.image)?.image?.provider} />
        </View>
      ) : null}

      <GroceryForm key={editing === 'new' ? 'new' : (editing?.id ?? 'closed')} visible={editing !== null} item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
    </Screen>
  );
}
