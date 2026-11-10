import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseBankStatementText,
  parseBankStatementItems,
  parseStatementAmount,
  recurringBillsFromStatement,
  toAppTransactions,
} from '../src/lib/bankStatement.ts';

const statement = `FNB Aspire Current Account
Account Number: 1234567890
Statement Period: 29 Dec 2024 to 02 Jan 2025
Opening Balance 1,000.00Cr
Date Description Deposits Withdrawals Balance
29 Dec Stansal 412Psalary 10,000.00 11,000.00Cr
30 Dec DebiCheck Unifi Ref: 123456 1,000.00 10,000.00Cr
30 Dec Debit Card POS Kwikspar Burt Drive Terminal ID: 123456 300.00 9,700.00Cr
30 Dec Debit Card POS Kwikspar Burt Drive Terminal ID: 123456 300.00 9,400.00Cr
31 Dec #Service Fees 50.00 9,350.00Cr
\fPage 2 of 2
Date Description Deposits Withdrawals Balance
01 Jan Card Cashback Kwikspar 100.00 9,250.00Cr
01 Jan ATM Cash Withdrawal 200.00 9,050.00Cr
02 Jan Fee Declined Purch Tran 5.00 9,045.00Cr
02 Jan New Uber Eats 100.00 8,945.00Cr
Closing Balance 8,945.00Cr`;

test('parses FNB statement metadata, Dr/Cr balances, and December-to-January dates', () => {
  const document = parseBankStatementText(statement, 2);

  assert.equal(document.bank, 'FNB');
  assert.equal(document.accountType, 'Aspire Current Account');
  assert.equal(document.accountNumber, '1234567890');
  assert.deepEqual(document.period, { start: '2024-12-29', end: '2025-01-02' });
  assert.equal(document.openingBalance?.signedAmount, 1000);
  assert.equal(document.closingBalance?.signedAmount, 8945);
  assert.equal(document.pages, 2);
  assert.deepEqual(document.transactions.map((transaction) => transaction.date), [
    '2024-12-29',
    '2024-12-30',
    '2024-12-30',
    '2024-12-30',
    '2024-12-31',
    '2025-01-01',
    '2025-01-01',
    '2025-01-02',
    '2025-01-02',
  ]);
  assert.ok(document.transactions.every((transaction) => transaction.balanceCheck === 'matched'));
  assert.equal(document.analysis.balanceReconciliation, 'matched');
});

test('normalizes descriptions and categorizes salary, debt, groceries, Uber Eats, cash, and fees', () => {
  const transactions = parseBankStatementText(statement).transactions;

  assert.equal(transactions[0].category, 'income');
  assert.equal(transactions[1].category, 'debt');
  assert.equal(transactions[1].merchant, 'Unifi');
  assert.equal(transactions[2].category, 'groceries');
  assert.equal(transactions[2].description.includes('Terminal ID'), false);
  assert.equal(transactions[4].category, 'fees');
  assert.equal(transactions[4].description, 'Service Fees');
  assert.equal(transactions[5].category, 'cash');
  assert.equal(transactions[6].category, 'cash');
  assert.equal(transactions[7].category, 'fees');
  assert.equal(transactions[8].category, 'dining');
});

test('analyzes cash flow, debt and fees, duplicate charges, and declined-purchase fees', () => {
  const document = parseBankStatementText(statement);
  const { analysis } = document;

  assert.equal(analysis.recognizedIncome, 10000);
  assert.equal(analysis.debtPayments, 1000);
  assert.equal(analysis.bankFees, 55);
  assert.equal(analysis.debtBurdenPercent, 10);
  assert.equal(analysis.feeBurdenPercent, 0.55);
  assert.equal(analysis.cash.atmWithdrawals, 200);
  assert.equal(analysis.cash.cashBack, 100);
  assert.equal(analysis.cash.digitalCardSpend, 600);
  assert.deepEqual(analysis.payCycles, [{
    start: '2024-12-29',
    end: '2025-01-02',
    days: 5,
    income: 10000,
    outflow: 2055,
    outflowPerDay: 411,
    postPaydayOutflow: 2055,
    prePaydayOutflow: 2055,
    netCashFlow: 7945,
    endingBalance: 8945,
  }]);
  assert.ok(analysis.anomalies.some((anomaly) => anomaly.kind === 'duplicate_charge'));
  assert.ok(analysis.anomalies.some((anomaly) => anomaly.kind === 'failed_transaction_fee'));
  assert.equal(analysis.totalCredits, 10000);
  assert.equal(analysis.totalDebits, 2055);
  assert.equal(analysis.netCashFlow, 7945);
});

test('infers credit direction from running balances and reports balance anomalies', () => {
  const document = parseBankStatementText(`FNB
Statement Period 01 Mar 2025 to 02 Mar 2025
Opening Balance 100.00Dr
01 Mar Reversal POS 25.00 75.00Dr
02 Mar ATM Withdrawal 10.00 60.00Dr
Closing Balance 60.00Dr`);

  assert.equal(document.transactions[0].flow, 'credit');
  assert.equal(document.transactions[0].runningBalance?.signedAmount, -75);
  assert.equal(document.transactions[0].balanceCheck, 'matched');
  assert.equal(document.transactions[1].balanceCheck, 'mismatch');
  assert.ok(document.analysis.anomalies.some((anomaly) => anomaly.kind === 'balance_mismatch'));
  assert.equal(document.analysis.balanceReconciliation, 'mismatch');
});

test('parses South African decimal formats, Dr indicators, and dashboard transactions', () => {
  assert.equal(parseStatementAmount('R 1 234,50'), 1234.5);
  assert.equal(parseStatementAmount('1.234,50'), 1234.5);
  assert.equal(parseStatementAmount('(250.00)'), -250);
  assert.equal(parseBankStatementText('FNB\n01 Mar 2025 Kwikspar 1.234,50').transactions[0].amount, 1234.5);

  const document = parseBankStatementText(statement);
  const transactions = toAppTransactions(document, 'doc-1');
  assert.equal(transactions[0].kind, 'income');
  assert.equal(transactions[0].category, 'income');
  assert.equal(transactions[1].kind, 'expense');
  assert.equal(transactions[1].category, 'bills');
  assert.equal(transactions[1].sourceDocId, 'doc-1');
});

test('detects a repeated monthly debit order as a recurring obligation', () => {
  const document = parseBankStatementText(`FNB Aspire Current Account
Statement Period: 25 Dec 2024 to 31 Jan 2025
Opening Balance 1,000.00Cr
25 Dec Stansal Salary 5,000.00 6,000.00Cr
31 Dec DebiCheck Finchoice 500.00 5,500.00Cr
25 Jan Stansal Salary 5,000.00 10,500.00Cr
31 Jan DebiCheck Finchoice 500.00 10,000.00Cr
Closing Balance 10,000.00Cr`);

  const bills = recurringBillsFromStatement(document);
  assert.equal(document.analysis.debtBurdenPercent, 10);
  assert.equal(bills.length, 1);
  assert.equal(bills[0].name, 'Finchoice');
  assert.equal(bills[0].cadence, 'monthly');
  assert.equal(bills[0].amount, 500);
});

test('flags large spending outliers and failed debit-order attempts', () => {
  const document = parseBankStatementText(`FNB
01 Mar 2025 Kwikspar Groceries 50.00
02 Mar 2025 Kwikspar Groceries 45.00
03 Mar 2025 Kwikspar Groceries 60.00
04 Mar 2025 Kwikspar Groceries 55.00
05 Mar 2025 Kwikspar Groceries 800.00
06 Mar 2025 DebiCheck Unifi Failed 500.00`);

  assert.ok(document.analysis.anomalies.some((anomaly) => anomaly.kind === 'unusual_spike' && anomaly.amount === 800));
  assert.ok(document.analysis.anomalies.some((anomaly) => anomaly.kind === 'debit_order_attempt'));
});

test('counts app transfers and peer-to-peer credits as income without treating them as salary dates', () => {
  const document = parseBankStatementText(`FNB
01 Mar 2025 FNB App Transfer 100.00Cr
03 Mar 2025 Instant Payment Received P2P 200.00Cr`);

  assert.deepEqual(document.transactions.map((transaction) => transaction.category), ['income', 'income']);
  assert.deepEqual(document.transactions.map((transaction) => transaction.incomeSource), ['other', 'other']);
  assert.equal(document.analysis.recognizedIncome, 300);
  assert.deepEqual(document.analysis.payCycles, []);
});

test('separates subscriptions and airtime from prepaid electricity', () => {
  const document = parseBankStatementText(`FNB
01 Mar 2025 Spotify Subscription 99.00
02 Mar 2025 Prepaid Airtime 50.00
03 Mar 2025 Prepaid Electricity 300.00
04 Mar 2025 Pay Just Now 250.00
05 Mar 2025 Vodacom Bundles 50.00
06 Mar 2025 RTC Express Pmt To Family 100.00`);

  assert.deepEqual(document.transactions.map((transaction) => transaction.category), [
    'entertainment',
    'entertainment',
    'utilities',
    'debt',
    'entertainment',
    'transfer',
  ]);
  assert.ok(document.transactions.every((transaction) => transaction.flow === 'debit'));
});

test('handles statements with separate debit and credit columns and zero placeholders', () => {
  const document = parseBankStatementText(`FNB
Statement Period 01 Mar 2025 to 02 Mar 2025
Opening Balance 1,000.00Cr
Date Description Deposits Withdrawals Balance
01 Mar Stansal salary 0.00 10,000.00 11,000.00Cr
02 Mar Kwikspar 300.00 0.00 10,700.00Cr
Closing Balance 10,700.00Cr`);

  assert.deepEqual(document.transactions.map(({ amount, flow }) => ({ amount, flow })), [
    { amount: 10000, flow: 'credit' },
    { amount: 300, flow: 'debit' },
  ]);
  assert.ok(document.transactions.every((transaction) => transaction.balanceCheck === 'matched'));
});

test('parses positioned FNB columns, infers omitted Dr balances, and excludes unposted debit attempts', () => {
  const item = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y], page: 1 });
  const items = [
    item('FNB Aspire Current Account', 12, 800),
    item('Statement Period 09 Oct 2025 to 12 Oct 2025', 12, 780),
    item('Opening Balance 115.20Dr', 12, 760),
    item('09 Oct Monthly Account Fee', 12, 740),
    item('20.00', 453, 740),
    item('135.20', 516, 740),
    item('10 Oct Payshap Credit', 12, 730),
    item('1,000.00', 447, 730),
    item('Cr', 473, 730),
    item('864.80', 516, 730),
    item('Cr', 537, 730),
    item('11 Oct Edo Collection Attempt Unifi', 12, 720),
    item('100.00', 453, 720),
    item('Cr', 473, 720),
    item('864.80', 516, 720),
    item('Cr', 537, 720),
    item('12 Oct FNB App Transfer To Payments', 12, 710),
    item('20.00', 453, 710),
    item('Cr', 473, 710),
    item('844.80', 516, 710),
    item('Cr', 537, 710),
    item('Closing Balance 844.80Cr', 12, 690),
  ];

  const document = parseBankStatementItems(items, 1);
  const [fee, credit, attempt, transfer] = document.transactions;

  assert.deepEqual(document.transactions.map((transaction) => transaction.description), [
    'Monthly Account Fee',
    'Payshap Credit',
    'Edo Collection Attempt Unifi',
    'FNB App Transfer To Payments',
  ]);
  assert.equal(fee.runningBalance?.signedAmount, -135.2);
  assert.equal(fee.balanceCheck, 'matched');
  assert.equal(credit.flow, 'credit');
  assert.equal(attempt.flow, 'debit');
  assert.equal(attempt.posted, false);
  assert.ok(attempt.issues.includes('debit_order_attempt'));
  assert.equal(transfer.flow, 'debit');
  assert.equal(transfer.posted, true);
  assert.equal(document.analysis.totalCredits, 1000);
  assert.equal(document.analysis.totalDebits, 40);
  assert.equal(document.analysis.balanceReconciliation, 'matched');
  assert.equal(toAppTransactions(document, 'doc-positioned').length, 3);
  assert.ok(document.analysis.anomalies.some((anomaly) => anomaly.kind === 'debit_order_attempt'));
});
