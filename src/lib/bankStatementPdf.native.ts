import { extractText, getPageCount, isAvailable } from 'expo-pdf-text-extract';

import { BankStatementPdfError, type BankStatementTextItem } from './bankStatement';

export async function extractBankStatementPdf(uri: string): Promise<{ text: string; pages: number; items?: BankStatementTextItem[] }> {
  if (!isAvailable()) {
    throw new BankStatementPdfError('unsupported', 'PDF extraction requires an app development build. It is not available in Expo Go.');
  }

  const pages = await getPageCount(uri);
  if (pages > 100) throw new BankStatementPdfError('unsupported', 'Bank statements with more than 100 pages are not supported.');

  const text = await extractText(uri);
  if (!text.trim()) throw new BankStatementPdfError('illegible', 'No embedded text was found. Scanned bank statement OCR is not available yet.');
  return { text, pages };
}
