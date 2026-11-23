import { type ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { Txt } from '@/components/ui';
import { DAY_SHORT } from '@/lib/dates';
import { fonts, useTheme, type Tone } from '@/theme';

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
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const over = safeValue > 1;
  const color = over ? t(overTone).fg : t(tone).fg;
  const frac = Math.min(1, safeValue);
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
export function SpendBars({ weeks, currencyFmt }: { weeks: readonly { label: string; actual: number; plan: number }[]; currencyFmt: (n: number) => string }) {
  const { c } = useTheme();
  const W = 320;
  const H = 150;
  const safeWeeks = weeks.map((week) => ({
    ...week,
    actual: Number.isFinite(week.actual) ? Math.max(0, week.actual) : 0,
    plan: Number.isFinite(week.plan) ? Math.max(0, week.plan) : 0,
  }));
  const max = Math.max(1, ...safeWeeks.flatMap((w) => [w.actual, w.plan])) * 1.1;
  const bw = W / Math.max(1, safeWeeks.length);
  const y = (v: number) => H - 22 - (v / max) * (H - 34);
  if (!safeWeeks.length) {
    return (
      <View accessible accessibilityRole="image" accessibilityLabel="No weekly spending data yet" style={{ height: H, justifyContent: 'center' }}>
        <Txt v="small" muted>No weekly spending data yet.</Txt>
      </View>
    );
  }
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={safeWeeks.map((w) => `${w.label}: spent ${currencyFmt(w.actual)}${w.plan ? ` of ${currencyFmt(w.plan)} planned` : ''}`).join('. ')}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {safeWeeks.map((w, i) => {
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
export function HeatStrip({ days, currencyFmt }: { days: readonly { day: number; avg: number; intensity: number; risky: boolean }[]; currencyFmt: (n: number) => string }) {
  const { c, tone } = useTheme();
  const order = [1, 2, 3, 4, 5, 6, 0];
  const byDay = new Map(days.map((day) => [day.day, {
    avg: Number.isFinite(day.avg) ? Math.max(0, day.avg) : 0,
    intensity: Number.isFinite(day.intensity) ? Math.max(0, Math.min(1, day.intensity)) : 0,
    risky: day.risky,
  }]));
  const safeDay = (day: number) => byDay.get(day) ?? { avg: 0, intensity: 0, risky: false };
  return (
    <View style={{ flexDirection: 'row', gap: 6 }} accessible accessibilityLabel={order.map((d) => {
      const item = safeDay(d);
      return `${DAY_SHORT[d]} ${currencyFmt(item.avg)}${item.risky ? ', high-risk day' : ''}`;
    }).join(', ')}>
      {order.map((d) => {
        const day = safeDay(d);
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
export function ForecastChart({ points, bills, band }: { points: readonly { day: number; balance: number; actual: boolean }[]; bills: readonly { day: number }[]; band: number }) {
  const { c } = useTheme();
  const W = 320;
  const H = 120;
  const safePoints = points.filter((point) => Number.isFinite(point.day) && Number.isFinite(point.balance));
  if (!safePoints.length) {
    return (
      <View accessible accessibilityRole="image" accessibilityLabel="No cash-flow forecast data yet" style={{ height: H, justifyContent: 'center' }}>
        <Txt v="small" muted>No forecast data yet.</Txt>
      </View>
    );
  }
  const safeBand = Number.isFinite(band) ? Math.abs(band) : 0;
  const vals = safePoints.map((p) => p.balance);
  let max = Math.max(...vals, 0) + safeBand;
  let min = Math.min(...vals, 0) - safeBand;
  if (max - min < 1) {
    max += 0.5;
    min -= 0.5;
  }
  const lastDay = Math.max(1, ...safePoints.map((point) => point.day));
  const x = (d: number) => ((Math.max(1, Math.min(lastDay, d)) - 1) / Math.max(1, lastDay - 1)) * (W - 8) + 4;
  const y = (v: number) => 8 + (1 - (v - min) / (max - min)) * (H - 24);
  const actual = safePoints.filter((p) => p.actual);
  const proj = safePoints.filter((p, i) => !p.actual || Boolean(safePoints[i + 1] && !safePoints[i + 1].actual));
  const path = (pts: typeof safePoints) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ');
  const last = safePoints[safePoints.length - 1];
  const bandPath = proj.length
    ? `${proj.map((p, i) => `${i ? 'L' : 'M'}${x(p.day)},${y(p.balance + (safeBand * (p.day - proj[0].day)) / Math.max(1, last.day - proj[0].day))}`).join(' ')} ${[...proj]
        .reverse()
        .map((p) => `L${x(p.day)},${y(p.balance - (safeBand * (p.day - proj[0].day)) / Math.max(1, last.day - proj[0].day))}`)
        .join(' ')} Z`
    : '';
  const safeBills = bills.filter((bill) => Number.isFinite(bill.day));
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      <Line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke={c.border} strokeWidth={1} />
      {bandPath ? <Path d={bandPath} fill={c.primary} opacity={0.12} /> : null}
      {safeBills.map((b, i) => (
        <Line key={i} x1={x(b.day)} x2={x(b.day)} y1={H - 14} y2={H - 6} stroke={c.amber} strokeWidth={2} strokeLinecap="round" />
      ))}
      <Path d={path(actual)} stroke={c.primary} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d={path(proj)} stroke={c.primary} strokeWidth={2} fill="none" strokeDasharray="5 4" strokeLinecap="round" />
      {actual.length ? <Circle cx={x(actual[actual.length - 1].day)} cy={y(actual[actual.length - 1].balance)} r={4.5} fill={c.primary} stroke={c.surface} strokeWidth={2} /> : null}
    </Svg>
  );
}
