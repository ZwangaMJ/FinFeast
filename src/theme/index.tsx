import { useColorScheme, type TextStyle } from 'react-native';

import { useStore } from '@/store/useStore';

/**
 * FinFeast design tokens, aligned to Apple's HIG.
 *
 * Colour: purple is the brand accent; green, amber and blue keep their financial
 * meanings (spending well · food & warnings · wealth). Washes are for one callout
 * at a time, not for every card. Values are hand-tuned sRGB, checked for 4.5:1
 * text contrast in both modes.
 */
const light = {
  background: '#F7F3EC',
  surface: '#FFFDF9',
  surfaceAlt: '#F1ECE3',
  border: '#E6DFD3',
  /** Hairline between grouped rows (iOS "separator"). */
  separator: 'rgba(60, 50, 35, 0.14)',
  /** Neutral control fill — segmented track, chips, pressed rows (iOS "tertiary fill"). */
  fill: 'rgba(118, 102, 80, 0.12)',
  /** Warm tint laid over the blur on tab bar / compact header (the blur supplies the frost). */
  chrome: 'rgba(250, 247, 241, 0.72)',
  text: '#1F1B16',
  textMuted: '#655D52',
  textFaint: '#8C8478',
  primary: '#6242A5',
  onPrimary: '#FFFFFF',
  primaryWash: '#EEE8FA',
  success: '#2E7A4D',
  successWash: '#E3F0E6',
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
  separator: 'rgba(235, 225, 210, 0.14)',
  fill: 'rgba(235, 225, 210, 0.12)',
  chrome: 'rgba(30, 27, 22, 0.72)',
  text: '#F3EEE6',
  textMuted: '#B4AA9C',
  textFaint: '#8E8578',
  primary: '#B9A5F4',
  onPrimary: '#24183D',
  primaryWash: '#32264B',
  success: '#62D394',
  successWash: '#1C3426',
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
export type Tone = 'green' | 'purple' | 'amber' | 'blue' | 'red' | 'gray';

export const fonts = {
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  bold: 'DMSans_700Bold',
  display: 'Fraunces_600SemiBold',
};

/** 4-pt grid. Screen gutters are `md`; sections are separated by `xxl`. */
export const space = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32 } as const;

export const radius = { sm: 10, md: 14, lg: 20, xl: 26, pill: 999 } as const;

/** Minimum hit target on every platform (HIG: 44 × 44 pt). */
export const TOUCH = 44;

/**
 * Type ramp mirroring the iOS text styles (Large Title … Caption 2).
 * Tracking is size-specific: tighter as type grows, slightly open when small.
 * The serif display face is reserved for the one hero figure per screen.
 */
export type TypeVariant = 'hero' | 'display' | 'title' | 'h2' | 'h3' | 'body' | 'bodyStrong' | 'small' | 'smallStrong' | 'caption' | 'label';

export const type: Readonly<Record<TypeVariant, TextStyle>> = {
  hero: { fontFamily: fonts.display, fontSize: 44, lineHeight: 50, letterSpacing: -0.8 },
  display: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, letterSpacing: -0.4 },
  /** Large Title */
  title: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 39, letterSpacing: -0.6 },
  /** Title 3 */
  h2: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 25, letterSpacing: -0.3 },
  /** Headline */
  h3: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  /** Body */
  body: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 23, letterSpacing: -0.2 },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 17, lineHeight: 23, letterSpacing: -0.2 },
  /** Subheadline */
  small: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20, letterSpacing: -0.1 },
  smallStrong: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20, letterSpacing: -0.1 },
  /** Footnote */
  caption: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, letterSpacing: 0 },
  /** Caption 2, uppercase — section and field labels */
  label: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, letterSpacing: 0.6, textTransform: 'uppercase' },
};

/**
 * Spring presets (RN Animated: damping ratio ≈ damping / (2·√(stiffness·mass))).
 * `press` is critically damped (no overshoot) — taps never bounce.
 */
export const motion = {
  press: { stiffness: 520, damping: 46, mass: 1 },
  settle: { stiffness: 240, damping: 31, mass: 1 },
  pressedScale: 0.97,
  fadeMs: 220,
} as const;

export function useTheme() {
  const system = useColorScheme();
  const mode = useStore((s) => s.settings.themeMode);
  const scheme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const c = scheme === 'dark' ? dark : light;
  const tone = (t: Tone) =>
    ({
      green: { fg: c.success, bg: c.successWash },
      purple: { fg: c.primary, bg: c.primaryWash },
      amber: { fg: c.amber, bg: c.amberWash },
      blue: { fg: c.blue, bg: c.blueWash },
      red: { fg: c.destructive, bg: c.destructiveWash },
      gray: { fg: c.textMuted, bg: c.grayWash },
    })[t];
  return { c, scheme, tone, dark: scheme === 'dark' };
}
