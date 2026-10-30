import { router } from 'expo-router';
import { View } from 'react-native';

import { Card, Chip, Row, Screen, Txt } from '@/components/ui';
import { INGREDIENTS, type Aisle } from '@/data/recipes';
import { useStore } from '@/store/useStore';

const AISLES: Aisle[] = ['Produce', 'Meat & fish', 'Dairy & eggs', 'Bakery', 'Pantry', 'Frozen'];

export default function Pantry() {
  const pantry = useStore((s) => s.pantry);
  const toggle = useStore((s) => s.togglePantry);
  const keys = Object.keys(INGREDIENTS);
  return (
    <Screen title="Pantry" subtitle="What you already have comes off the grocery list" back={() => router.back()}>
      <View style={{ gap: 14 }}>
        {AISLES.map((aisle) => (
          <Card key={aisle} style={{ gap: 10 }}>
            <Txt v="h3">{aisle}</Txt>
            <Row gap={8} wrap>
              {keys
                .filter((k) => INGREDIENTS[k].aisle === aisle)
                .map((k) => {
                  const ing = INGREDIENTS[k];
                  const have = ing.staple || pantry.some((p) => p.key === k);
                  return <Chip key={k} small label={ing.staple ? `${ing.name} (staple)` : ing.name} selected={have} tone="blue" onPress={ing.staple ? undefined : () => toggle(k)} />;
                })}
            </Row>
          </Card>
        ))}
        <Txt v="caption" muted center>
          Each item you have covers one pack in this week’s list.
        </Txt>
      </View>
    </Screen>
  );
}
