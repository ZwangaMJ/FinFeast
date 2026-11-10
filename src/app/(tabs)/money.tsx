import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { ForecastChart, HeatStrip, SpendBars } from '@/components/charts';
import { AmountInput, Button, Card, Chip, Divider, EmptyState, Field, Icon, IconButton, ListRow, Pill, ProgressBar, Row, Screen, Section, Segmented, Sheet, Txt, useCurrency } from '@/components/ui';
import { useInsights } from '@/hooks/useInsights';
import {
  CATEGORY_ICON,
  CATEGORY_LABEL,
  categoryAverages,
  FOOD,
  forecastMonth,
  lastNWeeks,
  planCoverage,
  riskyDays,
  spend,
  VARIABLE_CATEGORIES,
} from '@/lib/budget';
import { addDays, DAY_LONG, monthName, monthStart, shortDate, today } from '@/lib/dates';
import { money, PRICE_FACTOR } from '@/lib/format';
import { planCost } from '@/lib/mealPlanner';
import type { Category, Transaction } from '@/store/types';
import { useStore, type AppData } from '@/store/useStore';
import { useTheme } from '@/theme';

type Tab = 'overview' | 'transactions' | 'documents';

export default function Money() {
  const [tab, setTab] = useState<Tab>('overview');
  const store = useStore();
  return (
    <Screen title="Money" subtitle={monthName()} right={<IconButton icon="add" label="Add a document" tone="green" onPress={() => router.push('/upload')} />}>
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'overview', label: 'Plan' },
          { value: 'transactions', label: 'Transactions' },
          { value: 'documents', label: 'Documents' },
        ]}
      />
      <View style={{ height: 16 }} />
      {tab === 'overview' ? <Overview data={store} /> : tab === 'transactions' ? <Transactions data={store} /> : <Documents data={store} />}
    </Screen>
  );
}

function Overview({ data: s }: { data: AppData }) {
  const { c, tone } = useTheme();
  const currency = useCurrency();
  const fmt = (n: number) => money(n, currency);
  const insights = useInsights();
  const f = useMemo(() => forecastMonth(s.income, s.bills, s.goals, s.transactions, s.weeklyFoodBudget), [s.income, s.bills, s.goals, s.transactions, s.weeklyFoodBudget]);
  const weeks = lastNWeeks(6).map((ws) => {
    const rec = s.weekHistory.find((w) => w.weekStart === ws);
    const isCurrent = s.plan?.weekStart === ws;
    const plan = rec?.estimate ?? (isCurrent && s.plan ? planCost(s.plan.days, s.profile.householdSize, s.pantry.map((p) => p.key), currency) * planCoverage(s.plan) : 0);
    return { label: shortDate(ws), actual: spend(s.transactions, ws, addDays(ws, 7), FOOD), plan };
  });
  const risky = riskyDays(s.transactions, 50 * PRICE_FACTOR[currency]);
  const worst = [...risky].sort((a, b) => b.avg - a.avg)[0];
  const avgs = categoryAverages(s.transactions);
  const ms = monthStart();
  const subs = s.bills.filter((b) => b.isSubscription);
  const fixed = s.bills.filter((b) => !b.isSubscription);

  if (!s.income && !s.bills.length && !s.transactions.length && s.weeklyFoodBudget <= 0) {
    return (
      <EmptyState
        icon="wallet-outline"
        title="Your financial summary is waiting for real data"
        body="Upload a text-based payslip or bank statement PDF, or enter your own budget. We won't fill this dashboard with sample figures."
        action={<Button label="Upload a document" small onPress={() => router.push('/upload')} />}
      />
    );
  }

  return (
    <View>
      <Card style={{ gap: 6 }}>
        <Txt v="label" color={tone('green').fg}>
          Projected end of month
        </Txt>
        <Txt v="hero" color={f.projectedEnd < 0 ? c.destructive : c.text}>
          {fmt(Math.round(f.projectedEnd / 10) * 10)}
        </Txt>
        <Txt muted>
          give or take {fmt(Math.round(f.band / 10) * 10)} · based on your bills and your own spending pattern
        </Txt>
        <ForecastChart points={f.points} bills={f.billMarkers} band={f.band} />
        <Row gap={14} wrap>
          <Row gap={6}>
            <View style={{ width: 14, height: 3, backgroundColor: c.primary }} />
            <Txt v="caption" muted>
              Actual
            </Txt>
          </Row>
          <Row gap={6}>
            <View style={{ width: 14, height: 0, borderTopWidth: 2, borderStyle: 'dashed', borderColor: c.primary }} />
            <Txt v="caption" muted>
              Forecast
            </Txt>
          </Row>
          <Row gap={6}>
            <View style={{ width: 2, height: 10, backgroundColor: c.amber }} />
            <Txt v="caption" muted>
              Bill day
            </Txt>
          </Row>
        </Row>
        <Divider />
        {[
          { l: 'Income', v: f.income, icon: 'arrow-down-circle-outline', t: 'green' as const },
          { l: 'Fixed bills', v: -f.bills, icon: 'calendar-outline', t: 'amber' as const },
          { l: 'Goals & savings', v: -f.goals, icon: 'leaf-outline', t: 'blue' as const },
          { l: `Flexible spending (${fmt(f.spentSoFar)} so far)`, v: -f.dynamic, icon: 'basket-outline', t: 'gray' as const },
        ].map((r) => (
          <Row key={r.l} gap={10} style={{ paddingVertical: 4 }}>
            <Icon name={r.icon} size={18} color={tone(r.t).fg} />
            <Txt style={{ flex: 1 }}>{r.l}</Txt>
            <Txt v="bodyStrong" tabular>
              {money(Math.round(r.v), currency, { sign: r.v > 0 })}
            </Txt>
          </Row>
        ))}
      </Card>

      {insights.length ? (
        <Card style={{ marginTop: 14 }} onPress={() => router.push('/insights')} accessibilityLabel={`${insights.length} insights`}>
          <Row gap={10}>
            <Icon name="sparkles-outline" color={c.amber} />
            <Txt v="bodyStrong" style={{ flex: 1 }}>
              {insights.length} way{insights.length === 1 ? '' : 's'} to find money this month
            </Txt>
            {insights.some((i) => i.type !== 'reallocation') ? (
              <Pill label={`≈ ${fmt(insights.filter((i) => i.type !== 'reallocation').reduce((a, i) => a + i.amountMonthly, 0))}/mo`} tone="green" />
            ) : null}
            <Icon name="chevron-forward" size={18} color={c.textFaint} />
          </Row>
        </Card>
      ) : null}

      <Section title="Food: actual vs plan">
        <Card style={{ gap: 10 }}>
          <SpendBars weeks={weeks} currencyFmt={fmt} />
          <Row gap={14} wrap>
            <Row gap={6}>
              <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: c.primary }} />
              <Txt v="caption" muted>
                Within plan
              </Txt>
            </Row>
            <Row gap={6}>
              <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: c.amberStrong }} />
              <Txt v="caption" muted>
                Above plan
              </Txt>
            </Row>
            <Row gap={6}>
              <View style={{ width: 14, height: 0, borderTopWidth: 2, borderStyle: 'dashed', borderColor: c.text }} />
              <Txt v="caption" muted>
                Plan
              </Txt>
            </Row>
          </Row>
          <Txt v="caption" muted>
            Groceries and eating out per week. Weeks before your first plan show spending only.
          </Txt>
        </Card>
      </Section>

      <Section title="Risky days">
        <Card style={{ gap: 12 }}>
          <HeatStrip days={risky} currencyFmt={fmt} />
          <Txt v="small" muted>
            {worst && worst.avg > 0
              ? worst.risky
                ? `${DAY_LONG[worst.day]}s average ${fmt(worst.avg)} eating out — over 2× your usual. Planning dinner that day keeps most of it.`
                : `Your eating-out spend is spread evenly. ${DAY_LONG[worst.day]} is the highest at ${fmt(worst.avg)}.`
              : 'Add a bank statement and we’ll spot the days your food spending spikes.'}
          </Txt>
        </Card>
      </Section>

      <Section title="This month by category">
        <Card style={{ gap: 12 }}>
          {VARIABLE_CATEGORIES.filter((cat) => (avgs[cat] ?? 0) > 0 || spend(s.transactions, ms, addDays(today(), 1), [cat]) > 0).map((cat) => {
            const mtd = spend(s.transactions, ms, addDays(today(), 1), [cat]);
            const norm = avgs[cat] ?? 0;
            const ratio = norm > 0 ? mtd / norm : 0;
            return (
              <View key={cat} style={{ gap: 6 }}>
                <Row gap={10}>
                  <Icon name={CATEGORY_ICON[cat]} size={18} color={c.textMuted} />
                  <Txt v="bodyStrong" style={{ flex: 1 }}>
                    {CATEGORY_LABEL[cat]}
                  </Txt>
                  <Txt v="small" tabular>
                    {fmt(mtd)} <Txt v="small" muted>/ usual {fmt(norm)}</Txt>
                  </Txt>
                </Row>
                <ProgressBar value={ratio} tone={ratio > 1 ? 'amber' : FOOD.includes(cat) ? 'amber' : 'green'} />
              </View>
            );
          })}
          {Object.values(avgs).every((v) => !v) ? <Txt muted>No spending yet this month.</Txt> : null}
        </Card>
      </Section>

      <Section title="Subscriptions & bills">
        <Card padded={false} style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
          {s.bills.length === 0 ? <EmptyState icon="calendar-outline" title="No bills yet" body="Add a bank statement and we’ll find your recurring bills and subscriptions." /> : null}
          {[...subs, ...fixed].map((b, i) => (
            <View key={b.id}>
              <ListRow
                icon={b.isSubscription ? 'repeat-outline' : 'calendar-outline'}
                iconTone={b.isSubscription ? 'blue' : 'amber'}
                title={b.name}
                subtitle={`${fmt(b.amount)}/${b.cadence === 'weekly' ? 'wk' : 'mo'} · day ${b.day}${b.usageNote ? ` · ${b.usageNote}` : ''}${b.active ? '' : ' · cancelled'}`}
                right={
                  b.isSubscription && b.active ? (
                    <Button label="Cancel" small variant="tonal" tone="blue" onPress={() => useStore.getState().cancelBill(b.id)} />
                  ) : !b.active ? (
                    <Button label="Restore" small variant="ghost" tone="gray" onPress={() => useStore.getState().toggleBill(b.id)} />
                  ) : null
                }
              />
              {i < s.bills.length - 1 ? <Divider style={{ marginVertical: 0 }} /> : null}
            </View>
          ))}
        </Card>
        {subs.length ? (
          <Txt v="caption" muted style={{ marginTop: 8 }}>
            Marking a subscription cancelled sends what it cost to your Found Money inbox. Remember to cancel with the provider too.
          </Txt>
        ) : null}
      </Section>
    </View>
  );
}

const FILTERS: (Category | 'all')[] = ['all', 'food_grocery', 'food_dining', 'transport', 'shopping', 'entertainment', 'health', 'household', 'bills', 'income', 'savings'];

function Transactions({ data }: { data: AppData }) {
  const { c } = useTheme();
  const currency = useCurrency();
  const tx = data.transactions;
  const recategorize = useStore((s) => s.recategorize);
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [adding, setAdding] = useState(false);
  const [limit, setLimit] = useState(40);
  const questions = tx.filter((t) => t.question);
  const list = tx.filter((t) => filter === 'all' || t.category === filter);
  const shown = list.slice(0, limit);
  return (
    <View style={{ gap: 12 }}>
      {questions.map((q) => (
        <Card key={q.id} tone="gray" style={{ gap: 8 }}>
          <Row gap={8}>
            <Icon name="help-circle-outline" size={18} />
            <Txt v="bodyStrong" style={{ flex: 1 }}>
              {q.question} ({money(q.amount, currency)})
            </Txt>
          </Row>
          <Row gap={8} wrap>
            {(q.alternatives ?? []).map((a) => (
              <Chip key={a} label={CATEGORY_LABEL[a]} onPress={() => recategorize(q.id, a)} />
            ))}
          </Row>
        </Card>
      ))}
      <View style={{ marginHorizontal: -16 }}>
        <Row gap={8} style={{ paddingHorizontal: 16, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <Chip key={f} small label={f === 'all' ? 'All' : CATEGORY_LABEL[f]} selected={filter === f} onPress={() => setFilter(f)} />
          ))}
        </Row>
      </View>
      <Button label="Add a transaction" icon="add" variant="secondary" small style={{ alignSelf: 'flex-start' }} onPress={() => setAdding(true)} />
      {list.length === 0 ? (
        <EmptyState icon="receipt-outline" title="No transactions yet" body="Upload a text-based bank statement PDF to extract your transactions." action={<Button label="Add a document" small onPress={() => router.push('/upload')} />} />
      ) : (
        <Card padded={false} style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
          {shown.map((t, i) => {
            const showDate = i === 0 || shown[i - 1].date !== t.date;
            return (
              <View key={t.id}>
                {showDate ? (
                  <Txt v="label" muted style={{ marginTop: i ? 12 : 8 }}>
                    {t.date === today() ? 'Today' : shortDate(t.date)}
                  </Txt>
                ) : null}
                <ListRow
                  icon={CATEGORY_ICON[t.category]}
                  iconTone={FOOD.includes(t.category) ? 'amber' : t.kind === 'income' ? 'green' : t.category === 'savings' ? 'blue' : 'gray'}
                  title={t.merchant}
                  subtitle={`${CATEGORY_LABEL[t.category]}${t.confidence !== 'high' ? ' · changed? tap to fix' : ''}`}
                  onPress={() => setSelected(t)}
                  right={
                    <Txt v="bodyStrong" tabular color={t.kind === 'income' ? c.primary : c.text}>
                      {t.kind === 'income' ? '+' : t.kind === 'transfer' ? '→ ' : ''}
                      {money(t.amount, currency, { decimals: t.amount % 1 ? 2 : 0 })}
                    </Txt>
                  }
                />
              </View>
            );
          })}
        </Card>
      )}
      {list.length > limit ? <Button label={`Show more (${list.length - limit})`} variant="ghost" onPress={() => setLimit((l) => l + 40)} /> : null}

      <Sheet visible={!!selected} onClose={() => setSelected(null)} title={selected?.merchant}>
        {selected ? (
          <>
            <Txt v="display">{money(selected.amount, currency, { decimals: selected.amount % 1 ? 2 : 0 })}</Txt>
            <Txt muted>
              {shortDate(selected.date)} · {selected.sourceDocId ? 'from your documents' : 'added by you'}
            </Txt>
            {selected.lineItems ? (
              <Card tone="gray" style={{ gap: 4 }}>
                {selected.lineItems.map((li) => (
                  <Row key={li.name} style={{ justifyContent: 'space-between' }}>
                    <Txt v="small">{li.name}</Txt>
                    <Txt v="small" tabular>
                      {money(li.price, currency, { decimals: 2 })}
                    </Txt>
                  </Row>
                ))}
              </Card>
            ) : null}
            <Txt v="h3">Category</Txt>
            <Row gap={8} wrap>
              {VARIABLE_CATEGORIES.concat(['bills', 'savings']).map((cat) => (
                <Chip
                  key={cat}
                  label={CATEGORY_LABEL[cat]}
                  icon={CATEGORY_ICON[cat]}
                  selected={selected.category === cat}
                  onPress={() => {
                    recategorize(selected.id, cat);
                    setSelected(null);
                  }}
                />
              ))}
            </Row>
          </>
        ) : null}
      </Sheet>
      <AddTransactionSheet visible={adding} onClose={() => setAdding(false)} />
    </View>
  );
}

function AddTransactionSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const add = useStore((s) => s.addManualTransaction);
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<Category>('food_grocery');
  const ok = merchant.trim() && parseFloat(amount) > 0;
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Add a transaction"
      footer={
        <Button
          label="Add"
          disabled={!ok}
          onPress={() => {
            add({ date: today(), merchant: merchant.trim(), amount: parseFloat(amount), kind: 'expense', category });
            setMerchant('');
            setAmount('');
            onClose();
          }}
        />
      }>
      <Field label="Where?" value={merchant} onChange={setMerchant} placeholder="e.g. Corner café" />
      <AmountInput label="Amount" value={amount} onChange={setAmount} />
      <Row gap={8} wrap>
        {VARIABLE_CATEGORIES.map((cat) => (
          <Chip key={cat} small label={CATEGORY_LABEL[cat]} selected={category === cat} onPress={() => setCategory(cat)} />
        ))}
      </Row>
    </Sheet>
  );
}

function Documents({ data }: { data: AppData }) {
  const docs = data.documents;
  const remove = useStore((s) => s.removeDocument);
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <View style={{ gap: 12 }}>
      <Button label="Upload a document" icon="cloud-upload-outline" onPress={() => router.push('/upload')} />
      <Card tone="green" style={{ gap: 6 }}>
        <Row gap={8}>
          <Icon name="lock-closed-outline" size={18} />
          <Txt v="bodyStrong">How your documents are handled</Txt>
        </Row>
        <Txt v="small" muted>
          Encrypted with your own key, read once to build your budget, and removed from processing within 30 days. Only the numbers you confirmed are kept.
        </Txt>
      </Card>
      {docs.length === 0 ? (
        <EmptyState icon="document-text-outline" title="No documents yet" body="A payslip and one bank statement is all it takes for your budget to build itself." />
      ) : (
        <Card padded={false} style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
          {docs.map((d, i) => (
            <View key={d.id}>
              <ListRow
                icon={d.status === 'failed' ? 'alert-circle-outline' : d.type === 'receipt' ? 'receipt-outline' : 'document-text-outline'}
                iconTone={d.status === 'failed' ? 'amber' : 'green'}
                title={d.name}
                subtitle={`${shortDate(d.addedAt.slice(0, 10))} · ${d.summary}`}
                right={<IconButton icon="trash-outline" label={`Delete ${d.name}`} onPress={() => setConfirm(d.id)} />}
              />
              {d.status === 'failed' ? (
                <Button label="Try again" small variant="tonal" tone="amber" style={{ alignSelf: 'flex-start', marginBottom: 8 }} onPress={() => router.push('/upload')} />
              ) : null}
              {i < docs.length - 1 ? <Divider style={{ marginVertical: 0 }} /> : null}
            </View>
          ))}
        </Card>
      )}
      <Sheet
        visible={!!confirm}
        onClose={() => setConfirm(null)}
        title="Delete this document?"
        footer={
          <>
            <Button
              label="Delete document"
              variant="destructive"
              onPress={() => {
                if (confirm) remove(confirm);
                setConfirm(null);
              }}
            />
            <Button label="Keep it" variant="ghost" tone="gray" onPress={() => setConfirm(null)} />
          </>
        }>
        <Txt muted>The original file is removed. Numbers you already confirmed stay in your budget — you can edit or delete them from Transactions.</Txt>
      </Sheet>
    </View>
  );
}
