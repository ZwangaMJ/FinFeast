import { router } from 'expo-router';
import { View } from 'react-native';

import { InsightCard } from '@/components/cards';
import { EmptyState, Screen, Section, Txt } from '@/components/ui';
import { useInsights } from '@/hooks/useInsights';

export default function Insights() {
  const insights = useInsights();
  // Recurring obligations and everyday habits are different decisions, so they're shown apart.
  const groups = [
    { title: 'Bills & fixed costs', items: insights.filter((i) => i.group === 'fixed') },
    { title: 'Everyday spending', items: insights.filter((i) => i.group === 'habit') },
  ].filter((group) => group.items.length);
  return (
    <Screen title="Insights" subtitle="Ranked by money found for the least effort" back={() => router.back()}>
      {insights.length === 0 ? (
        <EmptyState icon="sparkles-outline" title="All caught up" body="When we spot found money in your spending, it shows up here with one clear action." />
      ) : (
        <View>
          {groups.map((group) => (
            <Section key={group.title} title={group.title}>
              <View style={{ gap: 12 }}>
                {group.items.map((i) => (
                  <InsightCard key={i.id} insight={i} />
                ))}
              </View>
            </Section>
          ))}
          <Txt v="caption" muted center style={{ marginTop: 16 }}>
            “Not for me” teaches us what to skip next time.
          </Txt>
        </View>
      )}
    </Screen>
  );
}
