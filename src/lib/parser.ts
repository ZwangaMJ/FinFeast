/** Payslip and bank statement PDFs are parsed locally; remaining document types use prototype samples. */
import { addDays, monthStart, today, weekday } from '@/lib/dates';
import { PRICE_FACTOR } from '@/lib/format';
import type { Bill, Category, Confidence, Currency, DocType, IncomeFrequency, ReceiptItem, Transaction } from '@/store/types';
import {
  BankStatementPdfError,
  parseBankStatementItems,
  parseBankStatementText,
  recurringBillsFromStatement,
  toAppTransactions,
  type BankStatementDocument,
} from './bankStatement';
import { extractBankStatementPdf } from './bankStatementPdf';
import { summarizePayslip, PayslipPdfError, type PayslipBudgetSummary, type PayslipDocument } from './payslip';
import { extractPayslipPdf } from './payslipPdf';

export type Field<T> = { value: T; confidence: Confidence; sourceText: string };

export type ExtractionResult = {
  documentType: DocType;
  pages: number;
  period: { start: string | null; end: string | null };
  income: {
    gross: Field<number> | null;
    net: Field<number> | null;
    frequency: IncomeFrequency | null;
    employer: string | null;
    deductions: { label: string; amount: number; confidence: Confidence }[];
  } | null;
  bankStatement: BankStatementDocument | null;
  payslip: PayslipDocument | null;
  payslipSummary: PayslipBudgetSummary | null;
  recurringBills: Bill[];
  variableCategories: Partial<Record<Category, { monthly: number; count: number }>>;
  savingsTransfers: { label: string; monthly: number; confidence: Confidence }[];
  transactions: Transaction[];
  receipt: { merchant: string; total: number; date: string; lineItems: ReceiptItem[]; categoryGuess: Category; confidence: Confidence } | null;
  taxForm: { annualIncome: number; retirement: number } | null;
  flags: ('legibility_low' | 'multiple_periods' | 'unusual_amount' | 'duplicate_suspected')[];
};

export type UploadInput = { name: string; size: number; mimeType?: string; sample?: SampleKind; uri?: string };
export type SampleKind = 'payslip' | 'statement' | 'receipt' | 'tax' | 'blurry';

export const SAMPLES: { kind: SampleKind; label: string; name: string; icon: string }[] = [
  { kind: 'payslip', label: 'Sample payslip', name: 'Payslip_Sep.pdf', icon: 'document-text-outline' },
  { kind: 'statement', label: 'Sample bank statement', name: 'Statement_3_months.pdf', icon: 'reader-outline' },
  { kind: 'receipt', label: 'Sample grocery receipt', name: 'receipt_checkers.jpg', icon: 'receipt-outline' },
  { kind: 'blurry', label: 'Blurry photo', name: 'IMG_blurry.jpg', icon: 'eye-off-outline' },
];

export const SUPPORTED_TYPES = ['Payslips (text-based PDF; photo OCR coming soon)', 'Bank statements (text-based PDF; scanned OCR coming soon)', 'Grocery & restaurant receipts (photo)', 'Tax certificates (IRP5 / W-2 / P60)'];

/** Stable content fingerprint for duplicate detection (stand-in for a SHA-256 file hash). */
export function fileHash(input: UploadInput) {
  const s = `${input.sample ?? ''}|${input.name}|${input.size}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/** Auto-suggest a document type from the file (user confirms in U3). */
export function suggestType(input: UploadInput): DocType {
  const n = `${input.sample ?? ''} ${input.name}`.toLowerCase();
  if (/pay ?slip|salary|payslip/.test(n)) return 'payslip';
  if (/statement|bank|transactions/.test(n)) return 'bank_statement';
  if (/irp5|w-?2|p60|tax/.test(n)) return 'tax_form';
  if (/receipt|slip|till/.test(n) || input.mimeType?.startsWith('image/')) return 'receipt';
  if (input.mimeType === 'application/pdf') return 'bank_statement';
  return 'unknown';
}

export function pageCount(type: DocType, input: UploadInput) {
  if (type === 'bank_statement') return Math.max(3, Math.min(6, Math.round(input.size / 120000) || 4));
  return 1;
}

async function parsePayslipPdf(uri: string): Promise<{ document: PayslipDocument; pages: number }> {
  try {
    const { document, pages } = await extractPayslipPdf(uri);
    if (document.deductions.netPay === null) {
      throw new ParseError('illegible', 'Net pay was not found in the selected payslip. Try a text-based PDF or enter your totals manually.');
    }
    return { document, pages };
  } catch (error) {
    if (error instanceof PayslipPdfError) throw new ParseError(error.reason, error.message);
    throw error;
  }
}

async function parseBankStatementPdf(uri: string): Promise<BankStatementDocument> {
  try {
    const extracted = await extractBankStatementPdf(uri);
    return extracted.items
      ? parseBankStatementItems(extracted.items, extracted.pages)
      : parseBankStatementText(extracted.text, extracted.pages);
  } catch (error) {
    if (error instanceof BankStatementPdfError) throw new ParseError(error.reason, error.message);
    throw error;
  }
}

function averageMonthly(amount: number, start: string | null, end: string | null): number {
  if (!start || !end) return Math.round(amount * 100) / 100;
  const days = Math.max(1, (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1);
  return Math.round((amount * 30.4375 / days) * 100) / 100;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const uid = () => Math.random().toString(36).slice(2, 10);

function money(n: number, currency: Currency) {
  return Math.round(n * PRICE_FACTOR[currency]);
}

const GROCERS = ['Checkers', 'Pick n Pay', 'Woolworths Food', 'Spar'];
const TAKEAWAYS = ["Nando's", 'Mr D Food', 'KFC', 'Uber Eats', 'Debonairs'];
const LUNCH_SPOTS = ['Vida e Caffè', 'Kauai', 'Seattle Coffee'];

function statementTransactions(seed: number, currency: Currency, docId: string): Transaction[] {
  const r = rng(seed);
  const out: Transaction[] = [];
  const end = today();
  const start = addDays(end, -7 * 9);
  const push = (date: string, merchant: string, amount: number, category: Category, confidence: Confidence = 'high', extra: Partial<Transaction> = {}) =>
    out.push({ id: uid(), date, merchant, amount: money(amount, currency), kind: 'expense', category, confidence, sourceDocId: docId, ...extra });

  for (let d = start; d <= end; d = addDays(d, 1)) {
    const wd = weekday(d);
    const dom = Number(d.slice(8, 10));
    if (wd === 2 || wd === 6) push(d, GROCERS[Math.floor(r() * 3)], 240 + r() * 220, 'food_grocery');
    if (wd === 5) push(d, TAKEAWAYS[Math.floor(r() * TAKEAWAYS.length)], 165 + r() * 45, 'food_dining');
    if (wd === 6 && r() < 0.5) push(d, TAKEAWAYS[Math.floor(r() * TAKEAWAYS.length)], 120 + r() * 80, 'food_dining');
    if ((wd === 3 || wd === 4) && r() < 0.45) push(d, LUNCH_SPOTS[Math.floor(r() * LUNCH_SPOTS.length)], 65 + r() * 40, 'food_dining');
    if (wd === 1) push(d, r() < 0.5 ? 'Engen fuel' : 'Uber', 180 + r() * 120, 'transport');
    if (wd === 0 && r() < 0.35) push(d, r() < 0.5 ? 'Mr Price' : 'Takealot', 150 + r() * 300, 'shopping');
    if (wd === 6 && r() < 0.25) push(d, 'Ster-Kinekor', 140 + r() * 60, 'entertainment');
    if (r() < 0.04) push(d, 'Clicks', 90 + r() * 150, 'health');
    if (dom === 25) out.push({ id: uid(), date: d, merchant: 'Salary deposit', amount: money(24500, currency), kind: 'income', category: 'income', confidence: 'high', sourceDocId: docId });
    if (dom === 26) out.push({ id: uid(), date: d, merchant: 'Transfer to savings pocket', amount: money(1000, currency), kind: 'transfer', category: 'savings', confidence: 'high', sourceDocId: docId });
    if (dom === 1) push(d, 'Rent — debit order', 5200, 'bills');
    if (dom === 5) push(d, 'Vodacom contract', 599, 'bills');
    if (dom === 3) push(d, 'Car insurance', 401, 'bills');
    if (dom === 12) push(d, 'StreamFit', 99, 'bills', 'medium');
    if (dom === 18) push(d, 'MusicPlus', 69, 'bills', 'medium');
  }
  // One ambiguous item for the low-confidence question chip
  push(addDays(end, -3), 'Checkers Hyper', 612, 'food_grocery', 'low', {
    question: "Is 'Checkers Hyper' groceries or household items?",
    alternatives: ['food_grocery', 'household'],
  });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Resolves after extraction and the processing animation; may throw ParseError. */
export async function parseDocument(input: UploadInput, type: DocType, currency: Currency, docId: string): Promise<ExtractionResult> {
  await new Promise((res) => setTimeout(res, 50));
  if (input.sample === 'blurry' || /blur/i.test(input.name)) throw new ParseError('illegible');
  if (type === 'unknown') throw new ParseError('unsupported');

  const base: ExtractionResult = {
    documentType: type,
    pages: pageCount(type, input),
    period: { start: null, end: null },
    income: null,
    bankStatement: null,
    payslip: null,
    payslipSummary: null,
    recurringBills: [],
    variableCategories: {},
    savingsTransfers: [],
    transactions: [],
    receipt: null,
    taxForm: null,
    flags: [],
  };
  const seed = parseInt(fileHash(input), 16);

  if (type === 'payslip') {
    if (input.uri) {
      if (input.mimeType !== 'application/pdf' && !input.name.toLowerCase().endsWith('.pdf')) {
        throw new ParseError('unsupported', 'Payslip photo OCR is not available yet. Choose a text-based PDF instead.');
      }
      if (input.size > 20 * 1024 * 1024) throw new ParseError('unsupported', 'This PDF is larger than the 20 MB limit.');
      const { document, pages } = await parsePayslipPdf(input.uri);
      const toField = (label: string, value: number | null) =>
        value === null ? null : { value, confidence: 'high' as const, sourceText: `${label}: ${value.toFixed(2)}` };
      const deductions: { label: string; amount: number; confidence: Confidence }[] = [
        ...[
        { label: 'UIF', amount: document.deductions.uif, confidence: 'high' as const },
        { label: 'Group Life', amount: document.deductions.groupLife, confidence: 'high' as const },
        ].flatMap((deduction) =>
          deduction.amount === null ? [] : [{ ...deduction, amount: deduction.amount, confidence: 'high' as Confidence }],
        ),
        ...document.deductions.other.flatMap((item) =>
          item.amount === null ? [] : [{ label: item.label, amount: item.amount, confidence: 'high' as Confidence }],
        ),
      ];
      return {
        ...base,
        pages,
        period: { start: document.periodStart, end: document.periodEnd },
        income: {
          gross: toField('Total Earnings', document.earnings.total),
          net: toField('Net Pay', document.deductions.netPay),
          frequency: 'monthly',
          employer: document.employer.name,
          deductions,
        },
        payslip: document,
        payslipSummary: summarizePayslip(document),
      };
    }
    return {
      ...base,
      period: { start: monthStart(), end: today() },
      income: {
        gross: { value: money(31200, currency), confidence: 'high', sourceText: 'GROSS EARNINGS ...... 31 200.00' },
        net: { value: money(24500, currency), confidence: 'high', sourceText: 'NETT PAY ...... 24 500.00' },
        frequency: 'monthly',
        employer: 'Employer (masked)',
        deductions: [
          { label: 'PAYE', amount: money(4980, currency), confidence: 'high' },
          { label: 'Pension fund', amount: money(1404, currency), confidence: 'high' },
          { label: 'UIF', amount: money(177, currency), confidence: 'high' },
          { label: 'Medical aid', amount: money(139, currency), confidence: 'medium' },
        ],
      },
      payslip: null,
    };
  }

  if (type === 'bank_statement') {
    if (input.uri) {
      if (input.mimeType !== 'application/pdf' && !input.name.toLowerCase().endsWith('.pdf')) {
        throw new ParseError('unsupported', 'Choose a PDF bank statement. Photo OCR is not available yet.');
      }
      if (input.size > 20 * 1024 * 1024) throw new ParseError('unsupported', 'This PDF is larger than the 20 MB limit.');
      const bankStatement = await parseBankStatementPdf(input.uri);
      const transactions = toAppTransactions(bankStatement, docId);
      const start = bankStatement.period.start;
      const end = bankStatement.period.end;
      const categoryMonthly = (categories: readonly Category[]) => {
        const matching = transactions.filter((transaction) => transaction.kind === 'expense' && categories.includes(transaction.category));
        return {
          monthly: averageMonthly(matching.reduce((sum, transaction) => sum + transaction.amount, 0), start, end),
          count: matching.length,
        };
      };
      const savingsAmount = bankStatement.transactions
        .filter((transaction) => transaction.flow === 'debit' && transaction.category === 'transfer' && /saving|investment|pocket/i.test(transaction.description))
        .reduce((sum, transaction) => sum + transaction.amount, 0);
      const netIncome = bankStatement.analysis.recognizedIncome > 0
        ? averageMonthly(bankStatement.analysis.recognizedIncome, start, end)
        : null;
      return {
        ...base,
        pages: bankStatement.pages,
        period: { start, end },
        income: netIncome === null ? null : {
          gross: null,
          net: { value: netIncome, confidence: 'high', sourceText: `Recognized salary and income credits · ${start ?? 'period start unavailable'} to ${end ?? 'period end unavailable'}` },
          frequency: 'monthly',
          employer: null,
          deductions: [],
        },
        bankStatement,
        recurringBills: recurringBillsFromStatement(bankStatement),
        variableCategories: {
          food_grocery: categoryMonthly(['food_grocery']),
          food_dining: categoryMonthly(['food_dining']),
          transport: categoryMonthly(['transport']),
          shopping: categoryMonthly(['shopping']),
          entertainment: categoryMonthly(['entertainment']),
          health: categoryMonthly(['health']),
        },
        savingsTransfers: savingsAmount > 0
          ? [{ label: 'Savings / investment transfers', monthly: averageMonthly(savingsAmount, start, end), confidence: 'medium' }]
          : [],
        transactions,
      };
    }
    if (input.sample !== 'statement') {
      throw new ParseError('unsupported', 'A bank statement PDF is required. Choose a PDF with selectable text; scanned statement OCR is not available yet.');
    }
    const tx = statementTransactions(seed, currency, docId);
    const monthsSpan = 2;
    const cat = (c: Category) => {
      const list = tx.filter((t) => t.category === c && t.kind === 'expense');
      return { monthly: Math.round(list.reduce((s, t) => s + t.amount, 0) / monthsSpan / 10) * 10, count: list.length };
    };
    return {
      ...base,
      period: { start: addDays(today(), -63), end: today() },
      income: {
        gross: null,
        net: { value: money(24500, currency), confidence: 'medium', sourceText: 'SALARY DEPOSIT 25th ...... 24 500.00' },
        frequency: 'monthly',
        employer: null,
        deductions: [],
      },
      recurringBills: [
        { id: uid(), name: 'Rent', amount: money(5200, currency), day: 1, cadence: 'monthly', confidence: 'high', active: true, isSubscription: false, monthsPaid: 12 },
        { id: uid(), name: 'Vodacom contract', amount: money(599, currency), day: 5, cadence: 'monthly', confidence: 'high', active: true, isSubscription: false, monthsPaid: 12 },
        { id: uid(), name: 'Car insurance', amount: money(401, currency), day: 3, cadence: 'monthly', confidence: 'high', active: true, isSubscription: false, monthsPaid: 12 },
        { id: uid(), name: 'StreamFit', amount: money(99, currency), day: 12, cadence: 'monthly', confidence: 'medium', active: true, isSubscription: true, usageNote: 'opened once in 7 months', monthsPaid: 7 },
        { id: uid(), name: 'MusicPlus', amount: money(69, currency), day: 18, cadence: 'monthly', confidence: 'medium', active: true, isSubscription: true, monthsPaid: 14 },
      ],
      variableCategories: {
        food_grocery: cat('food_grocery'),
        food_dining: cat('food_dining'),
        transport: cat('transport'),
        shopping: cat('shopping'),
        entertainment: cat('entertainment'),
        health: cat('health'),
      },
      savingsTransfers: [{ label: 'Savings pocket', monthly: money(1000, currency), confidence: 'high' }],
      transactions: tx,
    };
  }

  if (type === 'receipt') {
    const r = rng(seed);
    const items: ReceiptItem[] = [
      { name: 'Clover milk 2L', price: 38.99, brand: true, storeBrandPrice: 32.99, perishable: true },
      { name: 'Jungle oats 1kg', price: 54.99, brand: true, storeBrandPrice: 39.99 },
      { name: 'Chicken thighs 1kg', price: 74.99, perishable: true },
      { name: 'Fresh coriander', price: 14.99, perishable: true },
      { name: 'Tastic rice 2kg', price: 52.99, brand: true, storeBrandPrice: 41.99 },
      { name: 'Onions 2kg', price: 34.99 },
      { name: 'Bananas', price: 26.5 + Math.round(r() * 3), perishable: true },
    ].map((i) => ({ ...i, price: Math.round(i.price * PRICE_FACTOR[currency] * 100) / 100, storeBrandPrice: i.storeBrandPrice && Math.round(i.storeBrandPrice * PRICE_FACTOR[currency] * 100) / 100 }));
    const total = Math.round(items.reduce((s, i) => s + i.price, 0) * 100) / 100;
    return {
      ...base,
      receipt: { merchant: 'Checkers', total, date: today(), lineItems: items, categoryGuess: 'food_grocery', confidence: 'high' },
    };
  }

  if (type === 'tax_form') {
    return { ...base, taxForm: { annualIncome: money(374400, currency), retirement: money(16848, currency) }, period: { start: `${new Date().getFullYear() - 1}-03-01`, end: `${new Date().getFullYear()}-02-28` } };
  }
  return base;
}

export class ParseError extends Error {
  constructor(
    public reason: 'illegible' | 'unsupported',
    message: string = reason,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}
