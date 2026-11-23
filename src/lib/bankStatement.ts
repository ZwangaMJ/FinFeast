/**
 * Bank statement parsing, categorisation and anomaly detection (FNB-first).
 *
 * The core (`parseStatementText`, `parseStatementItems`) is pure: no clock reads,
 * no thrown errors — it returns a `Result`. The legacy `parseBankStatementText` /
 * `parseBankStatementItems` are thin boundary adapters that supply the current
 * year and throw, for callers that still expect exceptions.
 */
import { err, ok, type Result } from '@/lib/fp';
import type { Category, Confidence, Transaction } from '@/store/types';

export type StatementBalance = Readonly<{
  amount: number;
  signedAmount: number;
  indicator: 'Dr' | 'Cr' | null;
}>;

export type StatementCategory =
  | 'income'
  | 'debt'
  | 'groceries'
  | 'transport'
  | 'dining'
  | 'fees'
  | 'utilities'
  | 'entertainment'
  | 'cash'
  | 'shopping'
  | 'health'
  | 'transfer'
  | 'other';

export type StatementIssue =
  | 'balance_mismatch'
  | 'out_of_order'
  | 'duplicate_charge'
  | 'unusual_spike'
  | 'failed_transaction_fee'
  | 'debit_order_attempt';

export type StatementTransaction = Readonly<{
  id: string;
  date: string;
  descriptionRaw: string;
  description: string;
  merchant: string;
  amount: number;
  flow: 'debit' | 'credit';
  posted: boolean;
  incomeSource: 'salary' | 'other' | null;
  category: StatementCategory;
  runningBalance: StatementBalance | null;
  balanceCheck: 'matched' | 'mismatch' | 'unavailable';
  confidence: Confidence;
  issues: readonly StatementIssue[];
}>;

export type RecurringObligation = Readonly<{
  merchant: string;
  category: 'debt' | 'fees' | 'utilities' | 'entertainment' | 'other';
  averageAmount: number;
  cadence: 'weekly' | 'monthly' | 'irregular';
  occurrences: number;
  firstDate: string;
  lastDate: string;
}>;

export type StatementAnomaly = Readonly<{
  kind: StatementIssue;
  transactionId: string;
  date: string;
  description: string;
  amount: number;
  message: string;
}>;

export type PayCycle = Readonly<{
  start: string;
  end: string;
  days: number;
  income: number;
  outflow: number;
  outflowPerDay: number;
  postPaydayOutflow: number;
  prePaydayOutflow: number;
  netCashFlow: number;
  endingBalance: number | null;
}>;

export type BankStatementAnalysis = Readonly<{
  totalCredits: number;
  totalDebits: number;
  netCashFlow: number;
  recognizedIncome: number;
  debtPayments: number;
  bankFees: number;
  debtBurdenPercent: number | null;
  feeBurdenPercent: number | null;
  cash: Readonly<{
    atmWithdrawals: number;
    cashBack: number;
    digitalCardSpend: number;
  }>;
  recurringObligations: readonly RecurringObligation[];
  payCycles: readonly PayCycle[];
  anomalies: readonly StatementAnomaly[];
  insights: readonly string[];
  balanceReconciliation: 'matched' | 'mismatch' | 'unavailable';
}>;

export type BankStatementDocument = Readonly<{
  bank: 'FNB' | 'unknown';
  accountType: 'Aspire Current Account' | null;
  accountNumber: string | null;
  currency: 'ZAR';
  period: Readonly<{ start: string | null; end: string | null }>;
  openingBalance: StatementBalance | null;
  closingBalance: StatementBalance | null;
  pages: number;
  transactions: readonly StatementTransaction[];
  analysis: BankStatementAnalysis;
}>;

export type BankStatementTextItem = Readonly<{
  str: string;
  transform?: readonly number[];
  page?: number;
}>;

export type StatementParseError = Readonly<{
  kind: 'no_dated_transactions' | 'no_monetary_transactions';
  message: string;
}>;

export type StatementParseOptions = Readonly<{
  pages?: number;
  /** Year for rows like "01 Mar" when the statement gives no period and no prior row has a year. */
  fallbackYear: number;
}>;

export class BankStatementPdfError extends Error {
  public reason: 'illegible' | 'unsupported';

  constructor(
    reason: 'illegible' | 'unsupported',
    message: string,
  ) {
    super(message);
    this.name = 'BankStatementPdfError';
    this.reason = reason;
  }
}

type ParsedDate = { year: number | null; month: number; day: number; iso: string | null };
type RawTransaction = { date: ParsedDate; text: string };
type AmountToken = { start: number; end: number; value: number; indicator: 'Dr' | 'Cr' | null };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const DATE_AT_START =
  /^\s*(?:(\d{4})[/-](\d{1,2})[/-](\d{1,2})|(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?|(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{4}))?)(?=\s|$|[|])/;
const EXPLICIT_DATE =
  /\b(?:(\d{4})[/-](\d{1,2})[/-](\d{1,2})|(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})|(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4}))\b/g;
const AMOUNT_PATTERN =
  /(?:\bR\s*)?[-+]?(?:(?:\d{1,3}(?:[ \u00a0]\d{3})+)|(?:\d{1,3}(?:,\d{3})+)|(?:\d{1,3}(?:\.\d{3})+)|\d+)[.,]\d{2}(?:\s*(?:Cr|Dr))?/gi;
const MONEY_TOKEN = /(?:\bR\s*)?([-+]?(?:(?:\d{1,3}(?:[ \u00a0]\d{3})+)|(?:\d{1,3}(?:,\d{3})+)|(?:\d{1,3}(?:\.\d{3})+)|\d+)[.,]\d{2})\s*(Cr|Dr)?/i;
/** A debit order / subscription collection that was attempted but failed or was returned. */
const FAILED_DEBIT_ORDER =
  /(?:debicheck|debit order|edo collection|subscription).*(?:attempt|declined|failed|returned|unpaid|unsuccessful)|(?:attempt|declined|failed|returned|unpaid|unsuccessful).*(?:debicheck|debit order|edo collection|subscription)/i;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function parseStatementAmount(input: string): number | null {
  let value = input.trim().replace(/^R\s*/i, '').replace(/[\s\u00a0\u202f]/g, '').replace(/[^\d,.-]/g, '');
  if (!value || !/\d/.test(value)) return null;
  const negative = value.startsWith('-') || (input.trim().startsWith('(') && input.trim().endsWith(')'));
  value = value.replace(/[+-]/g, '');
  const comma = value.lastIndexOf(',');
  const dot = value.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    value = comma > dot ? value.replace(/\./g, '').replace(',', '.') : value.replace(/,/g, '');
  } else if (comma >= 0) {
    value = /\d,\d{2}$/.test(value) ? value.replace(',', '.') : value.replace(/,/g, '');
  } else if (dot >= 0 && !/\.\d{2}$/.test(value)) {
    value = value.replace(/\./g, '');
  }
  const amount = Number(value);
  return Number.isFinite(amount) ? roundMoney(negative ? -amount : amount) : null;
}

function parseDatePrefix(line: string): { date: ParsedDate; rest: string } | null {
  const match = line.match(DATE_AT_START);
  if (!match) return null;
  let year: number | null;
  let month: number;
  let day: number;
  if (match[1]) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else if (match[4]) {
    day = Number(match[4]);
    month = Number(match[5]);
    year = match[6] ? Number(match[6].length === 2 ? `20${match[6]}` : match[6]) : null;
  } else {
    day = Number(match[7]);
    month = MONTHS[match[8].toLowerCase()];
    year = match[9] ? Number(match[9]) : null;
  }
  if (!validParts(year ?? 2000, month, day)) return null;
  return { date: { year, month, day, iso: year ? toIso(year, month, day) : null }, rest: line.slice(match[0].length).trim() };
}

function validParts(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function toIso(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function explicitDateParts(match: RegExpMatchArray): readonly [number, number, number] {
  if (match[1]) return [Number(match[1]), Number(match[2]), Number(match[3])];
  if (match[4]) return [Number(match[6].length === 2 ? `20${match[6]}` : match[6]), Number(match[5]), Number(match[4])];
  return [Number(match[9]), MONTHS[match[8].toLowerCase()], Number(match[7])];
}

function parseExplicitDates(text: string): ParsedDate[] {
  return [...text.matchAll(EXPLICIT_DATE)].flatMap((match) => {
    const [year, month, day] = explicitDateParts(match);
    return validParts(year, month, day) ? [{ year, month, day, iso: toIso(year, month, day) }] : [];
  });
}

function balanceFrom(value: string): StatementBalance | null {
  const match = value.match(MONEY_TOKEN);
  if (!match) return null;
  const amount = parseStatementAmount(match[1]);
  if (amount === null) return null;
  const indicator = match[2] ? (match[2].toLowerCase() === 'dr' ? 'Dr' : 'Cr') : null;
  const signedAmount = indicator === 'Dr' ? -Math.abs(amount) : indicator === 'Cr' ? Math.abs(amount) : amount;
  return { amount: Math.abs(amount), signedAmount: roundMoney(signedAmount), indicator };
}

function resolveMovement(
  amount: number,
  amountIndicator: 'Dr' | 'Cr' | null,
  balance: StatementBalance | null,
  previousBalance: number | null,
  description: string,
): { flow: 'debit' | 'credit'; runningBalance: StatementBalance | null; posted: boolean } {
  let flow: 'debit' | 'credit' = amountIndicator === 'Cr' ? 'credit' : 'debit';
  let runningBalance = balance;
  const isAttempt = FAILED_DEBIT_ORDER.test(description);

  if (!balance || previousBalance === null) {
    return { flow: isAttempt ? 'debit' : flow, runningBalance, posted: true };
  }

  const unchanged = balance.indicator
    ? Math.abs(balance.signedAmount - previousBalance) <= 0.02
    : Math.abs(balance.amount - Math.abs(previousBalance)) <= 0.02;
  if (isAttempt && unchanged) {
    runningBalance = balance.indicator
      ? balance
      : { ...balance, signedAmount: roundMoney(previousBalance) };
    return { flow: 'debit', runningBalance, posted: false };
  }

  for (const candidate of ['debit', 'credit'] as const) {
    const expected = roundMoney(previousBalance + (candidate === 'credit' ? amount : -amount));
    const matches = balance.indicator
      ? Math.abs(expected - balance.signedAmount) <= 0.02
      : Math.abs(Math.abs(expected) - balance.amount) <= 0.02;
    if (!matches) continue;
    flow = candidate;
    if (!balance.indicator) runningBalance = { ...balance, signedAmount: expected };
    break;
  }

  return { flow, runningBalance, posted: true };
}

function amountTokens(text: string): AmountToken[] {
  return [...text.matchAll(AMOUNT_PATTERN)].flatMap((match): AmountToken[] => {
    const raw = match[0];
    const value = parseStatementAmount(raw);
    if (value === null) return [];
    const indicator = /Cr\s*$/i.test(raw) ? 'Cr' : /Dr\s*$/i.test(raw) ? 'Dr' : null;
    return [{ start: match.index ?? 0, end: (match.index ?? 0) + raw.length, value, indicator }];
  });
}

function detectPeriod(lines: readonly string[]): { start: string | null; end: string | null } {
  for (const line of lines) {
    if (!/\b(?:statement\s*)?(?:period|from|to)\b|\bstatement\s+date\b/i.test(line)) continue;
    const dates = parseExplicitDates(line);
    if (dates.length >= 2) return { start: dates[0].iso, end: dates[1].iso };
  }
  const fromLine = lines.find((line) => /^\s*(?:statement\s+)?from\b/i.test(line));
  const toLine = lines.find((line) => /^\s*(?:statement\s+)?to\b/i.test(line));
  return {
    start: fromLine ? parseExplicitDates(fromLine)[0]?.iso ?? null : null,
    end: toLine ? parseExplicitDates(toLine)[0]?.iso ?? null : null,
  };
}

function cleanDescription(value: string): string {
  return stripReferenceMetadata(value.replace(/#\s*/g, ''))
    .replace(/\s*[|;]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:,-]+|[\s:,-]+$/g, '')
    .trim();
}

function stripReferenceMetadata(value: string): string {
  return value
    .replace(/\b(?:ref(?:erence)?|rrn|terminal|term|tid|auth(?:orisation)?)(?:\s*(?:no\.?|id|number))?\s*[:#-]?\s*[\w-]+/gi, '')
    .replace(/\b(?:card|a\/c)\s*(?:ending|no\.?)\s*[*x\d-]+/gi, '')
    .replace(/\*[\w-]{4,}\*?(?:\d{1,2}[A-Za-z]{3}\d{2,4})?/g, '')
    .replace(/[*#]\d{4,}\b/g, '');
}

function merchantName(description: string): string {
  const cleaned = description
    .replace(/^(?:debicheck|edo\s+collection|debit\s+order|debit\s+card\s+pos|card\s+purchase|card\s+swipe|pos\s+purchase|purchase|eft|instant\s+payment|atm\s+cash\s+withdrawal|atm\s+withdrawal|cashback|cash\s+back)\b[\s:*-]*/i, '')
    .replace(/\b(?:on|at)\s+\d{1,2}:\d{2}\b.*$/i, '')
    .trim();
  return cleaned || description || 'Unknown transaction';
}

function classify(description: string, flow: 'debit' | 'credit'): StatementCategory {
  const text = description.toLowerCase();
  if (/salary|stansal|payroll|wages?|remuneration|sal(?:ary)?\s+\d/.test(text)) return 'income';
  if (flow === 'credit') {
    if (/fnb\s+app|app\s+transfer|instant\s+payment|cashsend|p2p|peer[- ]to[- ]peer|received\s+from/.test(text)) return 'income';
    if (/transfer|eft|paynow|instant\s+payment|cashsend|received|refund|reversal|reversed|p2p|from\s+\w/.test(text)) return 'transfer';
    return 'income';
  }
  if (/fee|service charge|bundle charge|unsuccessful|declined|returned item/.test(text)) return 'fees';
  if (/debicheck|edo collection|debit order|loan|credit agreement|finchoice|unifi|npjmcash|repayment|pay just now/.test(text)) return 'debt';
  if (/card cashback|cash\s*back/.test(text)) return 'cash';
  if (/atm|cash withdrawal|cash withdraw/.test(text)) return 'cash';
  if (/uber\s*eats|new uber eats|restaurant|takeaway|fast food|cafe|coffee|dining|bites|spotted cow|palacio|nando|kfc|mcdonald|steers|debonairs/.test(text)) return 'dining';
  if (/kwikspar|spar|tops\b|pick\s*n?\s*pay|pnp\b|checkers|woolworths|shoprite|food lovers|supermarket|grocery/.test(text)) return 'groceries';
  if (/uber(?!\s*eats)|bolt|taxi|sasol|engen|shell|bp\b|caltex|petrol|fuel|parking|toll/.test(text)) return 'transport';
  if (/netflix|spotify|showmax|dstv|ster-kinekor|cinema|entertainment|airtime|data\b|vodacom bundle|mtn bundle/.test(text)) return 'entertainment';
  if (/prepaid|electricity|municipal|water\b|utility/.test(text)) return 'utilities';
  if (/pharmacy|clicks|dis-chem|doctor|medical|health/.test(text)) return 'health';
  if (/transfer|savings|investment|pocket|express\s+pmt|payment\s+to|pmt\s+to/.test(text)) return 'transfer';
  if (/clothing|mr price|takealot|mall|retail|shop/.test(text)) return 'shopping';
  return 'other';
}

function appCategory(category: StatementCategory): Category {
  switch (category) {
    case 'income': return 'income';
    case 'transfer': return 'savings';
    case 'debt':
    case 'fees':
    case 'utilities': return 'bills';
    case 'entertainment': return 'entertainment';
    case 'groceries': return 'food_grocery';
    case 'dining': return 'food_dining';
    case 'transport': return 'transport';
    case 'shopping': return 'shopping';
    case 'health': return 'health';
    case 'cash':
    case 'other': return 'other';
  }
}

function isHeaderOrFooter(line: string): boolean {
  return /^\s*(?:page\s+\d+\b|account\s+(?:number|no\.?)\b|statement\s+(?:period|date)\b|opening\s+balance\b|closing\s+balance\b|date\b.*\bdescription\b|description\s+debit\b|debit\s+credit\s+balance\b|deposits\s+withdrawals\b|fnb\s+aspire\b|first\s+national\s+bank\b)/i.test(line) ||
    /^\s*(?:total\s+(?:debits|credits|fees)|please\s+check|terms\s+and\s+conditions)\b/i.test(line);
}

/** Groups lines into dated rows: a dated line starts a row; undated lines continue it. */
function extractRawTransactions(lines: readonly string[]): RawTransaction[] {
  const folded = lines.reduce<Readonly<{ done: readonly RawTransaction[]; current: RawTransaction | null }>>(
    (acc, line) => {
      if (/^\s*(?:opening|closing)\s+balance\b/i.test(line) || isHeaderOrFooter(line)) return acc;
      const parsedDate = parseDatePrefix(line);
      if (parsedDate) return { done: acc.current ? [...acc.done, acc.current] : acc.done, current: { date: parsedDate.date, text: parsedDate.rest } };
      if (!acc.current || !line.trim()) return acc;
      if (/^\s*(?:total\s+(?:debits|credits)|balance\s+brought\s+forward)\b/i.test(line)) return acc;
      return { ...acc, current: { ...acc.current, text: `${acc.current.text} ${line.trim()}` } };
    },
    { done: [], current: null },
  );
  return folded.current ? [...folded.done, folded.current] : [...folded.done];
}

function resolveDate(rawDate: ParsedDate, previous: string | null, period: { start: string | null; end: string | null }, fallbackYear: number): string {
  if (rawDate.iso) return rawDate.iso;
  const startYear = period.start ? Number(period.start.slice(0, 4)) : null;
  const endYear = period.end ? Number(period.end.slice(0, 4)) : null;
  let year = startYear ?? endYear ?? (previous ? Number(previous.slice(0, 4)) : fallbackYear);
  if (previous) {
    year = Number(previous.slice(0, 4));
    const previousMonth = Number(previous.slice(5, 7));
    if (rawDate.month < previousMonth) {
      const nextYear = year + 1;
      year = endYear !== null && nextYear > endYear ? year : nextYear;
    }
  } else if (startYear && endYear && endYear > startYear) {
    const startMonth = Number(period.start!.slice(5, 7));
    year = rawDate.month < startMonth ? endYear : startYear;
  }
  return toIso(year, rawDate.month, rawDate.day);
}

function parseRawTransaction(raw: RawTransaction, index: number, date: string, previousBalance: number | null): StatementTransaction {
  const normalizedText = stripReferenceMetadata(raw.text);
  const tokens = amountTokens(normalizedText);
  const amountCandidates = tokens.length > 1 ? tokens.slice(0, -1) : tokens;
  const amountToken = [...amountCandidates].reverse().find((token) => token.value !== 0) ?? amountCandidates[amountCandidates.length - 1];
  const balanceToken = tokens.length > 1 ? tokens[tokens.length - 1] : null;
  const descriptionEnd = amountCandidates[0]?.start ?? normalizedText.length;
  const descriptionRaw = normalizedText.slice(0, descriptionEnd).trim();
  const description = cleanDescription(descriptionRaw) || 'Unknown transaction';
  const merchant = merchantName(description);
  const amount = roundMoney(Math.abs(amountToken?.value ?? 0));
  const rawBalance = balanceToken ? balanceFrom(normalizedText.slice(balanceToken.start, balanceToken.end)) : null;
  const movement = resolveMovement(
    amount,
    amountToken?.value !== undefined && amountToken.value < 0 ? 'Cr' : amountToken?.indicator ?? null,
    rawBalance,
    previousBalance,
    descriptionRaw,
  );
  const runningBalance = movement.runningBalance;
  let flow = movement.flow;
  const rawLower = descriptionRaw.toLowerCase();
  if (!amountToken?.indicator && !runningBalance && (/\b(?:salary|stansal|payroll|refund|reversal|reversed|received)\b/i.test(rawLower))) {
    flow = 'credit';
  }
  const category = classify(descriptionRaw || description, flow);
  const incomeSource = flow !== 'credit' || category !== 'income'
    ? null
    : /salary|stansal|payroll|wages?|remuneration/i.test(rawLower) ? 'salary' : 'other';
  const confidence: Confidence = category === 'other' ? 'low' : runningBalance ? 'high' : 'medium';
  const issues: StatementIssue[] = !movement.posted && /(?:debicheck|debit order|edo collection|subscription)/i.test(descriptionRaw) ? ['debit_order_attempt'] : [];
  return {
    id: `tx-${String(index + 1).padStart(5, '0')}`,
    date,
    descriptionRaw,
    description,
    merchant: cleanDescription(merchant),
    amount,
    flow,
    posted: movement.posted,
    incomeSource,
    category,
    runningBalance,
    balanceCheck: 'unavailable',
    confidence,
    issues,
  };
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Groups items by key, preserving first-seen order; returns fresh arrays. */
function groupBy<T>(items: readonly T[], key: (t: T) => string): readonly (readonly T[])[] {
  const grouped = items.reduce<Readonly<Record<string, readonly T[]>>>((acc, item) => {
    const k = key(item);
    return { ...acc, [k]: [...(acc[k] ?? []), item] };
  }, {});
  return Object.values(grouped);
}

function recurringObligations(transactions: readonly StatementTransaction[]): RecurringObligation[] {
  const candidates = transactions.filter((t) => t.flow === 'debit' && ['debt', 'fees', 'utilities', 'entertainment'].includes(t.category));
  return groupBy(candidates, (t) => `${t.category}:${t.merchant.toLowerCase()}`).flatMap((items) => {
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length < 2) return [];
    const distinctMonths = new Set(sorted.map((item) => item.date.slice(0, 7))).size;
    const gaps = sorted.slice(1).map((item, index) => {
      return (Date.parse(`${item.date}T00:00:00Z`) - Date.parse(`${sorted[index].date}T00:00:00Z`)) / 86400000;
    });
    const gap = median(gaps);
    const cadence = gap >= 5 && gap <= 9 ? 'weekly' : distinctMonths >= 2 && gap >= 24 && gap <= 38 ? 'monthly' : 'irregular';
    const category = sorted[0].category === 'debt' || sorted[0].category === 'fees' ||
      sorted[0].category === 'utilities' || sorted[0].category === 'entertainment'
      ? sorted[0].category
      : 'other';
    return [{
      merchant: sorted[0].merchant,
      category,
      averageAmount: roundMoney(sorted.reduce((sum, item) => sum + item.amount, 0) / sorted.length),
      cadence,
      occurrences: sorted.length,
      firstDate: sorted[0].date,
      lastDate: sorted[sorted.length - 1].date,
    }];
  });
}

function recognizedIncome(transaction: StatementTransaction): boolean {
  return transaction.posted && transaction.flow === 'credit' && transaction.category === 'income';
}

function analyze(
  transactions: readonly StatementTransaction[],
  opening: StatementBalance | null,
  closing: StatementBalance | null,
): BankStatementAnalysis {
  const postedTransactions = transactions.filter((transaction) => transaction.posted);
  const totalCredits = roundMoney(postedTransactions.filter((t) => t.flow === 'credit').reduce((sum, t) => sum + t.amount, 0));
  const totalDebits = roundMoney(postedTransactions.filter((t) => t.flow === 'debit').reduce((sum, t) => sum + t.amount, 0));
  const income = roundMoney(postedTransactions.filter(recognizedIncome).reduce((sum, t) => sum + t.amount, 0));
  const debtPayments = roundMoney(postedTransactions.filter((t) => t.flow === 'debit' && t.category === 'debt').reduce((sum, t) => sum + t.amount, 0));
  const bankFees = roundMoney(postedTransactions.filter((t) => t.flow === 'debit' && t.category === 'fees').reduce((sum, t) => sum + t.amount, 0));
  const expenses = postedTransactions.filter((t) => t.flow === 'debit');
  const atmWithdrawals = roundMoney(expenses.filter((t) => /atm|cash withdrawal/i.test(t.descriptionRaw)).reduce((sum, t) => sum + t.amount, 0));
  const cashBack = roundMoney(expenses.filter((t) => /cash\s*back|cashback/i.test(t.descriptionRaw)).reduce((sum, t) => sum + t.amount, 0));
  const digitalCardSpend = roundMoney(expenses.filter((t) => /pos|card purchase|card swipe/i.test(t.descriptionRaw) && t.category !== 'cash').reduce((sum, t) => sum + t.amount, 0));
  const obligations = recurringObligations(postedTransactions);
  const anomaly = (transaction: StatementTransaction, kind: StatementIssue, message: string): StatementAnomaly => ({
    kind,
    transactionId: transaction.id,
    date: transaction.date,
    description: transaction.description,
    amount: transaction.amount,
    message,
  });
  const chargeKey = (t: StatementTransaction) => `${t.date}:${t.merchant.toLowerCase()}:${t.amount.toFixed(2)}`;
  const isPostedDebit = (t: StatementTransaction) => t.posted && t.flow === 'debit';
  const firstChargeIndex = transactions.reduce<Readonly<Record<string, number>>>(
    (acc, t, i) => (isPostedDebit(t) && !(chargeKey(t) in acc) ? { ...acc, [chargeKey(t)]: i } : acc),
    {},
  );
  const perTransaction = transactions.flatMap((transaction, i): StatementAnomaly[] => [
    ...(isPostedDebit(transaction) && firstChargeIndex[chargeKey(transaction)] !== i
      ? [anomaly(transaction, 'duplicate_charge', 'Possible duplicate charge: same merchant and amount on the same day.')]
      : []),
    ...(/fee.*(?:declined|unsuccessful)|(?:declined|unsuccessful).*fee/i.test(transaction.descriptionRaw)
      ? [anomaly(transaction, 'failed_transaction_fee', 'A fee appears related to a declined or unsuccessful transaction.')]
      : []),
    ...(transaction.issues.includes('debit_order_attempt') || FAILED_DEBIT_ORDER.test(transaction.descriptionRaw)
      ? [anomaly(transaction, 'debit_order_attempt', 'A recurring payment attempt appears to have failed or been returned.')]
      : []),
    ...(transaction.balanceCheck === 'mismatch' ? [anomaly(transaction, 'balance_mismatch', 'The running balance does not reconcile with the preceding balance and transaction.')] : []),
    ...(transaction.issues.includes('out_of_order') ? [anomaly(transaction, 'out_of_order', 'Transaction date is earlier than the preceding statement entry.')] : []),
  ]);
  const peersByCategory = Object.fromEntries(groupBy(expenses, (t) => t.category).map((group) => [group[0].category, group.map((t) => t.amount)]));
  const spikes = expenses.flatMap((transaction): StatementAnomaly[] => {
    const peers = peersByCategory[transaction.category] ?? [];
    if (peers.length < 5) return [];
    const baseline = median(peers);
    return baseline > 0 && transaction.amount >= Math.max(3 * baseline, baseline + 250)
      ? [anomaly(transaction, 'unusual_spike', `This ${transaction.category} payment is unusually large compared with similar statement transactions.`)]
      : [];
  });
  const anomalies = [...perTransaction, ...spikes];
  const balanceReconciliation = opening?.signedAmount !== undefined && closing?.signedAmount !== undefined
    ? Math.abs(roundMoney(opening.signedAmount + totalCredits - totalDebits - closing.signedAmount)) <= 0.02
      ? 'matched'
      : 'mismatch'
    : 'unavailable';
  const salaryTransactions = postedTransactions.filter((transaction) => transaction.incomeSource === 'salary');
  const payCycles = salaryTransactions.map((salary, index) => {
    const nextSalary = salaryTransactions[index + 1];
    const start = salary.date;
    const end = nextSalary
      ? addDays(nextSalary.date, -1)
      : postedTransactions.reduce((latest, item) => item.date > latest ? item.date : latest, salary.date);
    const cycle = postedTransactions.filter((item) => item.date >= start && item.date <= end);
    const cycleIncome = roundMoney(cycle.filter(recognizedIncome).reduce((sum, item) => sum + item.amount, 0));
    const outflow = roundMoney(cycle.filter((item) => item.flow === 'debit').reduce((sum, item) => sum + item.amount, 0));
    const days = Math.max(1, (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1);
    const postPaydayOutflow = roundMoney(cycle
      .filter((item) => item.flow === 'debit' && Date.parse(`${item.date}T00:00:00Z`) < Date.parse(`${addDays(start, 7)}T00:00:00Z`))
      .reduce((sum, item) => sum + item.amount, 0));
    const prePaydayOutflow = roundMoney(cycle
      .filter((item) => item.flow === 'debit' && Date.parse(`${item.date}T00:00:00Z`) >= Date.parse(`${addDays(end, -6)}T00:00:00Z`))
      .reduce((sum, item) => sum + item.amount, 0));
    const endingBalance = [...cycle].reverse().find((item) => item.runningBalance)?.runningBalance?.signedAmount ?? null;
    return {
      start,
      end,
      days,
      income: cycleIncome,
      outflow,
      outflowPerDay: roundMoney(outflow / days),
      postPaydayOutflow,
      prePaydayOutflow,
      netCashFlow: roundMoney(cycleIncome - outflow),
      endingBalance,
    };
  }).reverse();
  const insights = [
    income > 0 && debtPayments > 0 && `Debt payments consumed ${((debtPayments / income) * 100).toFixed(1)}% of recognized income.`,
    income > 0 && bankFees > 0 && `Bank fees consumed ${((bankFees / income) * 100).toFixed(1)}% of recognized income.`,
    payCycles.some((cycle) => cycle.income > 0 && cycle.postPaydayOutflow >= cycle.income * 0.4) &&
      'A large share of income is spent in the first week after payday; review early-cycle spending.',
    payCycles.some((cycle) => cycle.income > 0 && cycle.prePaydayOutflow >= cycle.income * 0.4) &&
      'Outflows cluster near the end of a pay cycle; check the balance available before payday.',
    atmWithdrawals + cashBack > 0 && `Cash usage totalled R${(atmWithdrawals + cashBack).toFixed(2)}: R${atmWithdrawals.toFixed(2)} at ATMs and R${cashBack.toFixed(2)} in cash back.`,
    obligations.some((item) => item.cadence === 'irregular') && 'Review repeated debit orders and subscriptions with irregular timing.',
    anomalies.length > 0 && `${anomalies.length} transaction pattern${anomalies.length === 1 ? '' : 's'} need review.`,
    balanceReconciliation === 'mismatch' && 'Statement opening, transaction, and closing balances do not reconcile; review extracted rows.',
  ].filter((line): line is string => typeof line === 'string');
  return {
    totalCredits,
    totalDebits,
    netCashFlow: roundMoney(totalCredits - totalDebits),
    recognizedIncome: income,
    debtPayments,
    bankFees,
    debtBurdenPercent: income > 0 ? roundMoney((debtPayments / income) * 100) : null,
    feeBurdenPercent: income > 0 ? roundMoney((bankFees / income) * 100) : null,
    cash: { atmWithdrawals, cashBack, digitalCardSpend },
    recurringObligations: obligations,
    payCycles,
    anomalies,
    insights,
    balanceReconciliation,
  };
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Statement assembly (pure folds)

type Header = Readonly<{
  period: Readonly<{ start: string | null; end: string | null }>;
  accountNumber: string | null;
  openingBalance: StatementBalance | null;
  closingBalance: StatementBalance | null;
  bank: BankStatementDocument['bank'];
  accountType: BankStatementDocument['accountType'];
}>;

/** Running state while folding rows: transactions so far, last date, last known balance. */
type StatementFold = Readonly<{ transactions: readonly StatementTransaction[]; previousDate: string | null; previousBalance: number | null }>;

const NO_DATED: StatementParseError = { kind: 'no_dated_transactions', message: 'No dated transactions were found in this bank statement PDF.' };
const NO_MONETARY: StatementParseError = { kind: 'no_monetary_transactions', message: 'No monetary transactions were found in this bank statement PDF.' };

const splitLines = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\f/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean);

function readHeader(text: string, lines: readonly string[]): Header {
  const accountLine = lines.find((line) => /\baccount\s*(?:number|no\.?|#)/i.test(line));
  const openingLine = lines.find((line) => /^\s*opening\s+balance\b/i.test(line));
  const closingLine = [...lines].reverse().find((line) => /^\s*closing\s+balance\b/i.test(line));
  return {
    period: detectPeriod(lines),
    accountNumber: accountLine?.match(/\baccount\s*(?:number|no\.?|#)\s*[:#-]?\s*([0-9][0-9 -]{4,})/i)?.[1]?.replace(/\D/g, '') ?? null,
    openingBalance: openingLine ? balanceFrom(openingLine.replace(/^.*?\bopening\s+balance\b/i, '')) : null,
    closingBalance: closingLine ? balanceFrom(closingLine.replace(/^.*?\bclosing\s+balance\b/i, '')) : null,
    bank: /\bFNB\b|FIRST\s+NATIONAL\s+BANK/i.test(text) ? 'FNB' : 'unknown',
    accountType: /aspire\s+current/i.test(text) ? 'Aspire Current Account' : null,
  };
}

const startFold = (opening: StatementBalance | null): StatementFold => ({ transactions: [], previousDate: null, previousBalance: opening?.signedAmount ?? null });

const appendTransaction = (acc: StatementFold, transaction: StatementTransaction): StatementFold => ({
  transactions: [...acc.transactions, transaction],
  previousDate: transaction.date,
  previousBalance: transaction.runningBalance ? transaction.runningBalance.signedAmount : acc.previousBalance,
});

/** Reconciles a row against the previous running balance (an unposted attempt shouldn't move it). */
function balanceCheckFor(t: Pick<StatementTransaction, 'posted' | 'flow' | 'amount' | 'runningBalance'>, previousBalance: number | null): StatementTransaction['balanceCheck'] {
  if (!t.runningBalance || previousBalance === null) return 'unavailable';
  const expected = t.posted ? roundMoney(previousBalance + (t.flow === 'credit' ? t.amount : -t.amount)) : previousBalance;
  return Math.abs(expected - t.runningBalance.signedAmount) <= 0.02 ? 'matched' : 'mismatch';
}

/** Adds ordering and reconciliation checks that depend on the preceding row. */
function withSequenceChecks(t: StatementTransaction, acc: StatementFold): StatementTransaction {
  const balanceCheck = balanceCheckFor(t, acc.previousBalance);
  const issues: StatementIssue[] = [
    ...t.issues,
    ...(acc.previousDate && t.date < acc.previousDate ? (['out_of_order'] as const) : []),
    ...(balanceCheck === 'mismatch' ? (['balance_mismatch'] as const) : []),
  ];
  return { ...t, balanceCheck, issues };
}

const buildDocument = (header: Header, pages: number, transactions: readonly StatementTransaction[]): BankStatementDocument => ({
  bank: header.bank,
  accountType: header.accountType,
  accountNumber: header.accountNumber,
  currency: 'ZAR',
  period: {
    start: header.period.start ?? transactions[0]?.date ?? null,
    end: header.period.end ?? transactions[transactions.length - 1]?.date ?? null,
  },
  openingBalance: header.openingBalance,
  closingBalance: header.closingBalance,
  pages,
  transactions,
  analysis: analyze(transactions, header.openingBalance, header.closingBalance),
});

/** Parses statement text. Pure: the caller supplies the fallback year; failures are values. */
export function parseStatementText(text: string, options: StatementParseOptions): Result<BankStatementDocument, StatementParseError> {
  const lines = splitLines(text);
  const header = readHeader(text, lines);
  const rawTransactions = extractRawTransactions(lines);
  if (!rawTransactions.length) return err(NO_DATED);
  const folded = rawTransactions
    .filter((raw) => amountTokens(stripReferenceMetadata(raw.text)).length > 0)
    .reduce<StatementFold>((acc, raw) => {
      const date = resolveDate(raw.date, acc.previousDate, header.period, options.fallbackYear);
      const parsed = parseRawTransaction(raw, acc.transactions.length, date, acc.previousBalance);
      return appendTransaction(acc, withSequenceChecks(parsed, acc));
    }, startFold(header.openingBalance));
  if (!folded.transactions.length) return err(NO_MONETARY);
  return ok(buildDocument(header, options.pages ?? 1, folded.transactions));
}

// ---------------------------------------------------------------------------
// Positioned PDF items (column layout)

type Positioned = Readonly<{ page: number; x: number; y: number; text: string }>;
type Row = Readonly<{ page: number; y: number; items: readonly Positioned[] }>;
type Columns = Readonly<{ date: string; description: string; amount: string; balance: string }>;

const toPositioned = (items: readonly BankStatementTextItem[]): readonly Positioned[] =>
  items
    .filter((item) => item.str.trim())
    .map((item) => ({ page: item.page ?? 1, x: item.transform?.[4] ?? 0, y: item.transform?.[5] ?? 0, text: item.str.replace(/\s+/g, ' ').trim() }))
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);

/** Items within 2pt vertically on the same page form one row. */
const groupRows = (positioned: readonly Positioned[]): readonly Row[] =>
  positioned.reduce<readonly Row[]>((rows, item) => {
    const last = rows[rows.length - 1];
    if (!last || last.page !== item.page || Math.abs(last.y - item.y) > 2) return [...rows, { page: item.page, y: item.y, items: [item] }];
    return [...rows.slice(0, -1), { ...last, items: [...last.items, item] }];
  }, []);

/** FNB column bands: date ≤ 30, description 30–440, amount 440–500, balance 500–560. */
function readColumns(row: Row): Readonly<{ line: string; columns: Columns | null }> {
  const ordered = [...row.items].sort((a, b) => a.x - b.x);
  const dateColumn = ordered.find((item) => item.x <= 30 && parseDatePrefix(item.text));
  if (!dateColumn) return { line: ordered.map((item) => item.text).join(' '), columns: null };
  const band = (lo: number, hi: number) => ordered.filter((item) => item.x >= lo && item.x < hi).map((item) => item.text).join(' ');
  const description = ordered.filter((item) => item.x > 30 && item.x < 440).map((item) => item.text).join(' ');
  const amount = band(440, 500);
  const balance = band(500, 560);
  return {
    line: [dateColumn.text, description, amount, balance].filter(Boolean).join(' '),
    columns: amount || balance ? { date: dateColumn.text, description, amount, balance } : null,
  };
}

function positionedTransaction(row: Columns, acc: StatementFold, period: Header['period'], fallbackYear: number): StatementTransaction | null {
  const datePrefix = parseDatePrefix(row.date);
  const amount = balanceFrom(row.amount);
  if (!datePrefix || !amount) return null;
  const date = resolveDate(datePrefix.date, acc.previousDate, period, fallbackYear);
  const descriptionRaw = stripReferenceMetadata(`${datePrefix.rest} ${row.description}`.trim());
  const description = cleanDescription(descriptionRaw) || 'Unknown transaction';
  const { flow, runningBalance, posted } = resolveMovement(amount.amount, amount.indicator, balanceFrom(row.balance), acc.previousBalance, descriptionRaw);
  const category = classify(descriptionRaw || description, flow);
  const base: StatementTransaction = {
    id: `tx-${String(acc.transactions.length + 1).padStart(5, '0')}`,
    date,
    descriptionRaw,
    description,
    merchant: cleanDescription(merchantName(description)),
    amount: amount.amount,
    flow,
    posted,
    incomeSource: flow !== 'credit' || category !== 'income' ? null : /salary|stansal|payroll|wages?|remuneration/i.test(descriptionRaw) ? 'salary' : 'other',
    category,
    runningBalance,
    balanceCheck: 'unavailable',
    confidence: category === 'other' ? 'low' : runningBalance ? 'high' : 'medium',
    issues: FAILED_DEBIT_ORDER.test(descriptionRaw) ? ['debit_order_attempt'] : [],
  };
  return withSequenceChecks(base, acc);
}

/** Parses positioned PDF text items using the column layout, falling back to text for metadata. */
export function parseStatementItems(items: readonly BankStatementTextItem[], options: StatementParseOptions): Result<BankStatementDocument, StatementParseError> {
  const rows = groupRows(toPositioned(items)).map(readColumns);
  const fromText = parseStatementText(rows.map((r) => r.line).join('\n'), options);
  if (!fromText.ok) return fromText;
  const document = fromText.value;
  const folded = rows
    .flatMap((r) => (r.columns ? [r.columns] : []))
    .reduce<StatementFold>((acc, row) => {
      const transaction = positionedTransaction(row, acc, document.period, options.fallbackYear);
      return transaction ? appendTransaction(acc, transaction) : acc;
    }, startFold(document.openingBalance));
  if (!folded.transactions.length) return err(NO_MONETARY);
  return ok({ ...document, transactions: folded.transactions, analysis: analyze(folded.transactions, document.openingBalance, document.closingBalance) });
}

// ---------------------------------------------------------------------------
// Boundary adapters: supply the current year and throw, for exception-style callers

const orThrow = <T>(r: Result<T, StatementParseError>): T => {
  if (r.ok) return r.value;
  throw new Error(r.error.message);
};

export function parseBankStatementText(text: string, pages = 1): BankStatementDocument {
  return orThrow(parseStatementText(text, { pages, fallbackYear: new Date().getUTCFullYear() }));
}

export function parseBankStatementItems(items: readonly BankStatementTextItem[], pages = 1): BankStatementDocument {
  return orThrow(parseStatementItems(items, { pages, fallbackYear: new Date().getUTCFullYear() }));
}


export function toAppTransactions(document: BankStatementDocument, sourceDocId: string): Transaction[] {
  return document.transactions.filter((transaction) => transaction.posted).map((transaction) => ({
    id: `${sourceDocId}-${transaction.id}`,
    date: transaction.date,
    merchant: transaction.merchant,
    amount: transaction.amount,
    kind: transaction.flow === 'credit'
      ? transaction.category === 'income' ? 'income' : 'transfer'
      : transaction.category === 'transfer' ? 'transfer' : 'expense',
    category: appCategory(transaction.category),
    confidence: transaction.confidence,
    sourceDocId,
  }));
}

export function recurringBillsFromStatement(document: BankStatementDocument) {
  return document.analysis.recurringObligations
    .filter((item) => item.cadence !== 'irregular' && (item.category === 'debt' || item.category === 'utilities' || item.category === 'entertainment'))
    .map((item) => {
      const matching = document.transactions.filter((transaction) =>
        transaction.posted && transaction.flow === 'debit' && transaction.merchant.toLowerCase() === item.merchant.toLowerCase(),
      );
      const dates = matching.map((transaction) => new Date(`${transaction.date}T00:00:00Z`).getUTCDate()).sort((a, b) => a - b);
      return {
        id: `statement-bill-${item.merchant.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name: item.merchant,
        amount: item.cadence === 'weekly' ? roundMoney(item.averageAmount * 52 / 12) : item.averageAmount,
        day: dates[Math.floor(dates.length / 2)] ?? 1,
        cadence: item.cadence === 'weekly' ? 'weekly' as const : 'monthly' as const,
        confidence: item.cadence === 'irregular' ? 'medium' as const : 'high' as const,
        active: true,
        isSubscription: item.category === 'entertainment' || matching.some((transaction) => /subscription|netflix|spotify|showmax|dstv|ster-kinekor/i.test(transaction.description)),
        monthsPaid: new Set(matching.map((transaction) => transaction.date.slice(0, 7))).size,
      };
    });
}
