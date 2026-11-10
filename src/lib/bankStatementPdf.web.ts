import { BankStatementPdfError, type BankStatementTextItem } from './bankStatement';

export async function extractBankStatementPdf(uri: string): Promise<{ text: string; pages: number; items?: BankStatementTextItem[] }> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`Could not read the selected PDF (HTTP ${response.status}).`);

  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength === 0) throw new Error('The selected PDF is empty.');
  if (data.byteLength > 20 * 1024 * 1024) throw new BankStatementPdfError('unsupported', 'This PDF is larger than the 20 MB limit.');

  const { getDocument, GlobalWorkerOptions, version } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.mjs`;
  const pdf = await getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  try {
    if (pdf.numPages > 100) throw new BankStatementPdfError('unsupported', 'Bank statements with more than 100 pages are not supported.');

    const pageTexts: string[] = [];
    const positionedText: BankStatementTextItem[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      positionedText.push(...content.items.flatMap((item) => 'str' in item && item.str.trim()
        ? [{ str: item.str, transform: item.transform, page: pageNumber }]
        : []));
      const items = content.items
        .flatMap((item) => 'str' in item && item.str.trim()
          ? [{ x: item.transform[4], y: item.transform[5], text: item.str.replace(/\s+/g, ' ').trim() }]
          : [])
        .sort((a, b) => b.y - a.y || a.x - b.x);
      const rows: { y: number; items: typeof items }[] = [];
      for (const item of items) {
        let row = rows[rows.length - 1];
        if (!row || Math.abs(row.y - item.y) > 2) {
          row = { y: item.y, items: [] };
          rows.push(row);
        }
        row.items.push(item);
      }
      pageTexts.push(rows.map((row) => row.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' ')).join('\n'));
    }

    const text = pageTexts.join('\n');
    if (!text.trim()) throw new BankStatementPdfError('illegible', 'No embedded text was found. Scanned bank statement OCR is not available yet.');
    return { text, pages: pdf.numPages, items: positionedText };
  } finally {
    await pdf.destroy();
  }
}
