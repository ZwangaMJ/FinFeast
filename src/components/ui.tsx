import Ionicons from '@expo/vector-icons/Ionicons';
import { type ComponentProps, type ReactNode } from 'react';
import {
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
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { symbol } from '@/lib/format';
import { useStore } from '@/store/useStore';
import { fonts, radius, useTheme, type Tone } from '@/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export const MAX_WIDTH = 560;

export function Icon({ name, size = 20, color, style }: { name: IconName | string; size?: number; color?: ColorValue; style?: StyleProp<TextStyle> }) {
  const { c } = useTheme();
  return <Ionicons name={name as IconName} size={size} color={(color ?? c.text) as string} style={style} />;
}

type Variant = 'hero' | 'display' | 'title' | 'h2' | 'h3' | 'body' | 'bodyStrong' | 'small' | 'smallStrong' | 'caption' | 'label';

const VARIANTS: Record<Variant, TextStyle> = {
  hero: { fontFamily: fonts.display, fontSize: 44, lineHeight: 50, letterSpacing: -0.5 },
  display: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36 },
  title: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 32, letterSpacing: -0.3 },
  h2: { fontFamily: fonts.bold, fontSize: 19, lineHeight: 25 },
  h3: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  smallStrong: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  label: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, letterSpacing: 0.8, textTransform: 'uppercase' },
};

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
  v?: Variant;
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
      style={[VARIANTS[v], { color: col }, center && { textAlign: 'center' }, isNumeric && { fontVariant: ['tabular-nums', 'lining-nums'] }, style]}>
      {children}
    </Text>
  );
}

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
    padding: padded ? 18 : 0,
    borderWidth: dark || tone ? 0 : StyleSheet.hairlineWidth,
    borderColor: c.border,
    shadowColor: '#3C2A10',
    shadowOpacity: dark || tone ? 0 : 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: dark || tone ? 0 : 1,
  };
  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={({ pressed }) => [base, pressed && { opacity: 0.85, transform: [{ scale: 0.995 }] }, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}

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
    secondary: { bg: 'transparent', fg: c.text, border: c.border },
    ghost: { bg: 'transparent', fg: t(tone).fg },
    tonal: { bg: t(tone).bg, fg: t(tone).fg },
    destructive: { bg: c.destructiveWash, fg: c.destructive },
  };
  const col = colors[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      hitSlop={small ? 6 : 0}
      style={({ pressed }) => [
        {
          minHeight: small ? 38 : 52,
          paddingHorizontal: small ? 14 : 20,
          borderRadius: radius.pill,
          backgroundColor: col.bg,
          borderWidth: col.border ? 1 : 0,
          borderColor: col.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
        style,
      ]}>
      {icon ? <Icon name={icon} size={small ? 16 : 19} color={col.fg} /> : null}
      <Txt v={small ? 'smallStrong' : 'bodyStrong'} color={col.fg} style={{ flexShrink: 1, minWidth: 0, textAlign: 'center' }} numberOfLines={2}>
        {label}
      </Txt>
    </Pressable>
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
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        minHeight: small ? 30 : 44,
        paddingHorizontal: small ? 10 : 14,
        borderRadius: radius.pill,
        backgroundColor: selected ? tt.bg : c.surface,
        borderWidth: 1,
        borderColor: selected ? tt.fg : c.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        opacity: pressed ? 0.8 : 1,
      })}>
      {selected && !icon ? <Icon name="checkmark" size={15} color={tt.fg} /> : icon ? <Icon name={icon} size={15} color={selected ? tt.fg : c.textMuted} /> : null}
      <Txt v={small ? 'caption' : 'smallStrong'} color={selected ? tt.fg : c.text}>
        {label}
      </Txt>
    </Pressable>
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
  const header =
    title || back ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 18 }}>
        {back ? <IconButton icon="chevron-back" label="Back" onPress={back} /> : null}
        <View style={{ flex: 1 }}>
          {title ? <Txt v="title">{title}</Txt> : null}
          {subtitle ? <Txt muted>{subtitle}</Txt> : null}
        </View>
        {right}
      </View>
    ) : null;
  const inner = [styles.inner, { paddingBottom: footer ? 120 : 40 }, contentStyle];
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {scroll ? (
          <ScrollView contentContainerStyle={inner} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {header}
            {children}
          </ScrollView>
        ) : (
          <View style={[inner, { flex: 1 }]}>
            {header}
            {children}
          </View>
        )}
        {footer ? (
          <View style={[styles.footer, { backgroundColor: c.background, paddingBottom: 16 + (edges.includes('bottom') ? insets.bottom : 0) }]}>
            <View style={{ width: '100%', maxWidth: MAX_WIDTH, gap: 10 }}>{footer}</View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function IconButton({ icon, label, onPress, tone }: { icon: IconName | string; label: string; onPress: () => void; tone?: Tone }) {
  const { c, tone: t } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tone ? t(tone).bg : c.surface,
        opacity: pressed ? 0.7 : 1,
      })}>
      <Icon name={icon} size={21} color={tone ? t(tone).fg : c.text} />
    </Pressable>
  );
}

export function Section({ title, action, children, style }: { title: string; action?: { label: string; onPress: () => void }; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={[{ marginTop: 26 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Txt v="h2">{title}</Txt>
        {action ? (
          <Pressable onPress={action.onPress} accessibilityRole="button" hitSlop={10} style={{ minHeight: 32, justifyContent: 'center' }}>
            <Txt v="smallStrong" color={c.primary}>
              {action.label}
            </Txt>
          </Pressable>
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
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: 12 }, style]} />;
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
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 52, paddingVertical: 8 }}>
      {icon ? (
        <View style={{ width: 38, height: 38, flexShrink: 0, marginTop: 2, borderRadius: 12, backgroundColor: tone(iconTone).bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={19} color={tone(iconTone).fg} />
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
      {chevron ? <Icon name="chevron-forward" size={18} color={c.textFaint} /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title} style={({ pressed }) => pressed && { opacity: 0.7 }}>
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
      right={<Switch value={value} onValueChange={onChange} trackColor={{ true: c.primary, false: c.border }} thumbColor="#FFFFFF" accessibilityLabel={title} />}
    />
  );
}

export function Stepper({ value, onChange, min = 0, max = 99, step = 1, format }: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; format?: (n: number) => string }) {
  return (
    <Row gap={12}>
      <IconButton icon="remove" label="Decrease" tone="gray" onPress={() => onChange(Math.max(min, value - step))} />
      <Txt v="h2" tabular style={{ minWidth: 56, textAlign: 'center' }}>
        {format ? format(value) : value}
      </Txt>
      <IconButton icon="add" label="Increase" tone="gray" onPress={() => onChange(Math.min(max, value + step))} />
    </Row>
  );
}

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
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.surfaceAlt, borderRadius: radius.md, paddingHorizontal: 16, minHeight: 56 }}>
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
          style={{ flex: 1, fontFamily: fonts.display, fontSize: 26, color: c.text, paddingHorizontal: 8, paddingVertical: 10 }}
        />
        {suffix ? <Txt muted>{suffix}</Txt> : null}
      </View>
    </View>
  );
}

export function Field({ value, onChange, label, placeholder, keyboardType, autoFocus, secure }: { value: string; onChange: (s: string) => void; label?: string; placeholder?: string; keyboardType?: 'email-address' | 'number-pad' | 'default'; autoFocus?: boolean; secure?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Txt v="smallStrong" muted>
          {label}
        </Txt>
      ) : null}
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.textFaint}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoFocus={autoFocus}
        secureTextEntry={secure}
        accessibilityLabel={label ?? placeholder}
        style={{ backgroundColor: c.surfaceAlt, borderRadius: radius.md, paddingHorizontal: 16, minHeight: 52, fontFamily: fonts.regular, fontSize: 16, color: c.text }}
      />
    </View>
  );
}

export function ProgressBar({ value, tone = 'green', height = 8 }: { value: number; tone?: Tone; height?: number }) {
  const { c, tone: t } = useTheme();
  return (
    <View style={{ height, backgroundColor: c.grayWash, borderRadius: height, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, height, backgroundColor: t(tone).fg, borderRadius: height }} />
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: c.surfaceAlt, borderRadius: radius.pill, padding: 4 }} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={{ flex: 1, minHeight: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? c.surface : 'transparent' }}>
            <Txt v="smallStrong" color={active ? c.text : c.textMuted}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Bottom sheet (thumb-first, spec §8.1). */
export function Sheet({ visible, onClose, title, children, footer }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode; footer?: ReactNode }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: c.overlay }} onPress={onClose} accessibilityLabel="Close sheet" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' }}>
        <View style={{ width: '100%', maxWidth: MAX_WIDTH, maxHeight: '88%', backgroundColor: c.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: Math.max(insets.bottom, 16) }}>
          <View style={{ alignItems: 'center', paddingTop: 10 }}>
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: c.border }} />
          </View>
          {title ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12 }}>
              <Txt v="h2" style={{ flex: 1 }}>
                {title}
              </Txt>
              <IconButton icon="close" label="Close" onPress={onClose} />
            </View>
          ) : null}
          <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 10, gap: 12 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingHorizontal: 20, gap: 10 }}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function TrustStrip({ text }: { text?: string }) {
  const { tone } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: tone('green').bg, borderRadius: radius.md, padding: 14 }}>
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
    <View style={{ alignItems: 'center', padding: 24, gap: 10 }}>
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
  inner: { padding: 16, paddingTop: 12, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, alignItems: 'center' },
});
