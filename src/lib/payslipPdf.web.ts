import { parsePayslipItems, PayslipPdfError, type PayslipDocument, type PayslipTextItem } from './payslip';

export async function extractPayslipPdf(uri: string): Promise<{ document: PayslipDocument; pages: number }> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`Could not read the selected PDF (HTTP ${response.status}).`);

  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength === 0) throw new Error('The selected PDF is empty.');
  if (data.byteLength > 20 * 1024 * 1024) throw new PayslipPdfError('unsupported', 'This PDF is larger than the 20 MB limit.');

  const { getDocument, GlobalWorkerOptions, version } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.mjs`;
  const pdf = await getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  try {
    if (pdf.numPages > 20) throw new PayslipPdfError('unsupported', 'Payslips with more than 20 pages are not supported.');

    const textItems: PayslipTextItem[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ('str' in item && item.str.trim()) textItems.push({ str: item.str, transform: item.transform });
      }
    }

    return { document: parsePayslipItems(textItems), pages: pdf.numPages };
  } finally {
    await pdf.destroy();
  }
}
