import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useEffect, useMemo } from 'react';
import { AppState } from 'react-native';

import { Icon } from '@/components/ui';
import { useInsights } from '@/hooks/useInsights';
import { fonts, useTheme } from '@/theme';
import { useStore } from '@/store/useStore';

export default function TabLayout() {
  const { c } = useTheme();
  const onboarded = useStore((s) => s.onboarded);
  const syncTime = useStore((s) => s.syncTime);
  const pendingFound = useStore((s) => s.foundMoney.filter((f) => f.status === 'pending').length);
  const insights = useInsights();

  // Week rollover, payday sweeps and month-end checks on launch and on resume
  useEffect(() => {
    syncTime();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && syncTime());
    return () => sub.remove();
  }, [syncTime]);

  const screenOptions = useMemo(
    () => ({
      headerShown: false,
      tabBarActiveTintColor: c.primary,
      tabBarInactiveTintColor: c.textMuted,
      tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border, height: 64, paddingTop: 6 },
      tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11, marginBottom: 4 },
      tabBarBadgeStyle: { fontFamily: fonts.bold, fontSize: 10 },
      sceneStyle: { backgroundColor: c.background },
      lazy: false,
    }),
    [c],
  );

  if (!onboarded) return <Redirect href="/onboarding" />;

  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => <Icon name={focused ? 'home' : 'home-outline'} color={color} size={23} />,
          tabBarBadge: insights.length ? insights.length : undefined,
          tabBarBadgeStyle: { backgroundColor: c.amberStrong, color: '#1F1B16', fontFamily: fonts.bold, fontSize: 10 },
          tabBarAccessibilityLabel: insights.length ? `Home, ${insights.length} new insights` : 'Home',
        }}
      />
      <Tabs.Screen name="money" options={{ title: 'Money', tabBarIcon: ({ color, focused }) => <Icon name={focused ? 'wallet' : 'wallet-outline'} color={color} size={23} /> }} />
      <Tabs.Screen name="meals" options={{ title: 'Meals', tabBarIcon: ({ color, focused }) => <Icon name={focused ? 'restaurant' : 'restaurant-outline'} color={color} size={23} /> }} />
      <Tabs.Screen
        name="goals"
        options={{
          title: 'Goals',
          tabBarIcon: ({ color, focused }) => <Icon name={focused ? 'leaf' : 'leaf-outline'} color={color} size={23} />,
          tabBarBadge: pendingFound ? pendingFound : undefined,
          tabBarBadgeStyle: { backgroundColor: c.blue, color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 10 },
          tabBarAccessibilityLabel: pendingFound ? `Goals, ${pendingFound} found money waiting` : 'Goals',
        }}
      />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color, focused }) => <Icon name={focused ? 'person-circle' : 'person-circle-outline'} color={color} size={24} /> }} />
    </Tabs>
  );
}
