export type PayslipEmployee = Readonly<{
  code: string | null;
  name: string | null;
  idNumber: string | null;
  address: string | null;
  jobTitle: string | null;
  jobGrade: string | null;
  dateEngaged: string | null;
  payPeriod: string | null;
}>;

export type PayslipEmployer = Readonly<{
  name: string | null;
  address: string | null;
  payeReference: string | null;
  uifRegistrationNumber: string | null;
}>;

export type PayslipLineItem = Readonly<{
  label: string;
  units: number | null;
  amount: number | null;
}>;

export type EarningsBreakdown = Readonly<{
  cashComponent: number | null;
  overtime15: PayslipLineItem | null;
  other: readonly PayslipLineItem[];
  total: number | null;
}>;

export type DeductionsBreakdown = Readonly<{
  uif: number | null;
  groupLife: number | null;
  other: readonly PayslipLineItem[];
  total: number | null;
  netPay: number | null;
}>;

export type CompanyContributions = Readonly<{
  sdl: number | null;
  uif: number | null;
  providentFund: number | null;
  mediclub: number | null;
  other: readonly PayslipLineItem[];
  total: number | null;
}>;

export type YtdTotals = Readonly<{
  taxPaid: number | null;
  taxableEarnings: number | null;
  taxableCompanyContributions: number | null;
  fringeBenefits: number | null;
  taxDeductibleDeductions: number | null;
  provisions: number | null;
  privateContributions: number | null;
}>;

export type PayslipDocument = Readonly<{
  currency: 'ZAR';
  employee: PayslipEmployee;
  employer: PayslipEmployer;
  periodStart: string | null;
  periodEnd: string | null;
  earnings: EarningsBreakdown;
  deductions: DeductionsBreakdown;
  companyContributions: CompanyContributions;
  fringeBenefits: Readonly<{
    retirementFund: number | null;
    other: readonly PayslipLineItem[];
    total: number | null;
  }>;
  ytdTotals: YtdTotals;
  packageTotals: Readonly<{
    annualPackage: number | null;
    monthlyPackage: number | null;
    aggregate: number | null;
    totalAdditionals: number | null;
  }>;
  warnings: readonly string[];
}>;

export type PayslipTextItem = Readonly<{
  str: string;
  transform?: readonly number[];
}>;

export type PayslipBudgetSummary = Readonly<{
  currency: 'ZAR';
  employer: string | null;
  payPeriod: string | null;
  disposableNetIncome: number | null;
  grossEarnings: number | null;
  grossPackage: number | null;
  disposableIncomePercentOfGrossPackage: number | null;
  fixedDeductions: Readonly<{
    uif: Readonly<{ amount: number | null; percentOfGrossEarnings: number | null }>;
    groupLife: Readonly<{ amount: number | null; percentOfGrossEarnings: number | null }>;
  }>;
}>;

export class PayslipPdfError extends Error {
  public reason: 'illegible' | 'unsupported';

  constructor(
    reason: 'illegible' | 'unsupported',
    message: string,
  ) {
    super(message);
    this.name = 'PayslipPdfError';
    this.reason = reason;
  }
}

type PositionedText = { x: number; y: number; text: string };
type TextRow = { y: number | null; cells: PositionedText[]; text: string };

const METADATA_LABELS = [
  /^(?:emp(?:loyee)?\.?\s*)?code\b/i,
  /^(?:emp(?:loyee)?\.?\s*)?name\b/i,
  /^id\s+number\b/i,
  /^(?:emp(?:loyee)?\.?\s*)?address\b/i,
  /^job\s+title\b/i,
  /^job\s+grade\b/i,
  /^date\s+engaged\b/i,
  /^pay\s+period\b/i,
  /^(?:co(?:mpany)?\.?\s*)?name\b/i,
  /^(?:co(?:mpany)?\.?\s*)?address\b/i,
  /^paye\s+ref(?:\.?\s*no\.?)?/i,
  /^uif\s+(?:reg|registration)(?:\.?\s*no\.?)?/i,
  /^known\s+as\b/i,
  /^company\s+rule\b/i,
  /^rate\s+per\s+hour\b/i,
  /^hours\s+per\s+period\b/i,
  /^termination\s+date\b/i,
  /^account\s+no\b/i,
  /^income\s+tax\s+no\b/i,
  /^branch\s+no\b/i,
  /^payment\s+type\b/i,
];

const trimValue = (value: string | undefined): string | null => {
  const cleaned = value?.replace(/^[\s:|=-]+|[\s|]+$/g, '').trim();
  return cleaned || null;
};

function isMetadataLabel(value: string): boolean {
  return METADATA_LABELS.some((pattern) => pattern.test(value.trim()));
}

function makeRows(text: string): TextRow[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap(splitMergedTableLine)
    .map((line) => ({ y: null, cells: [], text: line.replace(/\s+/g, ' ') }));
}

function splitMergedTableLine(line: string): string[] {
  const labels = [
    'Employee Address',
    'Company Address',
    'Total Company Contributions',
    'Taxable Company Contributions',
    'Tax Deductible Deductions',
    'Total Fringe Benefits',
    'Total Additionals',
    'Total Earnings',
    'Total Deductions',
    'Cash Component',
    'Overtime 1.5',
    'Provident Fund',
    'Group Life',
    'Taxable Earnings',
    'Private Contributions',
    'Company Contributions',
    'Year To Date Totals',
    'Employee Code',
    'Employee Name',
    'Date Engaged',
    'Monthly Package',
    'Annual Package',
    'Company Name',
    'Job Title',
    'Job Grade',
    'Pay Period',
    'ID Number',
    'PAYE Ref. No.',
    'UIF Reg. No.',
    'Fringe Benefits',
    'Net Pay',
    'Mediclub',
    'Aggregate',
    'Deductions',
    'Earnings',
    'Retirement Fund',
    'Provisions',
    'Tax Paid',
    'Additionals',
    'SDL',
    'UIF',
  ];
  const pattern = new RegExp(`\\b(${labels.join('|')})\\b`, 'gi');
  const matches = [...line.matchAll(pattern)];
  if (matches.length < 2) return [line];

  const result: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index ?? 0;
    const end = matches[i + 1]?.index ?? line.length;
    const text = line.slice(start, end).trim();
    if (text) result.push(text);
  }
  if (matches[0].index && matches[0].index > 0) result.unshift(line.slice(0, matches[0].index).trim());
  return result;
}

function makeRowsFromItems(items: readonly PayslipTextItem[]): TextRow[] {
  const positioned = items
    .filter((item) => item.str.trim())
    .map((item) => ({
      x: item.transform?.[4] ?? 0,
      y: item.transform?.[5] ?? 0,
      text: item.str.replace(/\s+/g, ' ').trim(),
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: TextRow[] = [];

  for (const item of positioned) {
    let row = rows[rows.length - 1];
    if (!row || row.y === null || Math.abs(row.y - item.y) > 1.5) {
      row = { y: item.y, cells: [], text: '' };
      rows.push(row);
    }
    row.cells.push(item);
  }

  for (const row of rows) {
    row.cells.sort((a, b) => a.x - b.x);
    row.text = row.cells.map((cell) => cell.text).join(' ');
  }
  return rows;
}

function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ').trim();
}

function findLabelRow(rows: readonly TextRow[], labels: readonly string[], from = 0, to = rows.length): number {
  const wanted = labels.map(normalizeLabel);
  for (let i = from; i < to; i++) {
    const line = normalizeLabel(rows[i].text);
    if (wanted.some((label) => line === label || line.startsWith(`${label} `) || line.startsWith(`${label}:`))) return i;
  }
  return -1;
}

function findExactLabelRow(rows: readonly TextRow[], label: string, from = 0, to = rows.length): number {
  const wanted = normalizeLabel(label);
  for (let i = from; i < to; i++) {
    if (normalizeLabel(rows[i].text) === wanted) return i;
  }
  return -1;
}

function section(rows: readonly TextRow[], title: string, nextTitles: readonly string[]): TextRow[] {
  const start = findExactLabelRow(rows, title);
  if (start < 0) return [];
  let end = rows.length;
  for (const next of nextTitles) {
    const nextIndex = next === 'Net Pay' ? findLabelRow(rows, [next], start + 1) : findExactLabelRow(rows, next, start + 1);
    if (nextIndex >= 0) end = Math.min(end, nextIndex);
  }
  return rows.slice(start + 1, end);
}

function tableSection(rows: readonly TextRow[], title: string, titleMinX: number, titleMaxX: number, columnMinX: number, columnMaxX: number): TextRow[] {
  let titleRow = -1;
  let titleY = 0;
  for (let i = 0; i < rows.length; i++) {
    const cell = rows[i].cells.find(
      (candidate) => candidate.x >= titleMinX && candidate.x <= titleMaxX && normalizeLabel(candidate.text) === normalizeLabel(title),
    );
    if (cell) {
      titleRow = i;
      titleY = cell.y;
      break;
    }
  }
  if (titleRow < 0) return [];

  const nextTitles =
    title === 'Earnings'
      ? ['Company Contributions']
      : title === 'Deductions'
        ? ['Year To Date Totals']
        : title === 'Company Contributions'
          ? ['Fringe Benefits']
          : title === 'Year To Date Totals'
            ? ['Additionals']
            : [];
  let endY = Number.NEGATIVE_INFINITY;
  for (const nextTitle of nextTitles) {
    for (const row of rows.slice(titleRow + 1)) {
      if (row.y === null || row.y >= titleY) continue;
      const nextCell = row.cells.find(
        (candidate) =>
          candidate.x >= titleMinX &&
          candidate.x <= titleMaxX &&
          normalizeLabel(candidate.text) === normalizeLabel(nextTitle),
      );
      if (nextCell) endY = Math.max(endY, nextCell.y);
    }
  }

  const selectedRows = rows
    .filter((row) => row.y !== null && row.y < titleY && row.y > endY)
    .map((row) => ({
      ...row,
      cells: row.cells.filter((cell) => cell.x >= columnMinX && cell.x <= columnMaxX),
      text: row.cells
        .filter((cell) => cell.x >= columnMinX && cell.x <= columnMaxX)
        .map((cell) => cell.text)
        .join(' '),
    }))
    .filter((row) => row.text.length > 0);
  const endMarker =
    title === 'Earnings'
      ? 'Total Earnings'
      : title === 'Deductions'
        ? 'Net Pay'
        : title === 'Company Contributions'
          ? 'Total Company Contributions'
          : title === 'Year To Date Totals'
            ? 'Private Contributions'
            : title === 'Fringe Benefits'
              ? 'Total Fringe Benefits'
              : 'Total Additionals';
  const endIndex = selectedRows.findIndex((row) => normalizeLabel(row.text).startsWith(normalizeLabel(endMarker)));
  return endIndex < 0 ? selectedRows : selectedRows.slice(0, endIndex + 1);
}

const AMOUNT_TOKEN = /-?\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?/g;

export function parseSouthAfricanAmount(input: string): number | null {
  let value = input.trim().replace(/^[Rr]\s*/, '').replace(/[\s\u00a0\u202f]/g, '').replace(/[^\d,.-]/g, '');
  if (!value || !/\d/.test(value)) return null;

  const negativeByParentheses = input.trim().startsWith('(') && input.trim().endsWith(')');
  const negativeBySign = value.startsWith('-');
  value = value.replace(/-/g, '');
  const comma = value.lastIndexOf(',');
  const dot = value.lastIndexOf('.');

  if (comma >= 0 && dot >= 0) {
    value = comma > dot ? value.replace(/\./g, '').replace(',', '.') : value.replace(/,/g, '');
  } else if (comma >= 0) {
    value = /\d,\d{1,2}$/.test(value) ? value.replace(',', '.') : value.replace(/,/g, '');
  } else if (dot >= 0 && !/\.\d{1,2}$/.test(value)) {
    value = value.replace(/\./g, '');
  }

  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return negativeByParentheses || negativeBySign ? -amount : amount;
}

function amounts(line: string): number[] {
  return [...line.matchAll(AMOUNT_TOKEN)]
    .map((match) => parseSouthAfricanAmount(match[0]))
    .filter((amount): amount is number => amount !== null);
}

function rowAmount(rows: readonly TextRow[], labels: readonly string[], from = 0, to = rows.length): number | null {
  const index = findLabelRow(rows, labels, from, to);
  return index < 0 ? null : (amounts(rows[index].text).at(-1) ?? null);
}

function matchingLine(rows: readonly TextRow[], labels: readonly string[], from = 0, to = rows.length): string | null {
  const index = findLabelRow(rows, labels, from, to);
  return index < 0 ? null : rows[index].text;
}

function parseIsoDate(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function rowForItem(rows: readonly TextRow[], label: RegExp): number {
  return rows.findIndex((row) => label.test(row.text));
}

function parsePositionedMetadata(rows: readonly TextRow[], label: RegExp, continuationRows: number): string | null {
  let labelRowIndex = -1;
  let labelCell: PositionedText | undefined;
  for (let i = 0; i < rows.length; i++) {
    labelCell = rows[i].cells.find((cell) => label.test(cell.text));
    if (labelCell) {
      labelRowIndex = i;
      break;
    }
  }
  if (labelRowIndex < 0 || !labelCell) return null;

  const row = rows[labelRowIndex];
  const valueX = labelCell.x < 100 ? labelCell.x + 61 : labelCell.x < 350 ? labelCell.x + 94 : labelCell.x + 51;
  const sameRowValue = row.cells.find((cell) => cell.x >= valueX - 18 && cell.x <= valueX + 32 && !isMetadataLabel(cell.text));
  const values = sameRowValue ? [sameRowValue.text] : [];
  const minX = valueX - 18;
  const maxX = valueX + 32;
  const labelY = labelCell.y;
  const maxYDistance = continuationRows === 2 ? 12 : continuationRows > 2 ? 65 : 12;

  for (let i = labelRowIndex + 1; i < rows.length && values.length <= continuationRows; i++) {
    const nextRow = rows[i];
    if (nextRow.y === null || labelY - nextRow.y > maxYDistance) break;
    if (nextRow.cells.some((cell) => Math.abs(cell.x - labelCell!.x) < 25 && isMetadataLabel(cell.text) && !label.test(cell.text))) break;
    const value = nextRow.cells.find((cell) => cell.x >= minX && cell.x <= maxX && !isMetadataLabel(cell.text));
    if (value) values.push(value.text);
  }
  return trimValue(values.join(' '));
}

function metadataValue(rows: readonly TextRow[], label: RegExp, continuationRows = 0): string | null {
  if (rows.some((row) => row.cells.length > 0)) return parsePositionedMetadata(rows, label, continuationRows);

  const index = rowForItem(rows, label);
  if (index < 0) return null;
  const current = rows[index].text.replace(label, '').replace(/^[\s:|=-]+/, '').trim();
  if (current) return trimValue(current);
  if (continuationRows === 0) {
    const next = rows[index + 1]?.text;
    return next && !isMetadataLabel(next) ? trimValue(next) : null;
  }
  const collected: string[] = [];
  for (const row of rows.slice(index + 1, index + continuationRows + 2)) {
    if (isMetadataLabel(row.text)) break;
    collected.push(row.text);
  }
  return trimValue(collected.join(' '));
}

function itemLine(line: string, label: string, units = false): PayslipLineItem {
  const values = amounts(line);
  return {
    label,
    units: units && values.length > 1 ? values[values.length - 2] : null,
    amount: values.at(-1) ?? null,
  };
}

function distinctWarnings(values: readonly (string | null)[]): string[] {
  return values.flatMap((value) => (value ? [] : ['Some identifying or pay-period details were not found.']));
}

function buildDocument(rows: readonly TextRow[], hasPairedTableHeadings = false): PayslipDocument {
  const hasLayout = rows.some((row) => row.cells.length > 0);
  const companyHeading = findExactLabelRow(rows, 'Company Contributions');
  const ytdHeading = findExactLabelRow(rows, 'Year To Date Totals');
  const fringeHeading = findExactLabelRow(rows, 'Fringe Benefits', ytdHeading + 1);
  const additionalsHeading = findExactLabelRow(rows, 'Additionals', Math.max(0, fringeHeading + 1));
  const deductionHeading = findExactLabelRow(rows, 'Deductions');
  const pairedRows = (start: number, end: number, label: RegExp) =>
    rows.slice(Math.max(start, 0), end < 0 ? rows.length : end).filter((row) => label.test(row.text));
  const earningRows = hasLayout
    ? tableSection(rows, 'Earnings', 100, 250, 0, 295)
    : hasPairedTableHeadings
      ? pairedRows(deductionHeading + 1, companyHeading, /^(?:cash component|overtime\s+1[.,]5|total earnings)\b/i)
    : section(rows, 'Earnings', ['Deductions']);
  const deductionRows = hasLayout
    ? tableSection(rows, 'Deductions', 350, 450, 295, Number.POSITIVE_INFINITY)
    : hasPairedTableHeadings
      ? pairedRows(deductionHeading + 1, companyHeading, /^(?:uif\b(?!\s+(?:reg|registration))|group life|total deductions|net pay)\b/i)
    : section(rows, 'Deductions', ['Net Pay', 'Company Contributions']);
  const contributionRows = hasLayout
    ? tableSection(rows, 'Company Contributions', 100, 250, 0, 295)
    : hasPairedTableHeadings
      ? pairedRows(ytdHeading + 1, fringeHeading, /^(?:sdl|uif|provident fund|mediclub|total company contributions)\b/i)
    : section(rows, 'Company Contributions', ['Year To Date Totals']);
  const ytdRows = hasLayout
    ? tableSection(rows, 'Year To Date Totals', 350, 450, 295, Number.POSITIVE_INFINITY)
    : hasPairedTableHeadings
      ? pairedRows(ytdHeading + 1, fringeHeading, /^(?:tax paid|taxable earnings|taxable company contributions|fringe benefits|tax deductible deductions|provisions|private contributions)\b/i)
    : section(rows, 'Year To Date Totals', ['Fringe Benefits']);
  const fringeRows = hasLayout
    ? tableSection(rows, 'Fringe Benefits', 100, 250, 0, 295)
    : hasPairedTableHeadings
      ? pairedRows(additionalsHeading + 1, -1, /^(?:retirement fund|total fringe benefits)\b/i)
    : fringeHeading < 0
      ? []
      : rows.slice(fringeHeading + 1, additionalsHeading < 0 ? rows.length : additionalsHeading);
  const packageRows = hasLayout
    ? tableSection(rows, 'Additionals', 350, 450, 295, Number.POSITIVE_INFINITY)
    : hasPairedTableHeadings
      ? pairedRows(additionalsHeading + 1, -1, /^(?:annual package|monthly package|aggregate|total additionals)\b/i)
    : section(rows, 'Additionals', []);

  const cashLine = matchingLine(earningRows, ['Cash Component']);
  const overtimeLine = matchingLine(earningRows, ['Overtime 1.5', 'Overtime 1,5']);
  const otherEarnings = earningRows
    .filter((row) => !/^(?:cash component|overtime 1[.,]5|description|units|amount|total earnings)\b/i.test(row.text))
    .map((row) => itemLine(row.text, row.text.split(/\s{2,}/)[0] || 'Other earnings', true))
    .filter((item) => item.amount !== null);
  const earningsSum = [cashLine ? itemLine(cashLine, 'Cash component').amount : null, overtimeLine ? itemLine(overtimeLine, 'Overtime 1.5', true).amount : null, ...otherEarnings.map((item) => item.amount)]
    .filter((value): value is number => value !== null)
    .reduce((sum, value) => Math.round((sum + value) * 100) / 100, 0);
  const printedEarningsTotal = rowAmount(earningRows, ['Total Earnings']);
  const earningsTotal = printedEarningsTotal ?? (earningsSum > 0 ? earningsSum : null);

  const uifDeduction = rowAmount(deductionRows, ['UIF']);
  const groupLife = rowAmount(deductionRows, ['Group Life']);
  const otherDeductions = deductionRows
    .filter((row) => !/^(?:description|amount|uif|group life|total deductions|net pay)\b/i.test(row.text))
    .map((row) => itemLine(row.text, row.text.split(/\s{2,}/)[0] || 'Other deduction'))
    .filter((item) => item.amount !== null);
  const deductionSum = [uifDeduction, groupLife, ...otherDeductions.map((item) => item.amount)]
    .filter((value): value is number => value !== null)
    .reduce((sum, value) => Math.round((sum + value) * 100) / 100, 0);
  const totalDeductions = rowAmount(deductionRows, ['Total Deductions']) ?? (deductionSum > 0 ? deductionSum : null);
  const printedNetPay = rowAmount(rows, ['Net Pay']);
  const netPay =
    printedNetPay ?? (earningsTotal !== null && totalDeductions !== null ? Math.round((earningsTotal - totalDeductions) * 100) / 100 : null);

  const contributions = {
    sdl: rowAmount(contributionRows, ['SDL']),
    uif: rowAmount(contributionRows, ['UIF']),
    providentFund: rowAmount(contributionRows, ['Provident Fund']),
    mediclub: rowAmount(contributionRows, ['Mediclub']),
    other: contributionRows
      .filter((row) => !/^(?:description|units|amount|sdl|uif|provident fund|mediclub|total company contributions)\b/i.test(row.text))
      .map((row) => itemLine(row.text, row.text.split(/\s{2,}/)[0] || 'Other contribution', true))
      .filter((item) => item.amount !== null),
    total: rowAmount(contributionRows, ['Total Company Contributions']),
  };
  const ytd = {
    taxPaid: rowAmount(ytdRows, ['Tax Paid']),
    taxableEarnings: rowAmount(ytdRows, ['Taxable Earnings']),
    taxableCompanyContributions: rowAmount(ytdRows, ['Taxable Company Contributions']),
    fringeBenefits: rowAmount(ytdRows, ['Fringe Benefits']),
    taxDeductibleDeductions: rowAmount(ytdRows, ['Tax Deductible Deductions']),
    provisions: rowAmount(ytdRows, ['Provisions']),
    privateContributions: rowAmount(ytdRows, ['Private Contributions']),
  };
  const retirementFund = rowAmount(fringeRows, ['Retirement Fund']);
  const annualPackage = rowAmount(packageRows, ['Annual Package']);
  const monthlyPackage = rowAmount(packageRows, ['Monthly Package']);
  const aggregate = rowAmount(packageRows, ['Aggregate']);
  const payPeriod = parseIsoDate(metadataValue(rows, /^pay\s+period\b/i));
  const dateEngaged = parseIsoDate(metadataValue(rows, /^date\s+engaged\b/i));
  const payeReference = metadataValue(rows, /^paye\s+ref(?:\.?\s*no\.?)?/i);
  const employeeCode = metadataValue(rows, /^(?:emp(?:loyee)?\.?\s*)?code\b/i);
  const employeeName = metadataValue(rows, /^(?:emp(?:loyee)?\.?\s*)?name\b/i);
  const idNumber = metadataValue(rows, /^id\s+number\b/i);
  const employeeAddress = metadataValue(rows, /^(?:emp(?:loyee)?\.?\s*)?address\b/i, 4);
  const jobTitle = metadataValue(rows, /^job\s+title\b/i, 2);
  const jobGrade = metadataValue(rows, /^job\s+grade\b/i);
  const companyName = metadataValue(rows, /^(?:co(?:mpany)?\.?\s*)?name\b/i);
  const companyAddress = metadataValue(rows, /^(?:co(?:mpany)?\.?\s*)?address\b/i, 4);
  const uifRegistrationNumber = metadataValue(rows, /^uif\s+(?:reg|registration)(?:\.?\s*no\.?)?/i);

  const warnings = [
    ...distinctWarnings([employeeName, companyName, payPeriod]),
    ...(printedEarningsTotal === null && earningsTotal !== null ? ['Total earnings were calculated from the extracted earning lines.'] : []),
    ...(printedNetPay === null && netPay !== null ? ['Net pay was calculated from extracted earnings and deductions.'] : []),
    ...(printedNetPay !== null && earningsTotal !== null && totalDeductions !== null && Math.abs(earningsTotal - totalDeductions - printedNetPay) > 0.02
      ? ['Printed net pay does not match earnings less deductions. Review the extracted totals.']
      : []),
  ];

  return {
    currency: 'ZAR',
    employee: {
      code: employeeCode,
      name: employeeName,
      idNumber,
      address: employeeAddress,
      jobTitle,
      jobGrade,
      dateEngaged,
      payPeriod,
    },
    employer: {
      name: companyName,
      address: companyAddress,
      payeReference,
      uifRegistrationNumber,
    },
    periodStart: payPeriod ? `${payPeriod.slice(0, 7)}-01` : null,
    periodEnd: payPeriod,
    earnings: {
      cashComponent: cashLine ? itemLine(cashLine, 'Cash component').amount : null,
      overtime15: overtimeLine ? itemLine(overtimeLine, 'Overtime 1.5', true) : null,
      other: otherEarnings,
      total: earningsTotal,
    },
    deductions: { uif: uifDeduction, groupLife, other: otherDeductions, total: totalDeductions, netPay },
    companyContributions: contributions,
    fringeBenefits: {
      retirementFund,
      other: fringeRows
        .filter((row) => !/^(?:description|amount|retirement fund|total fringe benefits)\b/i.test(row.text))
        .map((row) => itemLine(row.text, row.text.split(/\s{2,}/)[0] || 'Other fringe benefit'))
        .filter((item) => item.amount !== null),
      total: rowAmount(fringeRows, ['Total Fringe Benefits']),
    },
    ytdTotals: ytd,
    packageTotals: {
      annualPackage,
      monthlyPackage,
      aggregate,
      totalAdditionals: rowAmount(packageRows, ['Total Additionals']),
    },
    warnings: [...new Set(warnings)],
  };
}

export function parsePayslipText(text: string): PayslipDocument {
  const hasPairedTableHeadings = text
    .split(/\r\n?|\n/)
    .some((line) => /Earnings\s+Deductions|Company Contributions\s+Year To Date Totals|Fringe Benefits\s+Additionals/i.test(line));
  return buildDocument(makeRows(text), hasPairedTableHeadings);
}

export function parsePayslipItems(items: readonly PayslipTextItem[]): PayslipDocument {
  return buildDocument(makeRowsFromItems(items));
}

function percent(amount: number | null, base: number | null): number | null {
  if (amount === null || base === null || base <= 0) return null;
  return Math.round((amount / base) * 10_000) / 100;
}

export function summarizePayslip(document: PayslipDocument): PayslipBudgetSummary {
  const gross = document.earnings.total;
  return {
    currency: document.currency,
    employer: document.employer.name,
    payPeriod: document.employee.payPeriod,
    disposableNetIncome: document.deductions.netPay,
    grossEarnings: gross,
    grossPackage: document.packageTotals.monthlyPackage ?? gross,
    disposableIncomePercentOfGrossPackage: percent(document.deductions.netPay, document.packageTotals.monthlyPackage ?? gross),
    fixedDeductions: {
      uif: { amount: document.deductions.uif, percentOfGrossEarnings: percent(document.deductions.uif, gross) },
      groupLife: { amount: document.deductions.groupLife, percentOfGrossEarnings: percent(document.deductions.groupLife, gross) },
    },
  };
}
