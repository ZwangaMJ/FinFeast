import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useStore } from '@/store/useStore';
import { useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

function useHydrated() {
  return useSyncExternalStore(
    (cb) => useStore.persist.onFinishHydration(cb),
    () => useStore.persist.hasHydrated(),
    () => false,
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ ...Ionicons.font, DMSans_400Regular, DMSans_500Medium, DMSans_700Bold, Fraunces_600SemiBold });
  const hydrated = useHydrated();
  const { c, dark } = useTheme();
  const ready = fontsLoaded && hydrated;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // Themed blank canvas while fonts and saved data load — no white flash in dark mode
  if (!ready) return <View style={{ flex: 1, backgroundColor: c.background }} />;

  const navTheme = {
    ...(dark ? DarkTheme : DefaultTheme),
    colors: { ...(dark ? DarkTheme : DefaultTheme).colors, background: c.background, card: c.surface, text: c.text, border: c.border, primary: c.primary },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.background }}>
      <SafeAreaProvider>
        <ThemeProvider value={navTheme}>
          <StatusBar style={dark ? 'light' : 'dark'} />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background }, animation: 'fade_from_bottom', animationDuration: 250 }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="onboarding" options={{ gestureEnabled: false, animation: 'fade' }} />
            <Stack.Screen name="upload" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="insights" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="grocery" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="pantry" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="meal/[id]" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="goal/[id]" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="goal/new" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          </Stack>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
