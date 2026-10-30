import { useColorScheme } from 'react-native';

import { useStore } from '@/store/useStore';

/**
 * Semantic colour tokens (spec §8.2). Green = spending well, amber = food,
 * blue = wealth. Values are hand-tuned sRGB equivalents of the oklch spec
 * targets, checked for 4.5:1 text contrast in both modes.
 */
const light = {
  background: '#F7F3EC',
  surface: '#FFFDF9',
  surfaceAlt: '#F1ECE3',
  border: '#E6DFD3',
  text: '#1F1B16',
  textMuted: '#655D52',
  textFaint: '#8C8478',
  primary: '#2E7A4D',
  onPrimary: '#FFFFFF',
  primaryWash: '#E3F0E6',
  amber: '#B86E12',
  amberStrong: '#D98A1E',
  amberWash: '#FBEBD3',
  blue: '#2D67A8',
  blueWash: '#E3ECF7',
  destructive: '#B3423F',
  destructiveWash: '#F8E4E2',
  grayWash: '#EEEAE3',
  shadow: 'rgba(80, 60, 30, 0.08)',
  overlay: 'rgba(31, 27, 22, 0.45)',
};

const dark: typeof light = {
  background: '#16130F',
  surface: '#221E19',
  surfaceAlt: '#2C2721',
  border: '#3A342C',
  text: '#F3EEE6',
  textMuted: '#B4AA9C',
  textFaint: '#8E8578',
  primary: '#62D394',
  onPrimary: '#0E2A1A',
  primaryWash: '#1C3426',
  amber: '#F2B45C',
  amberStrong: '#F2B45C',
  amberWash: '#3A2D18',
  blue: '#86B6EE',
  blueWash: '#1B2B3F',
  destructive: '#F08A85',
  destructiveWash: '#3B1F1D',
  grayWash: '#2C2924',
  shadow: 'rgba(0, 0, 0, 0.35)',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

export type Palette = typeof light;
export type Tone = 'green' | 'amber' | 'blue' | 'red' | 'gray';

export const fonts = {
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  bold: 'DMSans_700Bold',
  display: 'Fraunces_600SemiBold',
};

export const radius = { sm: 12, md: 16, lg: 20, xl: 24, pill: 999 };

export function useTheme() {
  const system = useColorScheme();
  const mode = useStore((s) => s.settings.themeMode);
  const scheme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const c = scheme === 'dark' ? dark : light;
  const tone = (t: Tone) =>
    ({
      green: { fg: c.primary, bg: c.primaryWash },
      amber: { fg: c.amber, bg: c.amberWash },
      blue: { fg: c.blue, bg: c.blueWash },
      red: { fg: c.destructive, bg: c.destructiveWash },
      gray: { fg: c.textMuted, bg: c.grayWash },
    })[t];
  return { c, scheme, tone, dark: scheme === 'dark' };
}
