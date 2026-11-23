/** Payslip and bank statement PDFs are parsed locally. */
import type { Bill, Category, Confidence, DocType, IncomeFrequency, ReceiptItem, Transaction } from '@/store/types';
import {
  BankStatementPdfError,
  parseStatementItems,
  parseStatementText,
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

export type UploadInput = { name: string; size: number; mimeType?: string; uri: string };

export const SUPPORTED_TYPES = ['Payslips (text-based PDF)', 'Bank statements (text-based PDF)'];

/** Stable content fingerprint for duplicate detection (stand-in for a SHA-256 file hash). */
export function fileHash(input: UploadInput) {
  const s = `${input.name}|${input.size}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/** Auto-suggest a document type from the file (user confirms in U3). */
export function suggestType(input: UploadInput): DocType {
  const n = input.name.toLowerCase();
  if (/pay ?slip|salary|payslip/.test(n)) return 'payslip';
  if (/statement|bank|transactions/.test(n)) return 'bank_statement';
  if (/irp5|w-?2|p60|tax/.test(n)) return 'tax_form';
  if (/receipt|slip|till/.test(n) || input.mimeType?.startsWith('image/')) return 'receipt';
  if (input.mimeType === 'application/pdf') return 'bank_statement';
  return 'unknown';
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
    // The pure parser needs a year for rows without one; this boundary reads the clock
    const options = { pages: extracted.pages, fallbackYear: new Date().getFullYear() };
    const result = extracted.items ? parseStatementItems(extracted.items, options) : parseStatementText(extracted.text, options);
    if (!result.ok) throw new ParseError('illegible', result.error.message);
    return result.value;
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

/** Extracts a selected document; unsupported document types fail without sample data. */
export async function parseDocument(input: UploadInput, type: DocType, docId: string): Promise<ExtractionResult> {
  if (type === 'unknown') throw new ParseError('unsupported');
  if (type === 'receipt') throw new ParseError('unsupported', 'Receipt extraction is not available yet. No data was added.');
  if (type === 'tax_form') throw new ParseError('unsupported', 'Tax-form extraction is not available yet. No data was added.');

  const base: ExtractionResult = {
    documentType: type,
    pages: 1,
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

  if (type === 'payslip') {
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

  if (type === 'bank_statement') {
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

  throw new ParseError('unsupported', 'This document type cannot be extracted yet. No data was added.');
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
