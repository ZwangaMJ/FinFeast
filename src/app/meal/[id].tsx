import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { FoodImage } from '@/components/FoodImage';
import { GroceryForm } from '@/components/GroceryForm';
import { Button, Card, Divider, EmptyState, Icon, IconButton, Pill, Row, Screen, Section, Sheet, ToggleRow, Txt, useCurrency } from '@/components/ui';
import { foodActions, useGroceries } from '@/hooks/useFood';
import { getIngredient, getRecipe, isBuiltInRecipeId, VIRTUAL_PREFIX } from '@/lib/catalog';
import { DAY_LONG, weekday } from '@/lib/dates';
import { money } from '@/lib/format';
import { servingCost, swapOptions, unitPrice } from '@/lib/mealPlanner';
import type { MealSlot } from '@/store/types';
import { useStore } from '@/store/useStore';
import { radius, useTheme } from '@/theme';

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
  const groceries = useGroceries();
  const [addingItem, setAddingItem] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!plan || !meal) {
    return (
      <Screen back={() => router.back()}>
        <EmptyState icon="restaurant-outline" title="Meal not found" body="This plan may have been regenerated." />
      </Screen>
    );
  }

  const r = getRecipe(meal.recipeId);
  const perServing = servingCost(r.id, meal.swaps, currency);
  const swaps = swapOptions(r.id, currency);
  const fmt2 = (n: number) => money(n, currency, { decimals: 2 });
  const isLeftover = meal.leftoverOf !== undefined;
  const builtIn = isBuiltInRecipeId(r.id);
  const userPriced = r.ingredients.length === 1 && r.ingredients[0].key.startsWith(VIRTUAL_PREFIX);
  const linked = groceries.filter((g) => g.mealId === r.id);

  const remove = () => {
    setConfirmDelete(false);
    foodActions.deleteMeal(r.id);
    router.back();
  };

  return (
    <Screen
      back={() => router.back()}
      edges={['top', 'bottom']}
      right={
        <Row gap={4}>
          <IconButton icon="create-outline" label="Edit meal" onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: r.id } })} />
          <IconButton icon="trash-outline" label={builtIn ? 'Remove meal from my meals' : 'Delete meal'} onPress={() => setConfirmDelete(true)} />
        </Row>
      }
      footer={
        <Row gap={10}>
          <Button label="Swap meal" icon="shuffle-outline" variant="secondary" style={{ flex: 1 }} onPress={() => regenerateMeal(day, slot)} />
          <Button label={meal.cooked ? 'Cooked ✓' : 'Cooked it'} icon={meal.cooked ? undefined : 'checkmark'} style={{ flex: 1 }} onPress={() => markCooked(day, slot, !meal.cooked)} />
        </Row>
      }>
      <View style={{ alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <FoodImage query={r.name} fallbackEmoji={r.emoji} tint={r.tint} image={r.image} aspectRatio={4 / 3} radius={radius.lg} showAttribution />
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

      {userPriced ? (
        <Section title="Ingredients">
          <Card style={{ gap: 2 }}>
            {r.customIngredients?.length ? (
              r.customIngredients.map((i, idx) => (
                <View key={`${i.name}-${idx}`}>
                  <Row gap={10} style={{ minHeight: 44 }}>
                    <Txt v="bodyStrong" style={{ flex: 1 }}>
                      {i.name}
                    </Txt>
                    {i.qty !== null && i.qty !== undefined ? (
                      <Txt v="small" muted tabular>
                        {i.qty} {i.unit ?? ''}
                      </Txt>
                    ) : null}
                  </Row>
                  {idx < r.customIngredients!.length - 1 ? <Divider style={{ marginVertical: 2 }} /> : null}
                </View>
              ))
            ) : (
              <Txt muted>No ingredients listed. Edit the meal to add some.</Txt>
            )}
          </Card>
          <Txt v="caption" muted style={{ marginTop: 6 }}>
            Costed at your estimate of {fmt2(perServing)} per serving.
          </Txt>
        </Section>
      ) : (
      <Section title="Ingredients">
        <Card style={{ gap: 2 }}>
          {r.ingredients.map((i, idx) => {
            const ing = getIngredient(i.key);
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
      )}

      <Section title="Shopping for this meal" action={{ label: 'Add item', onPress: () => setAddingItem(true) }}>
        {linked.length ? (
          <Card style={{ gap: 2 }}>
            {linked.map((g) => (
              <Pressable key={g.id} onPress={() => foodActions.toggleGroceryItem(g.id)} accessibilityRole="checkbox" accessibilityState={{ checked: g.checked }} aria-checked={g.checked} accessibilityLabel={g.name}>
                <Row gap={10} style={{ minHeight: 44 }}>
                  <Icon name={g.checked ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={g.checked ? c.primary : c.textFaint} />
                  <Txt style={[{ flex: 1 }, g.checked ? { textDecorationLine: 'line-through', color: c.textMuted } : null]}>{g.name}</Txt>
                  {g.quantity !== null ? (
                    <Txt v="small" muted tabular>
                      {g.quantity} {g.unit ?? ''}
                    </Txt>
                  ) : null}
                </Row>
              </Pressable>
            ))}
          </Card>
        ) : (
          <Txt v="small" muted>
            Extra items for this meal go on your grocery list.
          </Txt>
        )}
      </Section>

      {r.notes ? (
        <Section title="Notes">
          <Card>
            <Txt>{r.notes}</Txt>
          </Card>
        </Section>
      ) : null}

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

      <GroceryForm key={`add-${r.id}`} visible={addingItem} onClose={() => setAddingItem(false)} mealId={r.id} mealName={r.name} />

      <Sheet
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={builtIn ? 'Remove this meal?' : 'Delete this meal?'}
        footer={
          <Row gap={10}>
            <Button label="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setConfirmDelete(false)} />
            <Button label={builtIn ? 'Remove' : 'Delete'} tone="red" style={{ flex: 1 }} onPress={remove} />
          </Row>
        }>
        <Txt muted>
          {builtIn
            ? `${r.name} won't be planned for you any more, and this slot gets a new meal. You can bring it back from My meals.`
            : `${r.name} will be deleted, along with grocery items you added for it. This slot gets a new meal.`}
        </Txt>
      </Sheet>
    </Screen>
  );
}
