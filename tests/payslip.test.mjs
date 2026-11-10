import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePayslipItems, parsePayslipText, parseSouthAfricanAmount, summarizePayslip } from '../src/lib/payslip.ts';

const sampleText = `Employee Code: TEST-001
Employee Name: Alex Example
ID Number: 0000000000000
Employee Address: 1 Example Road, Cape Town, 8000
Job Title: Software Developer
Job Grade: C2
Date Engaged: 2024/11/01
Pay Period: 2025/08/31
Company Name: Example Holdings (Pty) Ltd
Company Address: 10 Main Road, Cape Town, 8001
PAYE Ref. No.: 7530759580
UIF Reg. No.: 1621730/2
Earnings
CASH COMPONENT 0,00 6 321,82
OVERTIME 1.5 4,00 250,02
Total Earnings 6 571,84
Deductions
UIF 74,74
GROUP LIFE 131,49
Total Deductions 206,23
Net Pay 6 365,61
Company Contributions
SDL 0,00 68,42
UIF 0,00 74,74
PROVIDENT FUND 0,00 632,18
MEDICLUB 0,00 270,00
Total Company Contributions 1 045,34
Year To Date Totals
Tax Paid 0,00
Taxable Earnings 40 397,59
Taxable Company Contributions 1 620,00
Fringe Benefits 3 609,80
Tax Deductible Deductions 3 609,80
Provisions 0,00
Private Contributions 0,00
Fringe Benefits
RETIREMENT FUND 632,18
Total Fringe Benefits 632,18
Additionals
Annual Package 86 688,00
Monthly Package 7 224,00
Aggregate 6 321,82
Total Additionals 100 233,82`;

test('parses South African currency amounts and separators', () => {
  assert.equal(parseSouthAfricanAmount('6 321,82'), 6321.82);
  assert.equal(parseSouthAfricanAmount('R 40 397,59'), 40397.59);
  assert.equal(parseSouthAfricanAmount('6,321.82'), 6321.82);
  assert.equal(parseSouthAfricanAmount('(1 234,50)'), -1234.5);
  assert.equal(parseSouthAfricanAmount('not an amount'), null);
});

test('maps payslip sections into immutable DTO values and a budget summary', () => {
  const document = parsePayslipText(sampleText);

  assert.equal(document.employee.code, 'TEST-001');
  assert.equal(document.employee.name, 'Alex Example');
  assert.equal(document.employee.dateEngaged, '2024-11-01');
  assert.equal(document.employee.payPeriod, '2025-08-31');
  assert.equal(document.employer.name, 'Example Holdings (Pty) Ltd');
  assert.equal(document.employer.payeReference, '7530759580');

  assert.equal(document.earnings.cashComponent, 6321.82);
  assert.deepEqual(document.earnings.overtime15, { label: 'Overtime 1.5', units: 4, amount: 250.02 });
  assert.equal(document.earnings.total, 6571.84);
  assert.equal(document.deductions.uif, 74.74);
  assert.equal(document.deductions.groupLife, 131.49);
  assert.equal(document.deductions.total, 206.23);
  assert.equal(document.deductions.netPay, 6365.61);

  assert.equal(document.companyContributions.sdl, 68.42);
  assert.equal(document.companyContributions.providentFund, 632.18);
  assert.equal(document.companyContributions.mediclub, 270);
  assert.equal(document.ytdTotals.taxableEarnings, 40397.59);
  assert.equal(document.ytdTotals.taxableCompanyContributions, 1620);
  assert.equal(document.fringeBenefits.retirementFund, 632.18);
  assert.equal(document.packageTotals.annualPackage, 86688);
  assert.equal(document.packageTotals.monthlyPackage, 7224);
  assert.equal(document.packageTotals.totalAdditionals, 100233.82);

  assert.deepEqual(summarizePayslip(document), {
    currency: 'ZAR',
    employer: 'Example Holdings (Pty) Ltd',
    payPeriod: '2025-08-31',
    disposableNetIncome: 6365.61,
    grossEarnings: 6571.84,
    grossPackage: 7224,
    disposableIncomePercentOfGrossPackage: 88.12,
    fixedDeductions: {
      uif: { amount: 74.74, percentOfGrossEarnings: 1.14 },
      groupLife: { amount: 131.49, percentOfGrossEarnings: 2 },
    },
  });
});

test('keeps missing values null and derives totals only when inputs exist', () => {
  const document = parsePayslipText(`Earnings
CASH COMPONENT 0,00 6 321,82
OVERTIME 1.5 4,00 250,02
Deductions
UIF 74,74
GROUP LIFE 131,49`);

  assert.equal(document.earnings.total, 6571.84);
  assert.equal(document.deductions.total, 206.23);
  assert.equal(document.deductions.netPay, 6365.61);
  assert.ok(document.warnings.includes('Total earnings were calculated from the extracted earning lines.'));
  assert.ok(document.warnings.includes('Net pay was calculated from extracted earnings and deductions.'));
  assert.equal(parsePayslipText('Earnings').deductions.netPay, null);
});

test('parses merged native-extraction table rows', () => {
  const document = parsePayslipText(`Employee Code: TEST-001 Employee Name: Alex Example
Company Name: Example Holdings (Pty) Ltd Pay Period: 2025/08/31
Earnings Deductions
CASH COMPONENT 0,00 6 321,82 UIF 74,74
OVERTIME 1.5 4,00 250,02 GROUP LIFE 131,49
Total Earnings 6 571,84 Total Deductions 206,23
Net Pay 6 365,61
Company Contributions Year To Date Totals
SDL 0,00 68,42 Tax Paid 0,00
UIF 0,00 74,74 Taxable Earnings 40 397,59
PROVIDENT FUND 0,00 632,18 Taxable Company Contributions 1 620,00
MEDICLUB 0,00 270,00
Total Company Contributions 1 045,34
Fringe Benefits Additionals
RETIREMENT FUND 632,18 Annual Package 86 688,00
Total Fringe Benefits 632,18 Monthly Package 7 224,00
Aggregate 6 321,82
Total Additionals 100 233,82`);

  assert.equal(document.earnings.cashComponent, 6321.82);
  assert.equal(document.earnings.overtime15?.amount, 250.02);
  assert.equal(document.deductions.uif, 74.74);
  assert.equal(document.deductions.groupLife, 131.49);
  assert.equal(document.deductions.netPay, 6365.61);
  assert.equal(document.companyContributions.mediclub, 270);
  assert.equal(document.ytdTotals.taxableEarnings, 40397.59);
  assert.equal(document.packageTotals.annualPackage, 86688);
  assert.equal(document.employee.code, 'TEST-001');
  assert.equal(document.employee.name, 'Alex Example');
  assert.equal(document.employer.name, 'Example Holdings (Pty) Ltd');
  assert.equal(document.employee.payPeriod, '2025-08-31');
});

test('parses side-by-side PDF table columns and wrapped metadata', () => {
  const items = [
    { str: 'Emp. Name', transform: [1, 0, 0, 1, 48, 770] },
    { str: 'Alex Example', transform: [1, 0, 0, 1, 109, 770] },
    { str: 'Job Title', transform: [1, 0, 0, 1, 217, 770] },
    { str: 'Software', transform: [1, 0, 0, 1, 311, 770] },
    { str: 'Developer', transform: [1, 0, 0, 1, 311, 762] },
    { str: 'Emp. Address', transform: [1, 0, 0, 1, 48, 730] },
    { str: '1 Example Road', transform: [1, 0, 0, 1, 109, 720] },
    { str: 'Cape Town', transform: [1, 0, 0, 1, 109, 710] },
    { str: 'Earnings', transform: [1, 0, 0, 1, 153, 500] },
    { str: 'Deductions', transform: [1, 0, 0, 1, 401, 500] },
    { str: 'CASH COMPONENT', transform: [1, 0, 0, 1, 48, 470] },
    { str: '6 321,82', transform: [1, 0, 0, 1, 210, 470] },
    { str: 'UIF', transform: [1, 0, 0, 1, 300, 470] },
    { str: '74,74', transform: [1, 0, 0, 1, 470, 470] },
    { str: 'Total Earnings', transform: [1, 0, 0, 1, 48, 440] },
    { str: '6 321,82', transform: [1, 0, 0, 1, 210, 440] },
    { str: 'Total Deductions', transform: [1, 0, 0, 1, 300, 440] },
    { str: '74,74', transform: [1, 0, 0, 1, 470, 440] },
    { str: 'Net Pay', transform: [1, 0, 0, 1, 300, 420] },
    { str: '6 247,08', transform: [1, 0, 0, 1, 470, 420] },
    { str: 'Company Contributions', transform: [1, 0, 0, 1, 128, 400] },
    { str: 'Year To Date Totals', transform: [1, 0, 0, 1, 388, 400] },
    { str: 'SDL 0,00 68,42', transform: [1, 0, 0, 1, 48, 380] },
    { str: 'Tax Paid 0,00', transform: [1, 0, 0, 1, 300, 380] },
    { str: 'Total Company Contributions 68,42', transform: [1, 0, 0, 1, 48, 350] },
    { str: 'Private Contributions 0,00', transform: [1, 0, 0, 1, 300, 350] },
    { str: 'Fringe Benefits', transform: [1, 0, 0, 1, 143, 320] },
    { str: 'Additionals', transform: [1, 0, 0, 1, 401, 320] },
    { str: 'RETIREMENT FUND 632,18', transform: [1, 0, 0, 1, 48, 290] },
    { str: 'Annual Package 86 688,00', transform: [1, 0, 0, 1, 300, 290] },
    { str: 'Total Fringe Benefits 632,18', transform: [1, 0, 0, 1, 48, 270] },
    { str: 'Total Additionals 86 688,00', transform: [1, 0, 0, 1, 300, 270] },
  ];
  const document = parsePayslipItems(items);

  assert.equal(document.employee.jobTitle, 'Software Developer');
  assert.equal(document.employee.address, '1 Example Road Cape Town');
  assert.equal(document.earnings.total, 6321.82);
  assert.equal(document.deductions.uif, 74.74);
  assert.equal(document.deductions.netPay, 6247.08);
  assert.equal(document.ytdTotals.taxPaid, 0);
  assert.equal(document.packageTotals.annualPackage, 86688);
});
