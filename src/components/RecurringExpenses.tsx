/**
 * Add, edit and list recurring expenses (rent, transport, utilities, insurance,
 * subscriptions, debt). Used in onboarding's money basics and in Profile.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { AmountInput, Button, Card, Chip, Divider, EmptyState, Field, ListRow, Row, Segmented, Sheet, Stepper, ToggleRow, Txt, useCurrency } from '@/components/ui';
import { money } from '@/lib/format';
import {
  defaultEssential,
  FREQUENCIES,
  FREQUENCY_LABEL,
  FREQUENCY_SHORT,
  monthlyRecurringTotal,
  RECURRING_CATEGORIES,
  RECURRING_CATEGORY_ICON,
  RECURRING_CATEGORY_LABEL,
} from '@/lib/recurring';
import type { RecurringCategory, RecurringExpense, RecurringFrequency } from '@/store/types';
import { useStore } from '@/store/useStore';

export function ordinal(day: number) {
  const rem100 = day % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${day}th`;
  return `${day}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th'}`;
}

export function recurringSubtitle(e: RecurringExpense, fmt: (n: number) => string) {
  const when = e.frequency === 'monthly' ? `on the ${ordinal(e.billingDayOfMonth)}` : `from the ${ordinal(e.billingDayOfMonth)}`;
  return `${fmt(e.amount)}/${FREQUENCY_SHORT[e.frequency]} · ${when} · ${e.isEssential ? 'essential' : 'optional'}${e.active ? '' : ' · cancelled'}`;
}

/** Bottom sheet to add a recurring expense, or edit / delete an existing one. */
export function RecurringExpenseSheet({ visible, onClose, expense }: { visible: boolean; onClose: () => void; expense?: RecurringExpense | null }) {
  // Remount the form whenever the sheet opens for a different expense, so fields start fresh.
  return <RecurringExpenseForm key={`${visible}-${expense?.id ?? 'new'}`} visible={visible} onClose={onClose} expense={expense ?? null} />;
}

function RecurringExpenseForm({ visible, onClose, expense }: { visible: boolean; onClose: () => void; expense: RecurringExpense | null }) {
  const add = useStore((s) => s.addRecurringExpense);
  const update = useStore((s) => s.updateRecurringExpense);
  const remove = useStore((s) => s.removeRecurringExpense);
  const [name, setName] = useState(expense?.name ?? '');
  const [amount, setAmount] = useState(expense ? String(expense.amount) : '');
  const [category, setCategory] = useState<RecurringCategory>(expense?.category ?? 'housing');
  const [frequency, setFrequency] = useState<RecurringFrequency>(expense?.frequency ?? 'monthly');
  const [day, setDay] = useState(expense?.billingDayOfMonth ?? 1);
  const [essential, setEssential] = useState(expense?.isEssential ?? true);
  const [essentialTouched, setEssentialTouched] = useState(Boolean(expense));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const value = parseFloat(amount);
  const ok = name.trim().length > 0 && value > 0;

  const save = () => {
    if (!ok) return;
    const fields = { name: name.trim(), amount: value, category, frequency, billingDayOfMonth: day, isEssential: essential };
    if (expense) update(expense.id, fields);
    else add({ ...fields, source: 'manual' });
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={expense ? 'Edit recurring expense' : 'Add a recurring expense'}
      footer={
        <>
          <Button label={expense ? 'Save changes' : 'Add expense'} disabled={!ok} onPress={save} />
          {expense ? (
            confirmDelete ? (
              <Button
                label={`Delete ${expense.name}`}
                variant="destructive"
                onPress={() => {
                  remove(expense.id);
                  onClose();
                }}
              />
            ) : (
              <Button label="Delete" variant="ghost" tone="gray" onPress={() => setConfirmDelete(true)} />
            )
          ) : null}
        </>
      }>
      <Field label="What is it?" value={name} onChange={setName} placeholder="e.g. Rent, Gautrain, Netflix" />
      <AmountInput label={frequency === 'monthly' ? 'Amount each month' : frequency === 'weekly' ? 'Amount each week' : 'Amount every two weeks'} value={amount} onChange={setAmount} />
      <Txt v="smallStrong" muted>
        Category
      </Txt>
      <Row gap={8} wrap>
        {RECURRING_CATEGORIES.map((cat) => (
          <Chip
            key={cat}
            small
            label={RECURRING_CATEGORY_LABEL[cat]}
            icon={RECURRING_CATEGORY_ICON[cat]}
            selected={category === cat}
            onPress={() => {
              setCategory(cat);
              if (!essentialTouched) setEssential(defaultEssential(cat));
            }}
          />
        ))}
      </Row>
      <Txt v="smallStrong" muted>
        How often
      </Txt>
      <Segmented<RecurringFrequency> value={frequency} onChange={setFrequency} options={FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_LABEL[f] }))} />
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Txt v="bodyStrong">{frequency === 'monthly' ? 'Day it goes off' : 'First debit day in a month'}</Txt>
          <Txt v="caption" muted>
            {frequency === 'monthly' ? 'Use the last day for 31 in shorter months' : 'Repeats from this day'}
          </Txt>
        </View>
        <Stepper value={day} min={1} max={31} onChange={setDay} format={ordinal} />
      </Row>
      <ToggleRow
        title="Essential"
        subtitle={essential ? 'A fixed cost your safety net should cover' : 'Optional — counts in your budget, not your safety net'}
        value={essential}
        onChange={(v) => {
          setEssential(v);
          setEssentialTouched(true);
        }}
      />
    </Sheet>
  );
}

/** Saved recurring expenses with add / edit, plus the monthly total. */
export function RecurringExpenseList({ emptyHint }: { emptyHint?: string }) {
  const currency = useCurrency();
  const fmt = (n: number) => money(n, currency);
  const expenses = useStore((s) => s.recurringExpenses);
  const [editing, setEditing] = useState<RecurringExpense | null>(null);
  const [adding, setAdding] = useState(false);
  const total = monthlyRecurringTotal(expenses);
  return (
    <View style={{ gap: 10 }}>
      <Card padded={false} style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
        {expenses.length === 0 ? (
          <EmptyState icon="calendar-outline" title="No recurring expenses yet" body={emptyHint ?? 'Add rent, transport, utilities, insurance, subscriptions or debt repayments.'} />
        ) : null}
        {expenses.map((e, i) => (
          <View key={e.id}>
            <ListRow
              icon={RECURRING_CATEGORY_ICON[e.category]}
              iconTone={e.isEssential ? 'amber' : 'blue'}
              title={e.name}
              subtitle={recurringSubtitle(e, fmt)}
              chevron
              onPress={() => setEditing(e)}
            />
            {i < expenses.length - 1 ? <Divider style={{ marginVertical: 0 }} /> : null}
          </View>
        ))}
      </Card>
      {expenses.length ? (
        <Txt v="caption" muted>
          About {fmt(Math.round(total))} a month in total. Weekly and two-weekly amounts are converted to a monthly figure.
        </Txt>
      ) : null}
      <Button label="Add a recurring expense" icon="add" variant="secondary" small style={{ alignSelf: 'flex-start' }} onPress={() => setAdding(true)} />
      <RecurringExpenseSheet visible={adding} onClose={() => setAdding(false)} />
      <RecurringExpenseSheet visible={!!editing} onClose={() => setEditing(null)} expense={editing} />
    </View>
  );
}
