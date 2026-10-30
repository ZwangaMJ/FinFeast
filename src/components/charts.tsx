import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { Txt } from '@/components/ui';
import { DAY_SHORT } from '@/lib/dates';
import { fonts, useTheme, type Tone } from '@/theme';

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

/** Animated 0→value with 250ms ease-out; instant when reduced motion is on. */
function useAnimatedNumber(value: number) {
  const reduced = useReducedMotion();
  const [anim] = useState(() => new Animated.Value(0));
  const [v, setV] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const id = anim.addListener(({ value: x }) => setV(x));
    Animated.timing(anim, { toValue: value, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    return () => anim.removeListener(id);
  }, [value, reduced, anim]);
  return reduced ? value : v;
}

export function Ring({
  value,
  size = 120,
  stroke = 10,
  tone = 'green',
  overTone = 'amber',
  children,
  accessibilityLabel,
}: {
  value: number; // 0..1 (may exceed 1)
  size?: number;
  stroke?: number;
  tone?: Tone;
  overTone?: Tone;
  children?: ReactNode;
  accessibilityLabel: string;
}) {
  const { c, tone: t } = useTheme();
  const shown = useAnimatedNumber(Math.max(0, value));
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const over = value > 1;
  const color = over ? t(overTone).fg : t(tone).fg;
  const frac = Math.min(1, shown);
  return (
    <View style={{ width: size, height: size }} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.grayWash} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={circ * (1 - frac)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        {over ? (
          // Over-budget: dashed outer pattern so meaning isn't carried by colour alone
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.surface} strokeWidth={2} strokeDasharray="3 6" fill="none" />
        ) : null}
      </Svg>
      <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>{children}</View>
    </View>
  );
}

/** Weekly food spend: actual (green, amber when over) against plan (outlined marker). */
export function SpendBars({ weeks, currencyFmt }: { weeks: { label: string; actual: number; plan: number }[]; currencyFmt: (n: number) => string }) {
  const { c } = useTheme();
  const W = 320;
  const H = 150;
  const max = Math.max(1, ...weeks.flatMap((w) => [w.actual, w.plan])) * 1.1;
  const bw = W / weeks.length;
  const y = (v: number) => H - 22 - (v / max) * (H - 34);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={weeks.map((w) => `${w.label}: spent ${currencyFmt(w.actual)}${w.plan ? ` of ${currencyFmt(w.plan)} planned` : ''}`).join('. ')}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {weeks.map((w, i) => {
          const x = i * bw + bw * 0.22;
          const width = bw * 0.56;
          const over = w.plan > 0 && w.actual > w.plan;
          const within = Math.min(w.actual, w.plan || w.actual);
          return (
            <G key={w.label}>
              <Rect x={x} y={y(within)} width={width} height={Math.max(0, H - 22 - y(within))} rx={6} fill={c.primary} opacity={0.9} />
              {over ? <Rect x={x} y={y(w.actual)} width={width} height={y(within) - y(w.actual)} rx={6} fill={c.amberStrong} /> : null}
              {w.plan > 0 ? <Line x1={x - 4} x2={x + width + 4} y1={y(w.plan)} y2={y(w.plan)} stroke={c.text} strokeWidth={2} strokeDasharray="4 3" /> : null}
              <SvgText x={x + width / 2} y={H - 6} fontSize={10} fill={c.textMuted} textAnchor="middle" fontFamily={fonts.medium}>
                {w.label}
              </SvgText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

/** Calendar heat strip of eating-out spend by weekday (risky-day prediction). */
export function HeatStrip({ days, currencyFmt }: { days: { day: number; avg: number; intensity: number; risky: boolean }[]; currencyFmt: (n: number) => string }) {
  const { c, tone } = useTheme();
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <View style={{ flexDirection: 'row', gap: 6 }} accessible accessibilityLabel={order.map((d) => `${DAY_SHORT[d]} ${currencyFmt(days[d].avg)}${days[d].risky ? ', high-risk day' : ''}`).join(', ')}>
      {order.map((d) => {
        const day = days[d];
        const bg = day.risky ? c.amberStrong : day.intensity > 0.05 ? c.primary : c.grayWash;
        const opacity = day.risky ? 1 : 0.18 + day.intensity * 0.6;
        return (
          <View key={d} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            <View style={{ width: '100%', height: 40, borderRadius: 10, overflow: 'hidden', backgroundColor: c.grayWash, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ position: 'absolute', inset: 0, backgroundColor: bg, opacity }} />
              {day.risky ? <Txt v="caption" color={tone('amber').bg}>!</Txt> : null}
            </View>
            <Txt v="caption" muted>
              {DAY_SHORT[d]}
            </Txt>
          </View>
        );
      })}
    </View>
  );
}

/** Month cashflow line: actual-to-date solid, projection dashed, bill days marked. */
export function ForecastChart({ points, bills, band }: { points: { day: number; balance: number; actual: boolean }[]; bills: { day: number }[]; band: number }) {
  const { c } = useTheme();
  const W = 320;
  const H = 120;
  const vals = points.map((p) => p.balance);
  const max = Math.max(...vals, 0) + band;
  const min = Math.min(...vals, 0) - band;
  const x = (d: number) => ((d - 1) / Math.max(1, points.length - 1)) * (W - 8) + 4;
  const y = (v: number) => 8 + (1 - (v - min) / Math.max(1, max - min)) * (H - 24);
  const actual = points.filter((p) => p.actual);
  const proj = points.filter((p, i) => !p.actual || (points[i + 1] && !points[i + 1].actual));
  const path = (pts: typeof points) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const bandPath = proj.length
    ? `${proj.map((p, i) => `${i ? 'L' : 'M'}${x(p.day)},${y(p.balance + (band * (p.day - proj[0].day)) / Math.max(1, last.day - proj[0].day))}`).join(' ')} ${[...proj]
        .reverse()
        .map((p) => `L${x(p.day)},${y(p.balance - (band * (p.day - proj[0].day)) / Math.max(1, last.day - proj[0].day))}`)
        .join(' ')} Z`
    : '';
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      <Line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke={c.border} strokeWidth={1} />
      {bandPath ? <Path d={bandPath} fill={c.primary} opacity={0.12} /> : null}
      {bills.map((b, i) => (
        <Line key={i} x1={x(b.day)} x2={x(b.day)} y1={H - 14} y2={H - 6} stroke={c.amber} strokeWidth={2} strokeLinecap="round" />
      ))}
      <Path d={path(actual)} stroke={c.primary} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d={path(proj)} stroke={c.primary} strokeWidth={2} fill="none" strokeDasharray="5 4" strokeLinecap="round" />
      {actual.length ? <Circle cx={x(actual[actual.length - 1].day)} cy={y(actual[actual.length - 1].balance)} r={4.5} fill={c.primary} stroke={c.surface} strokeWidth={2} /> : null}
    </Svg>
  );
}
