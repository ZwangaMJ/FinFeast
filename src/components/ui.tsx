import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurTargetView, BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { BottomTabBarHeightContext } from 'expo-router/js-tabs';
import { Children, createContext, isValidElement, useCallback, useContext, useEffect, useRef, useState, type ComponentProps, type ComponentRef, type ReactNode, type RefObject } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type ColorValue,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { symbol } from '@/lib/format';
import { selection } from '@/lib/haptics';
import { useStore } from '@/store/useStore';
import { fonts, motion, radius, space, TOUCH, type as typeRamp, useTheme, type Tone, type TypeVariant } from '@/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export const MAX_WIDTH = 560;
const NATIVE_DRIVER = Platform.OS !== 'web';
type ViewRef = ComponentRef<typeof View>;

export function Icon({ name, size = 20, color, style }: { name: IconName | string; size?: number; color?: ColorValue; style?: StyleProp<TextStyle> }) {
  const { c } = useTheme();
  return <Ionicons name={name as IconName} size={size} color={(color ?? c.text) as string} style={style} />;
}

// ---------------------------------------------------------------------------
// Accessibility preferences

type A11yQuery = 'isReduceMotionEnabled' | 'isReduceTransparencyEnabled';

/** On web the same preferences arrive as CSS media queries (Chromium, Safari and Firefox). */
const MEDIA_QUERY: Record<A11yQuery, string> = {
  isReduceMotionEnabled: '(prefers-reduced-motion: reduce)',
  isReduceTransparencyEnabled: '(prefers-reduced-transparency: reduce)',
};

/** Reads a platform accessibility flag; platforms without it (e.g. transparency on Android) report false. */
const readFlag = (query: A11yQuery): Promise<boolean> => {
  const fn = (AccessibilityInfo as unknown as Partial<Record<A11yQuery, () => Promise<boolean>>>)[query];
  return typeof fn === 'function' ? fn.call(AccessibilityInfo) : Promise.resolve(false);
};

function useAccessibilityFlag(query: A11yQuery, event: 'reduceMotionChanged' | 'reduceTransparencyChanged') {
  const [value, setValue] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mq = window.matchMedia(MEDIA_QUERY[query]);
      const onChange = () => setValue(mq.matches);
      onChange();
      mq.addEventListener?.('change', onChange);
      return () => mq.removeEventListener?.('change', onChange);
    }
    let live = true;
    readFlag(query)
      .then((v) => live && setValue(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.(event, setValue);
    return () => {
      live = false;
      sub?.remove?.();
    };
  }, [query, event]);
  return value;
}

export const useReducedMotion = () => useAccessibilityFlag('isReduceMotionEnabled', 'reduceMotionChanged');
export const useReducedTransparency = () => useAccessibilityFlag('isReduceTransparencyEnabled', 'reduceTransparencyChanged');

// ---------------------------------------------------------------------------
// Press feedback: instant on touch-down, critically damped spring, interruptible

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
/** Fraction of the pressed state shown on hover. */
const HOVER = 0.3;
/** Pointer cursor for touchables on web (ignored on native). */
const POINTER: ViewStyle = Platform.OS === 'web' ? ({ cursor: 'pointer' } as ViewStyle) : {};

/**
 * One animated value drives scale and dimming. Springs start from the current
 * on-screen value, so a quick tap-and-release (or a cancelled press) never jumps.
 */
function usePressFeedback(scaleTo: number = motion.pressedScale) {
  const reduced = useReducedMotion();
  const [p] = useState(() => new Animated.Value(0));
  // Pointer devices (web, iPad, Android with a mouse) get a subtle hover state on the same value
  const hovered = useRef(false);
  const to = (v: number) => Animated.spring(p, { toValue: v, ...motion.press, useNativeDriver: NATIVE_DRIVER }).start();
  return {
    onPressIn: () => to(1),
    onPressOut: () => to(hovered.current ? HOVER : 0),
    onHoverIn: () => {
      hovered.current = true;
      to(HOVER);
    },
    onHoverOut: () => {
      hovered.current = false;
      to(0);
    },
    style: {
      opacity: p.interpolate({ inputRange: [0, 1], outputRange: [1, 0.82] }),
      transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [1, reduced ? 1 : scaleTo] }) }],
    },
  };
}

type TouchProps = {
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'tab' | 'link' | 'checkbox';
  accessibilityState?: { disabled?: boolean; selected?: boolean; checked?: boolean };
  hitSlop?: number;
  scaleTo?: number;
};

/** The app's base touchable: scales and dims on touch-down, springs back on release. */
export function Touchable({ onPress, disabled, style, children, accessibilityLabel, accessibilityRole = 'button', accessibilityState, hitSlop, scaleTo }: TouchProps) {
  const feedback = usePressFeedback(scaleTo);
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={feedback.onPressIn}
      onPressOut={feedback.onPressOut}
      onHoverIn={feedback.onHoverIn}
      onHoverOut={feedback.onHoverOut}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, ...accessibilityState }}
      style={[style, !disabled && POINTER, !disabled && feedback.style]}>
      {children}
    </AnimatedPressable>
  );
}

// ---------------------------------------------------------------------------
// Text

export function Txt({
  v = 'body',
  color,
  muted,
  faint,
  center,
  tabular,
  style,
  children,
  numberOfLines,
  accessibilityLabel,
}: {
  v?: TypeVariant;
  color?: string;
  muted?: boolean;
  faint?: boolean;
  center?: boolean;
  tabular?: boolean;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
  accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  const col = color ?? (muted ? c.textMuted : faint ? c.textFaint : c.text);
  const isNumeric = tabular || v === 'hero' || v === 'display';
  return (
    <Text
      numberOfLines={numberOfLines}
      accessibilityLabel={accessibilityLabel}
      maxFontSizeMultiplier={2}
      style={[typeRamp[v], { color: col }, center && { textAlign: 'center' }, isNumeric && { fontVariant: ['tabular-nums', 'lining-nums'] }, style]}>
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Surfaces

/** Rounded surface. Neutral by default; `tone` is for the one callout that needs it. */
export function Card({
  children,
  style,
  tone,
  onPress,
  padded = true,
  accessibilityLabel,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: Tone;
  onPress?: () => void;
  padded?: boolean;
  accessibilityLabel?: string;
}) {
  const { c, tone: t, dark } = useTheme();
  const base: ViewStyle = {
    backgroundColor: tone ? t(tone).bg : c.surface,
    borderRadius: radius.lg,
    padding: padded ? space.md + 2 : 0,
    shadowColor: '#3C2A10',
    shadowOpacity: dark || tone ? 0 : 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: dark || tone ? 0 : 1,
  };
  if (onPress) {
    return (
      <Touchable onPress={onPress} accessibilityLabel={accessibilityLabel} scaleTo={0.985} style={[base, style]}>
        {children}
      </Touchable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}

/**
 * Translucent material for chrome that floats over content (tab bar, compact
 * header, sticky footer). Falls back to a near-solid fill when the user asks for
 * reduced transparency, and on Android where real blur is costly.
 */
export function Material({
  style,
  children,
  pointerEvents,
  blurTarget,
}: {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  pointerEvents?: 'none' | 'box-none' | 'auto';
  /** Android: the content to blur. Defaults to the focused screen's target (see BlurTargetProvider). */
  blurTarget?: RefObject<ViewRef | null>;
}) {
  const { c, dark } = useTheme();
  const reduced = useReducedTransparency();
  const shared = useContext(BlurTargetContext)?.target ?? null;
  const target = blurTarget ?? shared;
  // Android can only blur a registered BlurTargetView; without one, stay near-solid for legibility
  if (reduced || (Platform.OS === 'android' && !target)) {
    return (
      <View pointerEvents={pointerEvents} style={[{ backgroundColor: reduced ? c.surface : c.background, opacity: reduced ? 1 : 0.97 }, style]}>
        {children}
      </View>
    );
  }
  return (
    <BlurView
      pointerEvents={pointerEvents}
      intensity={Platform.OS === 'web' ? 30 : 70}
      tint={dark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
      // Android 12+: real blur via RenderNode; older Android falls back to the tint alone
      blurMethod="dimezisBlurViewSdk31Plus"
      blurTarget={Platform.OS === 'android' ? (target ?? undefined) : undefined}
      style={[{ overflow: 'hidden' }, style]}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.chrome }]} />
      {children}
    </BlurView>
  );
}

type BlurTargetState = { target: RefObject<ViewRef | null> | null; setTarget: (t: RefObject<ViewRef | null>) => void };
const BlurTargetContext = createContext<BlurTargetState | null>(null);

/**
 * Lets chrome that sits outside a screen (the tab bar) blur whichever screen is
 * focused. Each Screen registers its BlurTargetView here on focus. Needed for
 * Android's blur; harmless on iOS and web.
 */
export function BlurTargetProvider({ children }: { children: ReactNode }) {
  const [target, setTargetState] = useState<RefObject<ViewRef | null> | null>(null);
  const setTarget = useCallback((t: RefObject<ViewRef | null>) => setTargetState(() => t), []);
  return <BlurTargetContext.Provider value={{ target, setTarget }}>{children}</BlurTargetContext.Provider>;
}

// ---------------------------------------------------------------------------
// Controls

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'tonal' | 'destructive';

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  small,
  style,
  tone = 'green',
  accessibilityLabel,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName | string;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  tone?: Tone;
  accessibilityLabel?: string;
}) {
  const { c, tone: t } = useTheme();
  const colors: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.primary, fg: c.onPrimary },
    secondary: { bg: c.fill, fg: c.text },
    ghost: { bg: 'transparent', fg: t(tone).fg },
    tonal: { bg: t(tone).bg, fg: t(tone).fg },
    destructive: { bg: c.destructiveWash, fg: c.destructive },
  };
  const col = colors[variant];
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={small ? (TOUCH - 40) / 2 : 0}
      style={[
        {
          minHeight: small ? 40 : 52,
          paddingHorizontal: small ? space.md - 2 : space.lg,
          borderRadius: radius.pill,
          backgroundColor: col.bg,
          borderWidth: col.border ? 1 : 0,
          borderColor: col.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.xs,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}>
      {icon ? <Icon name={icon} size={small ? 17 : 19} color={col.fg} /> : null}
      <Txt v={small ? 'smallStrong' : 'bodyStrong'} color={col.fg} style={{ flexShrink: 1, minWidth: 0, textAlign: 'center' }} numberOfLines={2}>
        {label}
      </Txt>
    </Touchable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
  tone = 'green',
  small,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName | string;
  tone?: Tone;
  small?: boolean;
}) {
  const { c, tone: t } = useTheme();
  const tt = t(tone);
  const body = (
    <>
      {selected && !icon ? <Icon name="checkmark" size={15} color={tt.fg} /> : icon ? <Icon name={icon} size={15} color={selected ? tt.fg : c.textMuted} /> : null}
      <Txt v={small ? 'caption' : 'smallStrong'} color={selected ? tt.fg : c.text}>
        {label}
      </Txt>
    </>
  );
  const style: ViewStyle = {
    minHeight: small ? 34 : TOUCH,
    paddingHorizontal: small ? space.sm : space.md - 2,
    borderRadius: radius.pill,
    backgroundColor: selected ? tt.bg : c.fill,
    borderWidth: 1,
    borderColor: selected ? tt.fg : 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  };
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Touchable
      onPress={() => {
        selection();
        onPress();
      }}
      hitSlop={small ? (TOUCH - 34) / 2 : 0}
      accessibilityState={{ selected }}
      style={style}>
      {body}
    </Touchable>
  );
}

export function Pill({ label, tone = 'gray', icon }: { label: string; tone?: Tone; icon?: IconName | string }) {
  const { tone: t } = useTheme();
  const tt = t(tone);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: tt.bg, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 }}>
      {icon ? <Icon name={icon} size={12} color={tt.fg} /> : null}
      <Txt v="caption" color={tt.fg} tabular>
        {label}
      </Txt>
    </View>
  );
}

/**
 * A limit indicator: icon + label + value, so state never relies on colour alone
 * (e.g. "Budget · R820 of R900", "Protein · low").
 */
export function StatusBadge({ icon, label, value, note, tone, accessibilityLabel }: { icon: IconName | string; label: string; value: string; note: string; tone: Tone; accessibilityLabel?: string }) {
  const { c, tone: t } = useTheme();
  const tt = t(tone);
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? `${label}: ${value}, ${note}`}
      style={{ flex: 1, minWidth: 96, gap: 1, backgroundColor: c.surface, borderRadius: radius.md, paddingVertical: space.sm - 2, paddingHorizontal: space.sm }}>
      <Row gap={5}>
        <Icon name={icon} size={14} color={tt.fg} />
        <Txt v="caption" muted numberOfLines={1}>
          {label}
        </Txt>
      </Row>
      <Txt v="h3" tabular numberOfLines={1}>
        {value}
      </Txt>
      <Txt v="caption" color={tt.fg} numberOfLines={1}>
        {note}
      </Txt>
    </View>
  );
}

export function IconButton({ icon, label, onPress, tone }: { icon: IconName | string; label: string; onPress: () => void; tone?: Tone }) {
  const { c, tone: t } = useTheme();
  return (
    <Touchable
      onPress={onPress}
      accessibilityLabel={label}
      scaleTo={0.92}
      style={{ width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: tone ? t(tone).bg : c.fill }}>
      <Icon name={icon} size={21} color={tone ? t(tone).fg : c.text} />
    </Touchable>
  );
}

// ---------------------------------------------------------------------------
// Screen: large title that hands off to a translucent compact header on scroll

const COMPACT_BAR = 44;

export function Screen({
  children,
  title,
  subtitle,
  right,
  footer,
  scroll = true,
  back,
  edges = ['top'],
  contentStyle,
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
  back?: () => void;
  edges?: ('top' | 'bottom')[];
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  // Inside the tab navigator the bar floats over content, so pad for it
  const tabBar = useContext(BottomTabBarHeightContext) ?? 0;
  const top = edges.includes('top') ? insets.top : 0;
  const bottom = Math.max(tabBar, edges.includes('bottom') ? insets.bottom : 0);
  const [scrollY] = useState(() => new Animated.Value(0));
  const [titleBottom, setTitleBottom] = useState(top + 64);
  const compact = scrollY.interpolate({ inputRange: [titleBottom - top - COMPACT_BAR - 8, titleBottom - top - COMPACT_BAR + 8], outputRange: [0, 1], extrapolate: 'clamp' });
  const statusScrim = scrollY.interpolate({ inputRange: [0, 12], outputRange: [0, 1], extrapolate: 'clamp' });

  // The content behind this screen's chrome; registered for the tab bar while focused (Android blur)
  const blurTarget = useRef<ViewRef | null>(null);
  const registerTarget = useContext(BlurTargetContext)?.setTarget;
  useFocusEffect(
    useCallback(() => {
      registerTarget?.(blurTarget);
    }, [registerTarget]),
  );

  // Web has no native stack transition, so screens fade and rise in on entry instead
  const reduced = useReducedMotion();
  const [enter] = useState(() => new Animated.Value(Platform.OS === 'web' ? 0 : 1));
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    Animated.timing(enter, { toValue: 1, duration: motion.fadeMs, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [enter]);
  const entrance = { flex: 1, opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [reduced ? 0 : 8, 0] }) }] };

  const header =
    title || back ? (
      <View onLayout={(e: LayoutChangeEvent) => setTitleBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)} style={{ marginBottom: space.lg, gap: space.xs }}>
        {back ? (
          <Row style={{ justifyContent: 'space-between' }}>
            <IconButton icon="chevron-back" label="Back" onPress={back} />
            {right}
          </Row>
        ) : null}
        {title ? (
          <Row gap={space.xs} style={{ alignItems: 'flex-end' }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt v="title" accessibilityLabel={title}>
                {title}
              </Txt>
              {subtitle ? <Txt muted>{subtitle}</Txt> : null}
            </View>
            {back ? null : right}
          </Row>
        ) : null}
      </View>
    ) : null;

  const inner = [styles.inner, { paddingTop: top + space.xs, paddingBottom: bottom + (footer ? 104 : space.xxl) }, contentStyle];
  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: NATIVE_DRIVER });

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <BlurTargetView ref={blurTarget} style={{ flex: 1, backgroundColor: c.background }}>
          <Animated.View style={entrance}>
            {scroll ? (
              <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={inner} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {header}
                {children}
              </Animated.ScrollView>
            ) : (
              <View style={[inner, { flex: 1 }]}>
                {header}
                {children}
              </View>
            )}
          </Animated.View>
        </BlurTargetView>

        {/* Status-bar scrim: content scrolls under a material, never under bare clock text */}
        {top > 0 && scroll ? (
          <Animated.View pointerEvents="none" style={[styles.chromeTop, { height: top, opacity: title ? 0 : statusScrim }]}>
            <Material blurTarget={blurTarget} style={StyleSheet.absoluteFill} />
          </Animated.View>
        ) : null}

        {/* Compact header: fades in as the large title scrolls under it */}
        {title && scroll ? (
          <Animated.View pointerEvents="box-none" style={[styles.chromeTop, { opacity: compact }]}>
            <Material pointerEvents="none" blurTarget={blurTarget} style={StyleSheet.absoluteFill} />
            <View pointerEvents="box-none" style={{ paddingTop: top, height: top + COMPACT_BAR, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs }}>
              <View style={{ width: TOUCH }}>{back ? <IconButton icon="chevron-back" label="Back" onPress={back} /> : null}</View>
              <Txt v="h3" center numberOfLines={1} style={{ flex: 1 }}>
                {title}
              </Txt>
              <View style={{ width: TOUCH }} />
            </View>
            <View pointerEvents="none" style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.separator }} />
          </Animated.View>
        ) : null}

        {footer ? (
          <View pointerEvents="box-none" style={[styles.footer, { bottom: tabBar, paddingBottom: space.sm + (tabBar ? 0 : edges.includes('bottom') ? insets.bottom : 0) }]}>
            {/* Scroll-edge fade instead of a hard opaque strip */}
            <LinearGradient pointerEvents="none" colors={[`${c.background}00`, `${c.background}EE`, c.background]} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
            <View style={{ width: '100%', maxWidth: MAX_WIDTH, gap: space.sm - 2 }}>{footer}</View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Layout

export function Section({ title, action, children, style }: { title: string; action?: { label: string; onPress: () => void }; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={[{ marginTop: space.xxl }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm - 2, minHeight: 28 }}>
        <Txt v="h2" accessibilityLabel={title}>
          {title}
        </Txt>
        {action ? (
          <Touchable onPress={action.onPress} hitSlop={10} scaleTo={0.94} style={{ minHeight: 28, justifyContent: 'center' }}>
            <Txt v="smallStrong" color={c.primary}>
              {action.label}
            </Txt>
          </Touchable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export function Row({ children, gap = 8, style, wrap }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; wrap?: boolean }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>;
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: c.separator, marginVertical: space.sm }, style]} />;
}

/**
 * Inset grouped list (iOS Settings style): one rounded container, hairline
 * separators inset to the text column, optional footnote underneath.
 */
/** Renders children with hairline separators between them, inset to the text column. */
export function Separated({ children, inset = 50 }: { children: ReactNode; inset?: number }) {
  const { c } = useTheme();
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <>
      {items.map((child, i) => (
        <View key={child.key ?? i}>
          {child}
          {i < items.length - 1 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.separator, marginLeft: inset }} /> : null}
        </View>
      ))}
    </>
  );
}

export function Group({ children, footer, inset = 50, style }: { children: ReactNode; footer?: string; inset?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <Card padded={false} style={{ paddingHorizontal: space.md, overflow: 'hidden' }}>
        <Separated inset={inset}>{children}</Separated>
      </Card>
      {footer ? (
        <Txt v="caption" muted style={{ marginTop: space.xs - 2, marginHorizontal: space.md }}>
          {footer}
        </Txt>
      ) : null}
    </View>
  );
}

export function ListRow({
  icon,
  iconTone = 'gray',
  title,
  subtitle,
  right,
  onPress,
  chevron,
}: {
  icon?: IconName | string;
  iconTone?: Tone;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
}) {
  const { c, tone } = useTheme();
  const [hovered, setHovered] = useState(false);
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TOUCH + 8, paddingVertical: space.xs }}>
      {icon ? (
        <View style={{ width: 34, height: 34, flexShrink: 0, borderRadius: radius.sm, backgroundColor: tone(iconTone).bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={18} color={tone(iconTone).fg} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt v="bodyStrong" numberOfLines={2} style={{ flexShrink: 1 }}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt v="small" muted numberOfLines={2}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {right ? <View style={{ maxWidth: '48%', minWidth: 0, flexShrink: 0, alignItems: 'flex-end' }}>{right}</View> : null}
      {chevron ? <Icon name="chevron-forward" size={17} color={c.textFaint} /> : null}
    </View>
  );
  if (!onPress) return content;
  // Rows highlight rather than scale, like a native table cell
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [{ marginHorizontal: -space.sm, paddingHorizontal: space.sm, borderRadius: radius.sm }, POINTER, (pressed || hovered) && { backgroundColor: c.fill }]}>
      {content}
    </Pressable>
  );
}

export function ToggleRow({ title, subtitle, value, onChange, icon }: { title: string; subtitle?: string; value: boolean; onChange: (v: boolean) => void; icon?: IconName | string }) {
  const { c } = useTheme();
  return (
    <ListRow
      icon={icon}
      title={title}
      subtitle={subtitle}
      right={<Switch value={value} onValueChange={onChange} trackColor={{ true: c.success, false: c.fill }} thumbColor="#FFFFFF" ios_backgroundColor={c.fill} accessibilityLabel={title} />}
    />
  );
}

export function Stepper({ value, onChange, min = 0, max = 99, step = 1, format }: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; format?: (n: number) => string }) {
  const change = (n: number) => {
    if (n === value) return;
    selection();
    onChange(n);
  };
  return (
    <Row gap={space.sm}>
      <IconButton icon="remove" label="Decrease" onPress={() => change(Math.max(min, value - step))} />
      <Txt v="h2" tabular style={{ minWidth: 56, textAlign: 'center' }}>
        {format ? format(value) : value}
      </Txt>
      <IconButton icon="add" label="Increase" onPress={() => change(Math.min(max, value + step))} />
    </Row>
  );
}

// ---------------------------------------------------------------------------
// Inputs

export function AmountInput({ value, onChange, label, autoFocus, suffix }: { value: string; onChange: (s: string) => void; label?: string; autoFocus?: boolean; suffix?: string }) {
  const { c } = useTheme();
  const currency = useStore((s) => s.profile.currency);
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Txt v="smallStrong" muted>
          {label}
        </Txt>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.fill, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: 56 }}>
        <Txt v="h2" muted>
          {symbol(currency)}
        </Txt>
        <TextInput
          value={value}
          onChangeText={(text) => {
            const cleaned = text.replace(/,/g, '.').replace(/[^\d.]/g, '');
            const decimal = cleaned.indexOf('.');
            onChange(decimal < 0
              ? cleaned
              : `${cleaned.slice(0, decimal + 1)}${cleaned.slice(decimal + 1).replace(/\./g, '').slice(0, 2)}`);
          }}
          keyboardType="decimal-pad"
          inputMode="decimal"
          autoFocus={autoFocus}
          accessibilityLabel={label ?? 'Amount'}
          placeholder="0"
          placeholderTextColor={c.textFaint}
          style={{ flex: 1, fontFamily: fonts.display, fontSize: 26, color: c.text, paddingHorizontal: space.xs, paddingVertical: space.sm - 2 }}
        />
        {suffix ? <Txt muted>{suffix}</Txt> : null}
      </View>
    </View>
  );
}

export function Field({
  value,
  onChange,
  label,
  placeholder,
  keyboardType,
  autoFocus,
  secure,
  autoComplete,
  textContentType,
}: {
  value: string;
  onChange: (s: string) => void;
  label?: string;
  placeholder?: string;
  keyboardType?: 'email-address' | 'number-pad' | 'default';
  autoFocus?: boolean;
  secure?: boolean;
  autoComplete?: 'email' | 'current-password' | 'new-password' | 'off';
  textContentType?: 'emailAddress' | 'password' | 'newPassword';
}) {
  const { c } = useTheme();
  // Secure fields can be revealed so people can check what their keyboard or autofill entered
  const [revealed, setRevealed] = useState(false);
  // Keyboards must never "correct" credentials
  const literal = secure || keyboardType === 'email-address';
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Txt v="smallStrong" muted>
          {label}
        </Txt>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.fill, borderRadius: radius.md, minHeight: 52 }}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={c.textFaint}
          keyboardType={keyboardType}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect={literal ? false : undefined}
          spellCheck={literal ? false : undefined}
          autoFocus={autoFocus}
          secureTextEntry={secure && !revealed}
          textContentType={textContentType}
          accessibilityLabel={label ?? placeholder}
          style={{ flex: 1, minHeight: 52, paddingLeft: space.md, paddingRight: secure ? 0 : space.md, fontFamily: fonts.regular, fontSize: 17, color: c.text }}
        />
        {secure ? (
          <Touchable
            onPress={() => setRevealed((r) => !r)}
            accessibilityLabel={revealed ? `Hide ${(label ?? 'password').toLowerCase()}` : `Show ${(label ?? 'password').toLowerCase()}`}
            accessibilityState={{ checked: revealed }}
            scaleTo={0.9}
            style={{ width: TOUCH + 4, height: 52, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={revealed ? 'eye-off-outline' : 'eye-outline'} size={21} color={c.textMuted} />
          </Touchable>
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Indicators & selection

export function ProgressBar({ value, tone = 'green', height = 8 }: { value: number; tone?: Tone; height?: number }) {
  const { c, tone: t } = useTheme();
  return (
    <View style={{ height, backgroundColor: c.fill, borderRadius: height, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, height, backgroundColor: t(tone).fg, borderRadius: height }} />
    </View>
  );
}

/** iOS-style segmented control with a sliding thumb (spring, interruptible). */
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const { c, dark } = useTheme();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const segment = width > 0 ? (width - 4) / options.length : 0;
  const [x] = useState(() => new Animated.Value(0));
  const placed = useRef(false);
  useEffect(() => {
    if (!segment) return;
    if (!placed.current || reduced) {
      x.setValue(index * segment);
      placed.current = true;
      return;
    }
    Animated.spring(x, { toValue: index * segment, ...motion.settle, useNativeDriver: NATIVE_DRIVER }).start();
  }, [index, segment, reduced, x]);
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ flexDirection: 'row', backgroundColor: c.fill, borderRadius: radius.md - 2, padding: 2 }}
      accessibilityRole="tablist">
      {segment ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 2,
            bottom: 2,
            left: 2,
            width: segment,
            borderRadius: radius.md - 4,
            backgroundColor: dark ? c.surfaceAlt : c.surface,
            shadowColor: '#000',
            shadowOpacity: dark ? 0 : 0.08,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 1 },
            transform: [{ translateX: x }],
          }}
        />
      ) : null}
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              if (active) return;
              selection();
              onChange(o.value);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={{ ...POINTER, flex: 1, minHeight: 36, borderRadius: radius.md - 4, alignItems: 'center', justifyContent: 'center', backgroundColor: !segment && active ? c.surface : 'transparent' }}>
            <Txt v="smallStrong" color={active ? c.text : c.textMuted}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Cross-fades its children in whenever `swapKey` changes (a swapped meal, a new
 * onboarding step). Reduced motion keeps the fade and drops the movement.
 */
export function FadeSwap({ swapKey, children, style, from = 6, axis = 'y' }: { swapKey: string | number; children: ReactNode; style?: StyleProp<ViewStyle>; from?: number; axis?: 'x' | 'y' }) {
  const reduced = useReducedMotion();
  const [p] = useState(() => new Animated.Value(1));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    p.setValue(0);
    Animated.timing(p, { toValue: 1, duration: motion.fadeMs, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE_DRIVER }).start();
  }, [swapKey, p]);
  const shift = p.interpolate({ inputRange: [0, 1], outputRange: [reduced ? 0 : from, 0] });
  return <Animated.View style={[style, { opacity: p, transform: axis === 'x' ? [{ translateX: shift }] : [{ translateY: shift }] }]}>{children}</Animated.View>;
}

// ---------------------------------------------------------------------------
// Sheets & states

/** Bottom sheet (thumb-first, spec §8.1). */
export function Sheet({ visible, onClose, title, children, footer }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode; footer?: ReactNode }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: c.overlay }} onPress={onClose} accessibilityLabel="Close sheet" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' }}>
        <View style={{ width: '100%', maxWidth: MAX_WIDTH, maxHeight: '88%', backgroundColor: c.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: Math.max(insets.bottom, space.md) }}>
          <View style={{ alignItems: 'center', paddingTop: space.xs }}>
            <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: c.fill }} />
          </View>
          {title ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.sm }}>
              <Txt v="h2" style={{ flex: 1 }}>
                {title}
              </Txt>
              <IconButton icon="close" label="Close" onPress={onClose} />
            </View>
          ) : null}
          <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: space.sm - 2, gap: space.sm }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingHorizontal: space.lg, gap: space.sm - 2 }}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function TrustStrip({ text }: { text?: string }) {
  const { tone } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space.sm - 2, alignItems: 'flex-start', backgroundColor: tone('green').bg, borderRadius: radius.md, padding: space.sm + 2 }}>
      <Icon name="lock-closed" size={18} color={tone('green').fg} />
      <Txt v="small" color={tone('green').fg} style={{ flex: 1 }}>
        {text ?? 'Your documents stay on this device. Payslip PDFs are parsed locally; photo OCR is not available yet.'}
      </Txt>
    </View>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName | string; title: string; body: string; action?: ReactNode }) {
  const { tone } = useTheme();
  return (
    <View style={{ alignItems: 'center', padding: space.xl, gap: space.sm - 2 }}>
      <View style={{ width: 84, height: 72, borderTopLeftRadius: 44, borderTopRightRadius: 30, borderBottomLeftRadius: 28, borderBottomRightRadius: 46, backgroundColor: tone('amber').bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={30} color={tone('amber').fg} />
      </View>
      <Txt v="h3" center>
        {title}
      </Txt>
      <Txt v="small" muted center style={{ maxWidth: 300 }}>
        {body}
      </Txt>
      {action}
    </View>
  );
}

/** The user's currency, for money() formatting. */
export function useCurrency() {
  return useStore((s) => s.profile.currency);
}

const styles = StyleSheet.create({
  inner: { paddingHorizontal: space.md, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  chromeTop: { position: 'absolute', top: 0, left: 0, right: 0 },
  footer: { position: 'absolute', left: 0, right: 0, paddingHorizontal: space.md, paddingTop: space.sm - 2, alignItems: 'center' },
});
