import { extractText, getPageCount, isAvailable } from 'expo-pdf-text-extract';

import { parsePayslipText, PayslipPdfError, type PayslipDocument } from './payslip';

export async function extractPayslipPdf(uri: string): Promise<{ document: PayslipDocument; pages: number }> {
  if (!isAvailable()) {
    throw new PayslipPdfError('unsupported', 'PDF extraction requires an app development build. It is not available in Expo Go.');
  }

  const pages = await getPageCount(uri);
  if (pages > 20) throw new PayslipPdfError('unsupported', 'Payslips with more than 20 pages are not supported.');

  const text = await extractText(uri);
  if (!text.trim()) throw new PayslipPdfError('illegible', 'No embedded text was found. Scanned payslip OCR is not available yet.');
  return { document: parsePayslipText(text), pages };
}
