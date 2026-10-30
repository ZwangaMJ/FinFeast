export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function iso(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseIso(s: string) {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today() {
  return iso(new Date());
}

export function addDays(s: string, n: number) {
  const d = parseIso(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}

/** Monday of the week containing s. */
export function weekStart(s: string = today()) {
  const d = parseIso(s);
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return iso(d);
}

export function monthStart(s: string = today()) {
  return s.slice(0, 8) + '01';
}

export function daysInMonth(s: string = today()) {
  const d = parseIso(s);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export function daysBetween(a: string, b: string) {
  return Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86400000);
}

export function weekday(s: string) {
  return parseIso(s).getDay();
}

export function shortDate(s: string) {
  const d = parseIso(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function monthName(s: string = today()) {
  const d = parseIso(s);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function inRange(s: string, start: string, endExclusive: string) {
  return s >= start && s < endExclusive;
}
