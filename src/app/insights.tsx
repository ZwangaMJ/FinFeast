import { router } from 'expo-router';
import { View } from 'react-native';

import { InsightCard } from '@/components/cards';
import { EmptyState, Screen, Txt } from '@/components/ui';
import { useInsights } from '@/hooks/useInsights';

export default function Insights() {
  const insights = useInsights();
  return (
    <Screen title="Insights" subtitle="Ranked by money found for the least effort" back={() => router.back()}>
      {insights.length === 0 ? (
        <EmptyState icon="sparkles-outline" title="All caught up" body="When we spot found money in your spending, it shows up here with one clear action." />
      ) : (
        <View style={{ gap: 12 }}>
          {insights.map((i) => (
            <InsightCard key={i.id} insight={i} />
          ))}
          <Txt v="caption" muted center style={{ marginTop: 8 }}>
            “Not for me” teaches us what to skip next time.
          </Txt>
        </View>
      )}
    </Screen>
  );
}
