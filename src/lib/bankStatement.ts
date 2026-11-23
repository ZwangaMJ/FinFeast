import type { Category, Confidence, RecurringCategory, RecurringExpense, RecurringFrequency, Transaction } from '@/store/types';

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

export type RecurringChannel = 'debit_order' | 'eft' | 'card';

export type RecurringObligation = Readonly<{
  key: string;
  merchant: string;
  category: RecurringCategory;
  channel: RecurringChannel;
  averageAmount: number; // median amount per debit
  cadence: RecurringFrequency | 'irregular';
  occurrences: number;
  months: number;
  billingDay: number;
  firstDate: string;
  lastDate: string;
  confidence: Confidence;
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

function parseExplicitDates(text: string): ParsedDate[] {
  const dates: ParsedDate[] = [];
  for (const match of text.matchAll(EXPLICIT_DATE)) {
    let year: number;
    let month: number;
    let day: number;
    if (match[1]) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
    } else if (match[4]) {
      day = Number(match[4]);
      month = Number(match[5]);
      year = Number(match[6].length === 2 ? `20${match[6]}` : match[6]);
    } else {
      day = Number(match[7]);
      month = MONTHS[match[8].toLowerCase()];
      year = Number(match[9]);
    }
    if (validParts(year, month, day)) dates.push({ year, month, day, iso: toIso(year, month, day) });
  }
  return dates;
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
  const isAttempt = /(?:debicheck|debit order|edo collection|subscription).*(?:attempt|declined|failed|returned|unpaid|unsuccessful)|(?:attempt|declined|failed|returned|unpaid|unsuccessful).*(?:debicheck|debit order|edo collection|subscription)/i.test(description);

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
  const tokens: AmountToken[] = [];
  for (const match of text.matchAll(AMOUNT_PATTERN)) {
    const raw = match[0];
    const value = parseStatementAmount(raw);
    if (value === null) continue;
    const indicator = /Cr\s*$/i.test(raw) ? 'Cr' : /Dr\s*$/i.test(raw) ? 'Dr' : null;
    tokens.push({ start: match.index ?? 0, end: (match.index ?? 0) + raw.length, value, indicator });
  }
  return tokens;
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

function extractRawTransactions(lines: readonly string[]): RawTransaction[] {
  const raw: RawTransaction[] = [];
  let current: RawTransaction | null = null;
  const finish = () => {
    if (current) raw.push(current);
    current = null;
  };
  for (const line of lines) {
    if (/^\s*(?:opening|closing)\s+balance\b/i.test(line) || isHeaderOrFooter(line)) continue;
    const parsedDate = parseDatePrefix(line);
    if (parsedDate) {
      finish();
      current = { date: parsedDate.date, text: parsedDate.rest };
      continue;
    }
    if (!current || !line.trim()) continue;
    if (/^\s*(?:total\s+(?:debits|credits)|balance\s+brought\s+forward)\b/i.test(line)) continue;
    current.text += ` ${line.trim()}`;
  }
  finish();
  return raw;
}

function resolveDate(rawDate: ParsedDate, previous: string | null, period: { start: string | null; end: string | null }): string {
  if (rawDate.iso) return rawDate.iso;
  const startYear = period.start ? Number(period.start.slice(0, 4)) : null;
  const endYear = period.end ? Number(period.end.slice(0, 4)) : null;
  let year = startYear ?? endYear ?? (previous ? Number(previous.slice(0, 4)) : new Date().getUTCFullYear());
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
  const issues: StatementIssue[] = [];
  if (!movement.posted && /(?:debicheck|debit order|edo collection|subscription)/i.test(descriptionRaw)) {
    issues.push('debit_order_attempt');
  }
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

const DEBIT_ORDER = /debicheck|debit\s*order|edo\s+collection|\bnaedo\b|\bacb\s+debit|magtape|\bdebit\s+(?:instruction|mandate)|insurance\s+prem|\bpremium\b/i;
const EFT = /\beft\b|internet\s+(?:pmt|payment|trf|transfer)|payment\s+to|pmt\s+to|send\s+money|express\s+pmt|immediate\s+(?:pmt|payment)|digital\s+payment|payshap|fnb\s+app\s+payment|scheduled\s+payment|stop\s+order|int-banking/i;
const OWN_MONEY = /saving|investment|pocket|own\s+account|to\s+self|\bsave\b|tax\s+free|unit\s+trust/i;
const HOUSING = /\brent(?:al)?\b|\blev(?:y|ies)\b|body\s*corp|home\s*loan|\bbond\b|mortgage|sectional\s+title|\bhoa\b|property\s+(?:management|rentals?)|rawson|pam\s+golding|seeff|tenant|landlord|accommodation|res(?:idence)?\s+fees/i;
const INSURANCE = /insur|assur|\blife\b|funeral|outsurance|miway|king\s*price|hollard|discovery|momentum|old\s*mutual|sanlam|liberty|clientele|assupol|avbob|metropolitan|1life|dial\s+direct|first\s+for\s+women|auto\s*(?:&|and)\s*general|santam|medical\s+aid|medshield|bonitas|fedhealth|\bgems\b|bestmed|keyhealth|bankmed|polmed/i;
const TRANSPORT = /vehicle|\bvaf\b|wesbank|\bmfc\b|car\s+(?:finance|instal)|auto\s+finance|(?:toyota|vw|bmw|ford|nissan|hyundai)\s+fin|gautrain|metrorail|prasa|myciti|rea\s+vaya|areyeng|a\s+re\s+yeng|go\s*george|\btaxi\b|e-?toll|sanral|tracker|cartrack|netstar|ctrack|lift\s*club|\bbus\s+(?:pass|card|ticket)/i;
const UTILITIES = /electric|eskom|municipal|city\s+of|\bcoj\b|tshwane|ekurhuleni|ethekwini|msunduzi|mangaung|nelson\s+mandela\s+bay|\brates\b|\bwater\b|refuse|sewer|telkom|vumatel|openserve|frogfoot|octotel|metrofibre|fibre|afrihost|webafrica|cool\s*ideas|axxess|\brain\b|vodacom|\bmtn\b|cell\s*c|internet|uncapped|prepaid/i;
const SUBSCRIPTIONS = /netflix|spotify|showmax|dstv|multichoice|apple\.com|apple\s+(?:music|tv|one)|itunes|icloud|google\s+(?:one|storage|play)|youtube|amazon\s+prime|prime\s+video|disney|deezer|audible|microsoft|xbox|playstation|\bpsn\b|adobe|canva|chatgpt|openai|virgin\s+active|planet\s+fitness|\bgym\b|zoom\.us|dropbox|patreon|subscription|uber\s+one|news24|linkedin/i;
const DEBT = /loan|finchoice|unifi|credit\s+card|card\s+repay|repayment|pay\s*just\s*now|\bnpj|mobicred|\brcs\b|edgars|truworths|foschini|\btfg\b|jet\s+(?:card|account)|(?:woolworths|mr\s*price)\s+(?:card|account|fin)|\blewis\b|ok\s+furniture|wonga|capfin|african\s+bank|direct\s*axis|nsfas|credit\s+agreement|instal(?:l)?ment|store\s+card|account\s+payment/i;

/** South African payee keywords → recurring-expense category. */
export function recurringCategoryFor(description: string, category: StatementCategory = 'other'): RecurringCategory {
  if (HOUSING.test(description)) return 'housing';
  if (INSURANCE.test(description)) return 'insurance';
  if (TRANSPORT.test(description)) return 'transport';
  if (SUBSCRIPTIONS.test(description)) return 'subscriptions';
  if (UTILITIES.test(description)) return 'utilities';
  if (DEBT.test(description)) return 'debt';
  switch (category) {
    case 'debt': return 'debt';
    case 'utilities': return 'utilities';
    case 'transport': return 'transport';
    case 'entertainment': return 'subscriptions';
    default: return 'other';
  }
}

function recurringChannel(transaction: StatementTransaction): RecurringChannel | null {
  const text = transaction.descriptionRaw || transaction.description;
  if (transaction.flow !== 'debit' || !transaction.posted) return null;
  if (transaction.category === 'income' || transaction.category === 'cash' || transaction.category === 'fees') return null;
  if (DEBIT_ORDER.test(text)) return 'debit_order';
  if (EFT.test(text) || transaction.category === 'transfer') return OWN_MONEY.test(text) ? null : 'eft';
  return 'card';
}

/** Payee name without payment-rail prefixes, references and trailing numbers. */
function payeeName(transaction: StatementTransaction): string {
  const name = transaction.merchant
    .replace(/^(?:fnb\s+app\s+payment\s+to|internet\s+(?:pmt|payment|trf|transfer)\s+to|rtc\s+express\s+pmt\s+to|express\s+pmt\s+to|immediate\s+(?:pmt|payment)\s+to|digital\s+payment\s+to|payment\s+to|pmt\s+to|eft\s+to|send\s+money\s+to|scheduled\s+payment\s+to|stop\s+order\s+to|int-banking\s+pmt\s+(?:to|frm)|acb\s+debit|magtape\s+debit|naedo|debit\s+order|order|eft|payshap|send\s+money)\b[\s:*-]*/i, '')
    .replace(/\b(?:ins(?:urance)?\s+prem(?:ium)?|premium|monthly|debit)\b/gi, ' ')
    .replace(/[\s-]*\b\d[\d\s/-]*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return name || transaction.merchant;
}

function payeeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function daysApart(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000;
}

function cadenceOf(sorted: readonly StatementTransaction[]): RecurringObligation['cadence'] {
  if (sorted.length < 2) return 'monthly';
  const gap = median(sorted.slice(1).map((item, index) => daysApart(sorted[index].date, item.date)));
  const months = new Set(sorted.map((item) => item.date.slice(0, 7))).size;
  if (gap >= 5 && gap <= 9) return 'weekly';
  if (gap >= 12 && gap <= 17) return 'biweekly';
  if (months >= 2 && gap >= 24 && gap <= 38) return 'monthly';
  return 'irregular';
}

/** Splits a payee's debits into amount clusters when it charges more than once a month (e.g. two policies). */
function amountClusters(items: readonly StatementTransaction[]): StatementTransaction[][] {
  const months = new Set(items.map((item) => item.date.slice(0, 7))).size;
  if (items.length <= months) return [[...items]];
  const clusters: StatementTransaction[][] = [];
  for (const item of [...items].sort((a, b) => a.amount - b.amount)) {
    const cluster = clusters.find((group) => Math.abs(group[0].amount - item.amount) <= Math.max(1, group[0].amount * 0.05));
    if (cluster) cluster.push(item);
    else clusters.push([item]);
  }
  return clusters;
}

/**
 * Debit orders, EFTs and repeated card charges that look like recurring
 * expenses. Debit orders count even when seen once (they are recurring by
 * nature); EFTs need a regular cadence and steady amount, or a housing payee;
 * card charges need a known subscription payee or identical regular amounts.
 */
function recurringObligations(transactions: readonly StatementTransaction[]): RecurringObligation[] {
  const groups = new Map<string, { channel: RecurringChannel; name: string; items: StatementTransaction[] }>();
  for (const transaction of transactions) {
    const channel = recurringChannel(transaction);
    if (!channel) continue;
    const name = payeeName(transaction);
    const key = payeeKey(name);
    if (!key) continue;
    const group = groups.get(key);
    if (group) {
      group.items.push(transaction);
      if (channel === 'debit_order') group.channel = channel;
    } else {
      groups.set(key, { channel, name, items: [transaction] });
    }
  }

  return [...groups.entries()].flatMap(([key, group]) => {
    const clusters = amountClusters(group.items);
    return clusters.flatMap((cluster) => {
      const sorted = [...cluster].sort((a, b) => a.date.localeCompare(b.date));
      const description = sorted.map((item) => item.descriptionRaw || item.description).join(' ');
      const category = recurringCategoryFor(description, sorted[0].category);
      const cadence = cadenceOf(sorted);
      const amounts = sorted.map((item) => item.amount);
      const typical = median(amounts);
      const variation = typical > 0 ? (Math.max(...amounts) - Math.min(...amounts)) / typical : 1;
      const knownSubscription = SUBSCRIPTIONS.test(description);
      const single = sorted.length === 1;
      const regular = cadence !== 'irregular';

      let accept: boolean;
      if (group.channel === 'debit_order') accept = single || regular;
      else if (group.channel === 'eft') accept = single ? category === 'housing' : regular && variation <= 0.25;
      else if (sorted[0].category === 'groceries' || sorted[0].category === 'dining') accept = knownSubscription && regular;
      else accept = knownSubscription ? single || regular : !single && regular && variation <= 0.02;
      if (!accept) return [];

      const step = cadence === 'weekly' ? 7 : cadence === 'biweekly' ? 14 : 0;
      const days = sorted.map((item) => Number(item.date.slice(8, 10)));
      const billingDay = step ? ((days[0] - 1) % step) + 1 : [...days].sort((a, b) => a - b)[Math.floor(days.length / 2)];
      return [{
        key: clusters.length > 1 ? `${key} ${Math.round(typical)}` : key,
        merchant: group.name,
        category,
        channel: group.channel,
        averageAmount: roundMoney(typical),
        cadence,
        occurrences: sorted.length,
        months: new Set(sorted.map((item) => item.date.slice(0, 7))).size,
        billingDay,
        firstDate: sorted[0].date,
        lastDate: sorted[sorted.length - 1].date,
        confidence: !single && regular && variation <= 0.1 ? ('high' as const) : ('medium' as const),
      }];
    });
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
  const anomalies: StatementAnomaly[] = [];
  const addAnomaly = (transaction: StatementTransaction, kind: StatementIssue, message: string) => {
    anomalies.push({ kind, transactionId: transaction.id, date: transaction.date, description: transaction.description, amount: transaction.amount, message });
  };
  const seen = new Set<string>();
  for (const transaction of transactions) {
    if (transaction.posted && transaction.flow === 'debit') {
      const key = `${transaction.date}:${transaction.merchant.toLowerCase()}:${transaction.amount.toFixed(2)}`;
      if (seen.has(key)) addAnomaly(transaction, 'duplicate_charge', 'Possible duplicate charge: same merchant and amount on the same day.');
      seen.add(key);
    }
    if (/fee.*(?:declined|unsuccessful)|(?:declined|unsuccessful).*fee/i.test(transaction.descriptionRaw)) {
      addAnomaly(transaction, 'failed_transaction_fee', 'A fee appears related to a declined or unsuccessful transaction.');
    }
    if (transaction.issues.includes('debit_order_attempt') ||
      /(?:debicheck|debit order|edo collection|subscription).*(?:attempt|declined|failed|returned|unpaid|unsuccessful)|(?:attempt|declined|failed|returned|unpaid|unsuccessful).*(?:debicheck|debit order|edo collection|subscription)/i.test(transaction.descriptionRaw)) {
      addAnomaly(transaction, 'debit_order_attempt', 'A recurring payment attempt appears to have failed or been returned.');
    }
    if (transaction.balanceCheck === 'mismatch') addAnomaly(transaction, 'balance_mismatch', 'The running balance does not reconcile with the preceding balance and transaction.');
    if (transaction.issues.includes('out_of_order')) addAnomaly(transaction, 'out_of_order', 'Transaction date is earlier than the preceding statement entry.');
  }
  const amountsByCategory = new Map<string, number[]>();
  for (const transaction of expenses) {
    const amounts = amountsByCategory.get(transaction.category) ?? [];
    amounts.push(transaction.amount);
    amountsByCategory.set(transaction.category, amounts);
  }
  const baselineByCategory = new Map([...amountsByCategory].map(([category, amounts]) => [category, median(amounts)]));
  for (const transaction of expenses) {
    const peers = amountsByCategory.get(transaction.category) ?? [];
    if (peers.length < 5) continue;
    const baseline = baselineByCategory.get(transaction.category) ?? 0;
    if (baseline > 0 && transaction.amount >= Math.max(3 * baseline, baseline + 250)) {
      addAnomaly(transaction, 'unusual_spike', `This ${transaction.category} payment is unusually large compared with similar statement transactions.`);
    }
  }
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
  const insights: string[] = [];
  if (income > 0 && debtPayments > 0) insights.push(`Debt payments consumed ${((debtPayments / income) * 100).toFixed(1)}% of recognized income.`);
  if (income > 0 && bankFees > 0) insights.push(`Bank fees consumed ${((bankFees / income) * 100).toFixed(1)}% of recognized income.`);
  if (payCycles.some((cycle) => cycle.income > 0 && cycle.postPaydayOutflow >= cycle.income * 0.4)) {
    insights.push('A large share of income is spent in the first week after payday; review early-cycle spending.');
  }
  if (payCycles.some((cycle) => cycle.income > 0 && cycle.prePaydayOutflow >= cycle.income * 0.4)) {
    insights.push('Outflows cluster near the end of a pay cycle; check the balance available before payday.');
  }
  if (atmWithdrawals + cashBack > 0) insights.push(`Cash usage totalled R${(atmWithdrawals + cashBack).toFixed(2)}: R${atmWithdrawals.toFixed(2)} at ATMs and R${cashBack.toFixed(2)} in cash back.`);
  if (obligations.some((item) => item.confidence !== 'high')) insights.push('Some debit orders and repeat payments were seen only once or vary in amount; confirm them before saving.');
  if (anomalies.length) insights.push(`${anomalies.length} transaction pattern${anomalies.length === 1 ? '' : 's'} need review.`);
  if (balanceReconciliation === 'mismatch') insights.push('Statement opening, transaction, and closing balances do not reconcile; review extracted rows.');
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

export function parseBankStatementText(text: string, pages = 1): BankStatementDocument {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\f/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean);
  const period = detectPeriod(lines);
  const accountLine = lines.find((line) => /\baccount\s*(?:number|no\.?|#)/i.test(line));
  const accountNumber = accountLine?.match(/\baccount\s*(?:number|no\.?|#)\s*[:#-]?\s*([0-9][0-9 -]{4,})/i)?.[1]?.replace(/\D/g, '') ?? null;
  const openingLine = lines.find((line) => /^\s*opening\s+balance\b/i.test(line));
  const closingLine = [...lines].reverse().find((line) => /^\s*closing\s+balance\b/i.test(line));
  const openingBalance = openingLine ? balanceFrom(openingLine.replace(/^.*?\bopening\s+balance\b/i, '')) : null;
  const closingBalance = closingLine ? balanceFrom(closingLine.replace(/^.*?\bclosing\s+balance\b/i, '')) : null;
  const rawTransactions = extractRawTransactions(lines);
  if (!rawTransactions.length) throw new Error('No dated transactions were found in this bank statement PDF.');

  const transactions: StatementTransaction[] = [];
  let previousDate: string | null = null;
  let previousBalance = openingBalance?.signedAmount ?? null;
  for (const raw of rawTransactions) {
    if (!amountTokens(stripReferenceMetadata(raw.text)).length) continue;
    const index = transactions.length;
    const date = resolveDate(raw.date, previousDate, period);
    const parsed = parseRawTransaction(raw, index, date, previousBalance);
    let balanceCheck: StatementTransaction['balanceCheck'] = 'unavailable';
    const issues = [...parsed.issues];
    if (previousDate && date < previousDate) issues.push('out_of_order');
    if (parsed.runningBalance && previousBalance !== null) {
      const expected = parsed.posted
        ? roundMoney(previousBalance + (parsed.flow === 'credit' ? parsed.amount : -parsed.amount))
        : previousBalance;
      balanceCheck = Math.abs(expected - parsed.runningBalance.signedAmount) <= 0.02 ? 'matched' : 'mismatch';
      if (balanceCheck === 'mismatch') issues.push('balance_mismatch');
    }
    const transaction = { ...parsed, balanceCheck, issues };
    transactions.push(transaction);
    previousDate = date;
    if (transaction.runningBalance) previousBalance = transaction.runningBalance.signedAmount;
  }
  if (!transactions.length) throw new Error('No monetary transactions were found in this bank statement PDF.');

  let bank: BankStatementDocument['bank'] = 'unknown';
  if (/\bFNB\b|FIRST\s+NATIONAL\s+BANK/i.test(text)) bank = 'FNB';
  const accountType = /aspire\s+current/i.test(text) ? 'Aspire Current Account' : null;
  return {
    bank,
    accountType,
    accountNumber,
    currency: 'ZAR',
    period: {
      start: period.start ?? transactions[0]?.date ?? null,
      end: period.end ?? transactions[transactions.length - 1]?.date ?? null,
    },
    openingBalance,
    closingBalance,
    pages,
    transactions,
    analysis: analyze(transactions, openingBalance, closingBalance),
  };
}

export function parseBankStatementItems(items: readonly BankStatementTextItem[], pages = 1): BankStatementDocument {
  const positioned = items
    .filter((item) => item.str.trim())
    .map((item) => ({
      page: item.page ?? 1,
      x: item.transform?.[4] ?? 0,
      y: item.transform?.[5] ?? 0,
      text: item.str.replace(/\s+/g, ' ').trim(),
    }))
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const rows: { page: number; y: number; items: typeof positioned }[] = [];
  const positionedTransactions: { date: string; description: string; amount: string; balance: string }[] = [];
  for (const item of positioned) {
    let row = rows[rows.length - 1];
    if (!row || row.page !== item.page || Math.abs(row.y - item.y) > 2) {
      row = { page: item.page, y: item.y, items: [] };
      rows.push(row);
    }
    row.items.push(item);
  }
  const lines = rows.map((row) => {
    const ordered = row.items.sort((a, b) => a.x - b.x);
    const dateColumn = ordered.find((item) => item.x <= 30 && parseDatePrefix(item.text));
    if (!dateColumn) return ordered.map((item) => item.text).join(' ');

    const description = ordered.filter((item) => item.x > 30 && item.x < 440).map((item) => item.text).join(' ');
    const amount = ordered.filter((item) => item.x >= 440 && item.x < 500).map((item) => item.text).join(' ');
    const balance = ordered.filter((item) => item.x >= 500 && item.x < 560).map((item) => item.text).join(' ');
    if (amount || balance) positionedTransactions.push({ date: dateColumn.text, description, amount, balance });
    return [dateColumn.text, description, amount, balance].filter(Boolean).join(' ');
  });
  const document = parseBankStatementText(lines.join('\n'), pages);
  const transactions: StatementTransaction[] = [];
  let previousDate: string | null = null;
  let previousBalance = document.openingBalance?.signedAmount ?? null;
  for (const row of positionedTransactions) {
    const datePrefix = parseDatePrefix(row.date);
    const amount = balanceFrom(row.amount);
    if (!datePrefix || !amount) continue;
    const date = resolveDate(datePrefix.date, previousDate, document.period);
    const descriptionRaw = stripReferenceMetadata(
      `${parseDatePrefix(row.date)?.rest ?? ''} ${row.description}`.trim(),
    );
    const description = cleanDescription(descriptionRaw) || 'Unknown transaction';
    const movement = resolveMovement(
      amount.amount,
      amount.indicator,
      balanceFrom(row.balance),
      previousBalance,
      descriptionRaw,
    );
    const { flow, runningBalance, posted } = movement;
    const category = classify(descriptionRaw || description, flow);
    const issues: StatementIssue[] = [];
    if (previousDate && date < previousDate) issues.push('out_of_order');
    if (/(?:debicheck|debit order|edo collection|subscription).*(?:attempt|declined|failed|returned|unpaid|unsuccessful)|(?:attempt|declined|failed|returned|unpaid|unsuccessful).*(?:debicheck|debit order|edo collection|subscription)/i.test(descriptionRaw)) {
      issues.push('debit_order_attempt');
    }
    let balanceCheck: StatementTransaction['balanceCheck'] = 'unavailable';
    if (!posted && runningBalance && previousBalance !== null) {
      balanceCheck = Math.abs(runningBalance.signedAmount - previousBalance) <= 0.02 ? 'matched' : 'mismatch';
    } else if (runningBalance && previousBalance !== null) {
      const expected = roundMoney(previousBalance + (flow === 'credit' ? amount.amount : -amount.amount));
      balanceCheck = Math.abs(expected - runningBalance.signedAmount) <= 0.02 ? 'matched' : 'mismatch';
    }
    if (balanceCheck === 'mismatch') issues.push('balance_mismatch');
    transactions.push({
      id: `tx-${String(transactions.length + 1).padStart(5, '0')}`,
      date,
      descriptionRaw,
      description,
      merchant: cleanDescription(merchantName(description)),
      amount: amount.amount,
      flow,
      posted,
      incomeSource: flow !== 'credit' || category !== 'income'
        ? null
        : /salary|stansal|payroll|wages?|remuneration/i.test(descriptionRaw) ? 'salary' : 'other',
      category,
      runningBalance,
      balanceCheck,
      confidence: category === 'other' ? 'low' : runningBalance ? 'high' : 'medium',
      issues,
    });
    previousDate = date;
    if (runningBalance) previousBalance = runningBalance.signedAmount;
  }
  if (!transactions.length) throw new Error('No monetary transactions were found in this bank statement PDF.');
  return { ...document, transactions, analysis: analyze(transactions, document.openingBalance, document.closingBalance) };
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

const PER_MONTH: Record<RecurringFrequency, number> = { monthly: 1, weekly: 52 / 12, biweekly: 26 / 12 };

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Every recurring payment detected in a statement, as recurring-expense suggestions. */
export function detectedRecurringExpenses(document: BankStatementDocument): RecurringExpense[] {
  return document.analysis.recurringObligations.flatMap((item) =>
    item.cadence === 'irregular'
      ? []
      : [{
          id: `statement-recurring-${slug(item.key)}`,
          name: item.merchant,
          amount: item.averageAmount,
          category: item.category,
          billingDayOfMonth: item.billingDay,
          frequency: item.cadence,
          isEssential: item.category !== 'subscriptions' && item.category !== 'other',
          source: 'bank_statement' as const,
          active: true,
          confidence: item.confidence,
          monthsPaid: item.months,
        }],
  );
}

function monthlyEquivalent(expense: Pick<RecurringExpense, 'amount' | 'frequency'>): number {
  return expense.amount * (PER_MONTH[expense.frequency] ?? 1);
}

/**
 * True when a detected payment is one the user already has: the same payee name
 * (one containing the other) at a similar amount, or, for a bill typed in under
 * another name, the same category with the amount within 5% and the billing day
 * within 3 days.
 */
export function isSameRecurringExpense(candidate: RecurringExpense, saved: RecurringExpense): boolean {
  if (candidate.id === saved.id) return true;
  const a = payeeKey(candidate.name);
  const b = payeeKey(saved.name);
  const candidateMonthly = monthlyEquivalent(candidate);
  const savedMonthly = monthlyEquivalent(saved);
  const sameName = Boolean(a && b) && (a === b || (a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b)));
  if (sameName) {
    // A very different amount from the same payee is a second policy or account.
    const ratio = savedMonthly > 0 ? candidateMonthly / savedMonthly : 1;
    return ratio >= 0.5 && ratio <= 2;
  }
  const dayGap = Math.abs(candidate.billingDayOfMonth - saved.billingDayOfMonth);
  return candidate.category === saved.category &&
    candidate.category !== 'other' &&
    Math.abs(candidateMonthly - savedMonthly) <= Math.max(1, savedMonthly * 0.05) &&
    Math.min(dayGap, 31 - dayGap) <= 3;
}

export type RecurringSuggestionSplit = {
  fresh: RecurringExpense[];
  alreadySaved: { suggestion: RecurringExpense; existing: RecurringExpense }[];
};

/** Separates new suggestions from ones already saved, and drops repeats within the list. */
export function splitRecurringSuggestions(suggestions: readonly RecurringExpense[], saved: readonly RecurringExpense[]): RecurringSuggestionSplit {
  const fresh: RecurringExpense[] = [];
  const alreadySaved: RecurringSuggestionSplit['alreadySaved'] = [];
  for (const suggestion of suggestions) {
    const existing = saved.find((item) => isSameRecurringExpense(suggestion, item));
    if (existing) alreadySaved.push({ suggestion, existing });
    else if (!fresh.some((item) => isSameRecurringExpense(suggestion, item))) fresh.push(suggestion);
  }
  return { fresh, alreadySaved };
}

/** Recurring payments detected in a statement that the user has not saved yet. */
export function recurringExpensesFromStatement(document: BankStatementDocument, saved: readonly RecurringExpense[] = []): RecurringExpense[] {
  return splitRecurringSuggestions(detectedRecurringExpenses(document), saved).fresh;
}
