import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuthStore } from '@/store/useAuthStore';
import { Button, Txt } from '@/components/ui';
import { retryCloudSync, useCloudSyncStatus } from '@/lib/supabase/sync';
import { useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ ...Ionicons.font, DMSans_400Regular, DMSans_500Medium, DMSans_700Bold, Fraunces_600SemiBold });
  const authStatus = useAuthStore((s) => s.status);
  const initialize = useAuthStore((s) => s.initialize);
  const authError = useAuthStore((s) => s.error);
  const deviceError = useAuthStore((s) => s.deviceError);
  const signedInUser = useAuthStore((s) => s.userId);
  const syncError = useCloudSyncStatus().error;
  const { c, dark } = useTheme();
  const [bootComplete, setBootComplete] = useState(false);
  const ready = fontsLoaded && bootComplete;

  useEffect(() => {
    let active = true;
    void initialize().finally(() => {
      if (active) setBootComplete(true);
    });
    return () => {
      active = false;
    };
  }, [initialize]);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // Themed blank canvas while fonts and saved data load — no white flash in dark mode
  if (!ready) return <View style={{ flex: 1, backgroundColor: c.background }} />;

  if (authStatus === 'error') {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center', padding: 24, gap: 14 }}>
        <Txt v="title">Couldn’t load your account</Txt>
        <Txt muted>{authError ?? 'FinFeast could not load your account.'}</Txt>
        <Button label="Try again" onPress={() => void useAuthStore.getState().retry()} />
        {signedInUser ? (
          <Button label="Sign out" variant="ghost" onPress={() => void useAuthStore.getState().signOut().catch(() => {})} />
        ) : null}
      </View>
    );
  }

  if (authStatus === 'checking') {
    return <View style={{ flex: 1, backgroundColor: c.background }} />;
  }

  const navTheme = {
    ...(dark ? DarkTheme : DefaultTheme),
    colors: { ...(dark ? DarkTheme : DefaultTheme).colors, background: c.background, card: c.surface, text: c.text, border: c.border, primary: c.primary },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.background }}>
      <SafeAreaProvider>
        <ThemeProvider value={navTheme}>
          <StatusBar style={dark ? 'light' : 'dark'} />
          <View style={{ flex: 1 }}>
            {authStatus === 'ready' && (syncError || deviceError) ? (
              <View style={{ padding: 12, backgroundColor: c.destructiveWash, gap: 8 }}>
                <Txt v="small" color={c.destructive}>{syncError ?? deviceError}</Txt>
                {syncError ? <Button label="Retry saving" small variant="secondary" onPress={() => void retryCloudSync()} /> : null}
              </View>
            ) : null}
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background }, animation: 'none' }}>
              {/* Signed out (or signing in): only the sign-in screen exists. */}
              <Stack.Protected guard={authStatus !== 'ready'}>
                <Stack.Screen name="sign-in" />
              </Stack.Protected>
              <Stack.Protected guard={authStatus === 'ready'}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="onboarding" options={{ gestureEnabled: false, animation: 'fade' }} />
                <Stack.Screen name="upload" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                <Stack.Screen name="goal/new" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                {/* Every other route is declared here too, or it would be reachable while signed out. */}
                <Stack.Screen name="goal/[id]" />
                <Stack.Screen name="meal/[id]" />
                <Stack.Screen name="grocery" />
                <Stack.Screen name="pantry" />
                <Stack.Screen name="insights" />
              </Stack.Protected>
            </Stack>
          </View>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
