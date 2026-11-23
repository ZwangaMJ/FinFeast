import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { FoodImage } from '@/components/FoodImage';
import { AmountInput, Button, Card, Chip, Field, IconButton, Row, Screen, Section, Segmented, Sheet, ToggleRow, Txt, useCurrency } from '@/components/ui';
import { foodActions, mealRowFor, useMeals } from '@/hooks/useFood';
import { getIngredient, isBuiltInRecipeId } from '@/lib/catalog';
import { servingCost } from '@/lib/mealPlanner';
import { blankMealInput, mealInputFromRecipe, type FieldErrors, type MealInput } from '@/store/food';
import type { Allergen, MealDiet, MealKind } from '@/store/types';
import { radius, space, useTheme } from '@/theme';

const SLOTS: { value: MealKind; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
];
const DIETS: { value: MealDiet; label: string }[] = [
  { value: 'vegan', label: 'Vegan' },
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'fish', label: 'Fish' },
  { value: 'poultry', label: 'Chicken' },
  { value: 'red', label: 'Red meat' },
];
const ALLERGENS: Allergen[] = ['gluten', 'dairy', 'nuts', 'eggs', 'fish', 'soy'];

type IngredientDraft = { name: string; qty: string; unit: string };

const numText = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(Math.round(n * 100) / 100));
const parseNum = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));

function ErrorText({ text }: { text?: string }) {
  const { c } = useTheme();
  return text ? (
    <Txt v="small" color={c.destructive} accessibilityLabel={`Error: ${text}`}>
      {text}
    </Txt>
  ) : null;
}

/** Create a meal (`/recipe/new?slot=dinner`) or edit any meal (`/recipe/<recipe id>`). */
export default function RecipeEditor() {
  const { id, slot: slotParam } = useLocalSearchParams<{ id: string; slot?: string }>();
  const currency = useCurrency();
  const { byId } = useMeals();
  const isNew = id === 'new';
  const recipe = isNew ? undefined : byId[id ?? ''];
  const builtIn = !!recipe && isBuiltInRecipeId(recipe.id);
  const row = recipe ? mealRowFor(recipe.id) : undefined;

  const initial = useMemo<MealInput>(() => {
    if (!recipe) return blankMealInput((SLOTS.find((s) => s.value === slotParam)?.value ?? 'dinner') as MealKind, currency);
    const userPriced = row ? row.costPerServing !== null : !builtIn;
    const base = mealInputFromRecipe(recipe, userPriced ? (row?.costPerServing ?? servingCost(recipe.id, [], currency)) : null, row?.costCurrency ?? currency);
    // Switching a built-in to custom pricing starts from its pack ingredients' names.
    if (!base.ingredients.length) base.ingredients = recipe.ingredients.filter((i) => !i.key.startsWith('meal:')).map((i) => ({ name: getIngredient(i.key).name, qty: null, unit: null }));
    return base;
    // The form is seeded once per screen visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const [name, setName] = useState(initial.name);
  const [emoji, setEmoji] = useState(initial.emoji);
  const [slot, setSlot] = useState<MealKind>(initial.slot);
  const [kcal, setKcal] = useState(numText(initial.kcal));
  const [protein, setProtein] = useState(numText(initial.protein));
  const [minutes, setMinutes] = useState(numText(initial.minutes));
  const [packPricing, setPackPricing] = useState(builtIn && initial.costPerServing === null);
  const [cost, setCost] = useState(numText(initial.costPerServing ?? (recipe ? servingCost(recipe.id, [], currency) : 0)));
  const [diet, setDiet] = useState<MealDiet>(initial.diet);
  const [allergens, setAllergens] = useState<Allergen[]>(initial.allergens);
  const [ingredients, setIngredients] = useState<IngredientDraft[]>(initial.ingredients.map((i) => ({ name: i.name, qty: numText(i.qty), unit: i.unit ?? '' })));
  const [notes, setNotes] = useState(initial.notes);
  const [steps, setSteps] = useState<string[]>(initial.steps);
  const [errors, setErrors] = useState<FieldErrors<MealInput>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!isNew && !recipe) {
    return (
      <Screen back={() => router.back()} title="Meal not found">
        <Txt muted>This meal may have been deleted.</Txt>
      </Screen>
    );
  }

  const save = () => {
    const input: MealInput = {
      name,
      slot,
      emoji,
      kcal: parseNum(kcal),
      protein: parseNum(protein),
      minutes: parseNum(minutes),
      costPerServing: packPricing ? null : parseNum(cost),
      costCurrency: currency,
      diet,
      allergens,
      ingredients: packPricing ? [] : ingredients.map((i) => ({ name: i.name, qty: i.qty.trim() ? parseNum(i.qty) : null, unit: i.unit || null })),
      notes,
      steps,
    };
    const result = isNew ? foodActions.createMeal(input) : foodActions.updateMeal(recipe!.id, input, { builtIn });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/meals');
  };

  const remove = () => {
    setConfirmDelete(false);
    foodActions.deleteMeal(recipe!.id);
    if (router.canGoBack()) router.back();
    else router.replace('/meals');
  };

  const setIngredient = (i: number, patch: Partial<IngredientDraft>) => setIngredients((list) => list.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  return (
    <Screen
      back={() => router.back()}
      title={isNew ? 'New meal' : 'Edit meal'}
      subtitle={builtIn ? 'Your changes apply only to your plans.' : undefined}
      edges={['top', 'bottom']}
      footer={<Button label={isNew ? 'Add meal' : 'Save changes'} icon="checkmark" onPress={save} accessibilityLabel={isNew ? 'Add meal' : 'Save changes'} />}>
      <View style={{ gap: space.lg }}>
        <Row gap={space.sm} style={{ alignItems: 'flex-end' }}>
          <FoodImage query={name || 'meal'} fallbackEmoji={emoji || '🍽️'} tint={recipe?.tint ?? 'green'} image={name === initial.name ? recipe?.image : null} size={72} />
          <View style={{ flex: 1, gap: space.xs }}>
            <Field label="Name" value={name} onChange={setName} placeholder="e.g. Lentil curry" />
            <ErrorText text={errors.name} />
          </View>
        </Row>
        <Row gap={space.sm}>
          <View style={{ width: 96 }}>
            <Field label="Emoji" value={emoji} onChange={(v) => setEmoji(Array.from(v).slice(-2).join(''))} placeholder="🍲" />
          </View>
          <Txt v="small" muted style={{ flex: 1, alignSelf: 'flex-end', paddingBottom: space.sm }}>
            Shown when there’s no photo. A photo is found for the name automatically.
          </Txt>
        </Row>

        <Section title="Meal">
          <Segmented options={SLOTS} value={slot} onChange={setSlot} />
        </Section>

        <Section title="Nutrition and time (per serving)">
          <Row gap={space.sm}>
            <View style={{ flex: 1 }}>
              <Field label="Calories" value={kcal} onChange={setKcal} keyboardType="number-pad" placeholder="500" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Protein (g)" value={protein} onChange={setProtein} keyboardType="number-pad" placeholder="20" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Minutes" value={minutes} onChange={setMinutes} keyboardType="number-pad" placeholder="30" />
            </View>
          </Row>
          <ErrorText text={errors.kcal ?? errors.protein ?? errors.minutes} />
        </Section>

        <Section title="Cost">
          {builtIn ? <ToggleRow icon="pricetag-outline" title="Use FinFeast's ingredient prices" subtitle="Turn off to set your own cost and ingredients." value={packPricing} onChange={setPackPricing} /> : null}
          {packPricing ? null : (
            <View style={{ gap: space.xs }}>
              <AmountInput label="Estimated cost per serving" value={cost} onChange={setCost} />
              <ErrorText text={errors.costPerServing} />
            </View>
          )}
        </Section>

        <Section title="Diet and allergens">
          <Row gap={6} wrap>
            {DIETS.map((d) => (
              <Chip key={d.value} label={d.label} selected={diet === d.value} onPress={() => setDiet(d.value)} />
            ))}
          </Row>
          <Row gap={6} wrap style={{ marginTop: space.xs }}>
            {ALLERGENS.map((a) => (
              <Chip key={a} label={`Contains ${a}`} tone="amber" selected={allergens.includes(a)} onPress={() => setAllergens((l) => (l.includes(a) ? l.filter((x) => x !== a) : [...l, a]))} />
            ))}
          </Row>
        </Section>

        {packPricing ? null : (
          <Section title="Ingredients" action={{ label: 'Add', onPress: () => setIngredients((l) => [...l, { name: '', qty: '', unit: '' }]) }}>
            <Card style={{ gap: space.sm }}>
              {ingredients.length === 0 ? <Txt muted>No ingredients yet.</Txt> : null}
              {ingredients.map((ing, i) => (
                <Row key={i} gap={space.xs} style={{ alignItems: 'flex-end' }}>
                  <View style={{ flex: 3 }}>
                    <Field label={i === 0 ? 'Ingredient' : undefined} value={ing.name} onChange={(v) => setIngredient(i, { name: v })} placeholder="Red lentils" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label={i === 0 ? 'Qty' : undefined} value={ing.qty} onChange={(v) => setIngredient(i, { qty: v.replace(/[^\d.,]/g, '') })} placeholder="1" />
                  </View>
                  <View style={{ flex: 1.4 }}>
                    <Field label={i === 0 ? 'Unit' : undefined} value={ing.unit} onChange={(v) => setIngredient(i, { unit: v })} placeholder="cup" />
                  </View>
                  <IconButton icon="trash-outline" label={`Remove ${ing.name || 'ingredient'}`} onPress={() => setIngredients((l) => l.filter((_, k) => k !== i))} />
                </Row>
              ))}
            </Card>
          </Section>
        )}

        <Section title="Method" action={{ label: 'Add step', onPress: () => setSteps((l) => [...l, '']) }}>
          <Card style={{ gap: space.sm }}>
            {steps.length === 0 ? <Txt muted>No steps yet.</Txt> : null}
            {steps.map((st, i) => (
              <Row key={i} gap={space.xs} style={{ alignItems: 'center' }}>
                <View style={{ width: 26, height: 26, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt v="caption" muted>
                    {i + 1}
                  </Txt>
                </View>
                <View style={{ flex: 1 }}>
                  <Field value={st} onChange={(v) => setSteps((l) => l.map((x, k) => (k === i ? v : x)))} placeholder="Describe this step" />
                </View>
                <IconButton icon="trash-outline" label={`Remove step ${i + 1}`} onPress={() => setSteps((l) => l.filter((_, k) => k !== i))} />
              </Row>
            ))}
          </Card>
        </Section>

        <Section title="Notes">
          <Field value={notes} onChange={setNotes} placeholder="Anything to remember" />
        </Section>

        {!isNew ? (
          <View style={{ gap: space.xs }}>
            {builtIn && row && !row.hidden ? <Button label="Reset to original" icon="refresh-outline" variant="secondary" onPress={() => { foodActions.restoreMeal(recipe!.id); router.back(); }} /> : null}
            <Button label={builtIn ? 'Remove from my meals' : 'Delete meal'} icon="trash-outline" variant="secondary" tone="red" onPress={() => setConfirmDelete(true)} />
          </View>
        ) : null}
      </View>

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
            ? `${recipe?.name} won't be planned for you any more. You can bring it back from My meals.`
            : `${recipe?.name} will be deleted, along with grocery items you added for it. Planned slots get a new meal.`}
        </Txt>
      </Sheet>
    </Screen>
  );
}
