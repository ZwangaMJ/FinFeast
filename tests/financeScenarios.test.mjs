import assert from 'node:assert/strict';
import test from 'node:test';

import { financeScenarioData, parseFinanceScenario } from '../src/lib/financeScenarios.ts';

const emptyData = {
  profile: { name: 'Demo user' },
  income: null,
  weeklyFoodBudget: 700,
  bills: [],
  transactions: [],
  documents: [],
  plan: null,
  pantry: [],
  goals: [],
  weekHistory: [],
};

test('keeps the normal data source intact and rejects unknown scenario values', () => {
  assert.equal(financeScenarioData(emptyData, 'demo'), emptyData);
  assert.equal(parseFinanceScenario('not-a-scenario'), 'demo');
  assert.equal(parseFinanceScenario(['worst']), 'demo');
});

test('worst-case scenario covers long names, zero values, negative projection and database-scale amounts', () => {
  const result = financeScenarioData(emptyData, 'worst');

  assert.equal(result.profile.name, 'Aleksandra Wiśniewska-Kowalczyk');
  assert.equal(result.transactions.length, 4);
  assert.equal(result.transactions[0].amount, 9_999_999_999.99);
  assert.equal(result.transactions[1].merchant, 'Jo');
  assert.equal(result.transactions[1].amount, 0);
  assert.equal(result.bills[0].amount, 9_999_999_999.99);
  assert.ok(result.documents[0].name.length > 80);
});

test('empty and one-item scenarios have exact list cardinality', () => {
  const empty = financeScenarioData(emptyData, 'empty');
  const one = financeScenarioData(emptyData, 'one');

  assert.equal(empty.transactions.length, 0);
  assert.equal(empty.bills.length, 0);
  assert.equal(empty.documents.length, 0);
  assert.equal(one.transactions.length, 1);
  assert.equal(one.transactions[0].merchant, 'J');
  assert.equal(one.transactions[0].amount, 0);
});

test('large scenario creates 1,000 unique rows for the paginated list', () => {
  const result = financeScenarioData(emptyData, 'large');
  const ids = new Set(result.transactions.map((transaction) => transaction.id));

  assert.equal(result.transactions.length, 1_000);
  assert.equal(ids.size, 1_000);
  assert.equal(result.transactions[0].amount, 9_999_999_999.99);
  assert.equal(result.transactions[1].amount, 0);
});
