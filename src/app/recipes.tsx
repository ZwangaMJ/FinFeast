import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { FoodImage } from '@/components/FoodImage';
import { Button, Group, ListRow, Pill, Row, Screen, Section, Txt, useCurrency } from '@/components/ui';
import { foodActions, useMeals } from '@/hooks/useFood';
import { money } from '@/lib/format';
import { servingCost } from '@/lib/mealPlanner';
import type { MealKind } from '@/store/types';
import { space } from '@/theme';

const GROUPS: { slot: MealKind; title: string }[] = [
  { slot: 'breakfast', title: 'Breakfasts' },
  { slot: 'lunch', title: 'Lunches' },
  { slot: 'dinner', title: 'Dinners' },
  { slot: 'snack', title: 'Snacks' },
];

/** Every meal the planner can choose from, with create / edit / remove / restore. */
export default function MyMeals() {
  const currency = useCurrency();
  const { recipes, hidden, byId } = useMeals();
  const bySlot = useMemo(() => Object.fromEntries(GROUPS.map((g) => [g.slot, recipes.filter((r) => r.slot === g.slot)])), [recipes]);

  return (
    <Screen
      back={() => (router.canGoBack() ? router.back() : router.replace('/meals'))}
      title="My meals"
      subtitle="The planner picks from these. Edit a starter meal to make it yours."
      edges={['top', 'bottom']}
      footer={<Button label="New meal" icon="add" onPress={() => router.push('/recipe/new')} accessibilityLabel="New meal" />}>
      <View style={{ gap: space.lg }}>
        {GROUPS.map((g) => (
          <Section key={g.slot} title={`${g.title} (${bySlot[g.slot].length})`} action={{ label: 'Add', onPress: () => router.push({ pathname: '/recipe/[id]', params: { id: 'new', slot: g.slot } }) }}>
            {bySlot[g.slot].length ? (
              <Group inset={64}>
                {bySlot[g.slot].map((r) => (
                  <ListRow
                    key={r.id}
                    title={r.name}
                    subtitle={`${money(servingCost(r.id, [], currency), currency)}/serving · ${r.kcal} kcal · ${r.minutes} min`}
                    onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: r.id } })}
                    chevron
                    right={
                      <Row gap={space.xs}>
                        {r.source === 'custom' ? <Pill label="Yours" tone="blue" /> : r.source === 'edited' ? <Pill label="Edited" tone="amber" /> : null}
                        <FoodImage query={r.name} fallbackEmoji={r.emoji} tint={r.tint} image={r.image} size={40} />
                      </Row>
                    }
                  />
                ))}
              </Group>
            ) : (
              <Txt muted>No {g.title.toLowerCase()} yet.</Txt>
            )}
          </Section>
        ))}

        {hidden.length ? (
          <Section title="Removed starter meals">
            <Group inset={16}>
              {hidden.map((m) => {
                const id = m.baseRecipeId!;
                return (
                  <ListRow
                    key={m.id}
                    title={byId[id]?.name ?? m.name}
                    subtitle="Not planned for you"
                    right={<Button label="Restore" small variant="secondary" onPress={() => foodActions.restoreMeal(id)} accessibilityLabel={`Restore ${m.name}`} />}
                  />
                );
              })}
            </Group>
          </Section>
        ) : null}
      </View>
    </Screen>
  );
}
