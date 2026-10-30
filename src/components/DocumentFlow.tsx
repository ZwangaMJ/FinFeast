/**
 * Document parsing workflow U2–U6 (spec §3.1): upload → type → processing →
 * review & confirm (the trust moment) → first insight. Shared by onboarding,
 * the upload modal and the quick-add receipt flow.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { ReviewFieldCard } from '@/components/cards';
import { Ring } from '@/components/charts';
import { AmountInput, Button, Card, Chip, Divider, Icon, ListRow, Pill, Row, Sheet, Txt, TrustStrip, useCurrency } from '@/components/ui';
import { CATEGORY_LABEL, weeklyFlexible } from '@/lib/budget';
import { shortDate } from '@/lib/dates';
import { money } from '@/lib/format';
import { success } from '@/lib/haptics';
import { fileHash, pageCount, parseDocument, ParseError, SAMPLES, suggestType, SUPPORTED_TYPES, type ExtractionResult, type UploadInput } from '@/lib/parser';
import type { Category, DocRecord, DocType } from '@/store/types';
import { uid, useStore, type ReviewEdits } from '@/store/useStore';
import { useTheme } from '@/theme';

type Step =
  | { kind: 'pick' }
  | { kind: 'type'; input: UploadInput; suggested: DocType }
  | { kind: 'processing'; input: UploadInput; type: DocType }
  | { kind: 'review'; input: UploadInput; doc: DocRecord; result: ExtractionResult }
  | { kind: 'conflict'; input: UploadInput; doc: DocRecord; result: ExtractionResult; previous: number }
  | { kind: 'error'; reason: 'illegible' | 'unsupported' | 'duplicate'; detail?: string; input?: UploadInput; type?: DocType }
  | { kind: 'done'; doc: DocRecord; result: ExtractionResult };

const TYPE_OPTIONS: { type: DocType; label: string; icon: string }[] = [
  { type: 'payslip', label: 'Payslip', icon: 'document-text-outline' },
  { type: 'bank_statement', label: 'Bank statement', icon: 'reader-outline' },
  { type: 'receipt', label: 'Receipt', icon: 'receipt-outline' },
  { type: 'tax_form', label: 'Tax form', icon: 'briefcase-outline' },
  { type: 'unknown', label: 'Not sure', icon: 'help-circle-outline' },
];

const STATUS = ['Encrypting your document…', 'Reading the numbers…', 'Sorting income from expenses…', 'Building your first budget…'];

export function DocumentFlow({ mode = 'upload', onDone, onManual }: { mode?: 'upload' | 'onboarding' | 'receipt'; onDone: () => void; onManual?: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const documents = useStore((s) => s.documents);
  const currency = useCurrency();

  const start = (input: UploadInput) => {
    const hash = fileHash(input);
    const dup = documents.find((d) => d.hash === hash && d.status === 'confirmed');
    if (dup) {
      setStep({ kind: 'error', reason: 'duplicate', detail: `Already added on ${shortDate(dup.addedAt)}` });
      return;
    }
    const suggested = mode === 'receipt' ? 'receipt' : suggestType(input);
    if (mode === 'receipt') setStep({ kind: 'processing', input, type: 'receipt' });
    else setStep({ kind: 'type', input, suggested });
  };

  if (step.kind === 'pick') return <PickStep mode={mode} onPicked={start} onManual={onManual} />;
  if (step.kind === 'type') return <TypeStep step={step} onBack={() => setStep({ kind: 'pick' })} onConfirm={(type) => setStep({ kind: 'processing', input: step.input, type })} />;
  if (step.kind === 'processing')
    return (
      <ProcessingStep
        input={step.input}
        type={step.type}
        onResult={(doc, result) => {
          const income = useStore.getState().income;
          const net = result.income?.net?.value;
          if (result.documentType === 'payslip' && income?.source === 'document' && net !== undefined && net < income.net) {
            setStep({ kind: 'conflict', input: step.input, doc, result, previous: income.net });
          } else {
            success();
            setStep({ kind: 'review', input: step.input, doc, result });
          }
        }}
        onError={(reason) => {
          if (reason === 'illegible') {
            useStore.getState().addFailedDocument({ id: uid(), name: step.input.name, type: step.type, hash: fileHash(step.input), addedAt: new Date().toISOString(), status: 'failed', pages: 1, summary: "Couldn't read clearly" });
          }
          setStep({ kind: 'error', reason, input: step.input, type: step.type });
        }}
      />
    );
  if (step.kind === 'conflict')
    return (
      <ConflictStep
        current={step.result.income!.net!.value}
        previous={step.previous}
        onChoose={(which) => {
          if (which === 'new') setStep({ kind: 'review', input: step.input, doc: step.doc, result: step.result });
          else {
            useStore.getState().addFailedDocument({ ...step.doc, summary: 'Older payslip — kept for records' });
            onDone();
          }
        }}
      />
    );
  if (step.kind === 'review')
    return (
      <ReviewStep
        doc={step.doc}
        result={step.result}
        onConfirm={(edits) => {
          useStore.getState().applyExtraction(step.doc, step.result, edits);
          success();
          if (mode === 'receipt') onDone();
          else setStep({ kind: 'done', doc: step.doc, result: step.result });
        }}
      />
    );
  if (step.kind === 'error') return <ErrorStep step={step} onRetry={() => setStep({ kind: 'pick' })} onManual={onManual} onDone={onDone} />;
  return <DoneStep result={step.result} onDone={onDone} currency={currency} />;
}

function PickStep({ mode, onPicked, onManual }: { mode: string; onPicked: (i: UploadInput) => void; onManual?: () => void }) {
  const { c } = useTheme();
  const [camHelp, setCamHelp] = useState(false);

  const camera = async () => {
    setCamHelp(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!res.canceled && res.assets[0]) {
      const a = res.assets[0];
      onPicked({ name: a.fileName ?? `scan_${Date.now()}.jpg`, size: a.fileSize ?? a.width * a.height, mimeType: a.mimeType ?? 'image/jpeg' });
    }
  };
  const files = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true });
    if (!res.canceled && res.assets[0]) {
      const a = res.assets[0];
      onPicked({ name: a.name, size: a.size ?? 0, mimeType: a.mimeType ?? undefined });
    }
  };

  return (
    <View style={{ gap: 14 }}>
      <Txt v="title">{mode === 'receipt' ? 'Add a receipt' : 'Add a document'}</Txt>
      <Txt muted>{mode === 'receipt' ? 'Snap it and we’ll file it under food spending.' : 'A payslip or bank statement is enough for your budget to build itself.'}</Txt>
      <TrustStrip />
      <Row gap={12}>
        <Card style={{ flex: 1, alignItems: 'center', gap: 8 }} onPress={() => setCamHelp(true)} accessibilityLabel="Scan with camera">
          <Icon name="camera-outline" size={28} color={c.primary} />
          <Txt v="bodyStrong">Scan</Txt>
          <Txt v="caption" muted center>
            Receipts, payslips
          </Txt>
        </Card>
        <Card style={{ flex: 1, alignItems: 'center', gap: 8 }} onPress={files} accessibilityLabel="Choose a file">
          <Icon name="folder-open-outline" size={28} color={c.primary} />
          <Txt v="bodyStrong">Choose file</Txt>
          <Txt v="caption" muted center>
            PDF or photo
          </Txt>
        </Card>
      </Row>
      <Divider />
      <Txt v="label" muted>
        Or try it with a sample
      </Txt>
      <Card padded={false} style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
        {SAMPLES.filter((s) => mode !== 'receipt' || s.kind === 'receipt' || s.kind === 'blurry').map((s, i, arr) => (
          <View key={s.kind}>
            <ListRow icon={s.icon} iconTone={s.kind === 'blurry' ? 'gray' : 'amber'} title={s.label} subtitle={s.name} chevron onPress={() => onPicked({ name: s.name, size: 410000, sample: s.kind, mimeType: s.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' })} />
            {i < arr.length - 1 ? <Divider style={{ marginVertical: 0 }} /> : null}
          </View>
        ))}
      </Card>
      {onManual ? <Button label={mode === 'onboarding' ? 'Skip for now — enter two numbers instead' : 'Enter totals manually instead'} variant="ghost" onPress={onManual} /> : null}
      <Sheet
        visible={camHelp}
        onClose={() => setCamHelp(false)}
        title="Camera access"
        footer={
          <>
            <Button label="Allow camera" icon="camera-outline" onPress={camera} />
            <Button label="Not now" variant="ghost" tone="gray" onPress={() => setCamHelp(false)} />
          </>
        }>
        <Txt muted>We use the camera only while you scan. Photos are encrypted, read by our AI to pull out totals, then deleted from processing within 30 days (you can delete sooner).</Txt>
        <Txt v="small" muted>
          Tip: flat surface, good light, all four corners in frame.
        </Txt>
      </Sheet>
    </View>
  );
}

function TypeStep({ step, onBack, onConfirm }: { step: Extract<Step, { kind: 'type' }>; onBack: () => void; onConfirm: (t: DocType) => void }) {
  const [type, setType] = useState<DocType>(step.suggested);
  return (
    <View style={{ gap: 14 }}>
      <Txt v="title">What is this?</Txt>
      <Card style={{ gap: 4 }}>
        <Row gap={10}>
          <Icon name="document-attach-outline" />
          <Txt v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
            {step.input.name}
          </Txt>
        </Row>
        {step.suggested !== 'unknown' ? (
          <Txt v="small" muted>
            Looks like a {TYPE_OPTIONS.find((o) => o.type === step.suggested)?.label.toLowerCase()} — confirm or pick another.
          </Txt>
        ) : null}
      </Card>
      <Row gap={8} wrap>
        {TYPE_OPTIONS.map((o) => (
          <Chip key={o.type} label={o.label} icon={type === o.type ? undefined : o.icon} selected={type === o.type} onPress={() => setType(o.type)} />
        ))}
      </Row>
      <Button label="Read this document" icon="sparkles-outline" onPress={() => onConfirm(type)} style={{ marginTop: 8 }} />
      <Button label="Choose a different file" variant="ghost" onPress={onBack} />
    </View>
  );
}

function ProcessingStep({ input, type, onResult, onError }: { input: UploadInput; type: DocType; onResult: (doc: DocRecord, r: ExtractionResult) => void; onError: (reason: 'illegible' | 'unsupported') => void }) {
  const currency = useCurrency();
  const pages = pageCount(type, input);
  const [elapsed, setElapsed] = useState(0);
  const total = type === 'receipt' ? 2800 : type === 'bank_statement' ? 5200 : 4000;

  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - started), 120);
    const docId = uid();
    let cancelled = false;
    const run = async () => {
      try {
        const [result] = await Promise.all([parseDocument(input, type, currency, docId), new Promise((r) => setTimeout(r, total))]);
        if (cancelled) return;
        const r = result as ExtractionResult;
        const summary =
          r.documentType === 'payslip'
            ? `Net pay ${money(r.income?.net?.value ?? 0, currency)}`
            : r.documentType === 'bank_statement'
              ? `${r.transactions.length} transactions · ${r.recurringBills.length} bills`
              : r.receipt
                ? `${r.receipt.merchant} · ${money(r.receipt.total, currency, { decimals: 2 })}`
                : 'Annual income & retirement';
        onResult({ id: docId, name: input.name, type, hash: fileHash(input), addedAt: new Date().toISOString(), status: 'needs_review', pages: r.pages, summary }, r);
      } catch (e) {
        if (cancelled) return;
        await new Promise((res) => setTimeout(res, 1600));
        onError(e instanceof ParseError ? e.reason : 'illegible');
      }
    };
    run();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const p = Math.min(1, elapsed / total);
  const status = STATUS[Math.min(STATUS.length - 1, Math.floor(p * STATUS.length))];
  const page = Math.min(pages, Math.floor(p * pages) + 1);
  return (
    <View style={{ alignItems: 'center', gap: 18, paddingTop: 30 }}>
      <Ring value={p} size={160} stroke={10} accessibilityLabel={`Processing, ${Math.round(p * 100)} percent`}>
        <Txt v="display" tabular>
          {Math.round(p * 100)}%
        </Txt>
      </Ring>
      <Txt v="h2" center accessibilityLabel={status}>
        {status}
      </Txt>
      {pages > 1 ? (
        <Txt muted tabular>
          Page {page} of {pages}
        </Txt>
      ) : null}
      <TrustStrip text="Names, ID and account numbers are masked before our AI sees anything." />
      <Txt v="small" muted center>
        You can leave this screen — we’ll let you know when it’s ready.
      </Txt>
    </View>
  );
}

function ConflictStep({ current, previous, onChoose }: { current: number; previous: number; onChoose: (w: 'new' | 'old') => void }) {
  const currency = useCurrency();
  return (
    <View style={{ gap: 14 }}>
      <Txt v="title">Which one is current?</Txt>
      <Txt muted>This payslip shows a different net pay from the one we have. We’ll only update your forecast once you confirm.</Txt>
      <Card onPress={() => onChoose('new')} accessibilityLabel={`New payslip ${money(current, currency)}`}>
        <Txt v="label" muted>
          This document
        </Txt>
        <Txt v="display">{money(current, currency)}</Txt>
        <Txt v="small" muted>
          Use this as my income from now on
        </Txt>
      </Card>
      <Card onPress={() => onChoose('old')} accessibilityLabel={`Previous payslip ${money(previous, currency)}`}>
        <Txt v="label" muted>
          What we have
        </Txt>
        <Txt v="display">{money(previous, currency)}</Txt>
        <Txt v="small" muted>
          Keep this — the new one is older or a one-off
        </Txt>
      </Card>
    </View>
  );
}

function ErrorStep({ step, onRetry, onManual, onDone }: { step: Extract<Step, { kind: 'error' }>; onRetry: () => void; onManual?: () => void; onDone: () => void }) {
  const copy = {
    illegible: { icon: 'eye-off-outline', title: 'We couldn’t read this clearly', body: 'Try again in better light, or enter the totals manually. We’ve kept the document in your queue.' },
    unsupported: { icon: 'document-outline', title: 'We can’t read this type of document yet', body: 'Here’s what works today:' },
    duplicate: { icon: 'copy-outline', title: 'You’ve already added this one', body: step.detail ?? '' },
  }[step.reason];
  return (
    <View style={{ gap: 14 }}>
      <Card tone="amber" style={{ gap: 10, alignItems: 'flex-start' }}>
        <Icon name={copy.icon} size={28} />
        <Txt v="h2">{copy.title}</Txt>
        <Txt muted>{copy.body}</Txt>
        {step.reason === 'unsupported'
          ? SUPPORTED_TYPES.map((t) => (
              <Row key={t} gap={8}>
                <Icon name="checkmark" size={16} />
                <Txt v="small">{t}</Txt>
              </Row>
            ))
          : null}
      </Card>
      <Button label={step.reason === 'duplicate' ? 'Add a different document' : 'Try again'} icon="refresh" onPress={onRetry} />
      {onManual && step.reason !== 'duplicate' ? <Button label="Enter totals manually" variant="secondary" onPress={onManual} /> : null}
      {step.reason === 'duplicate' ? <Button label="Done" variant="ghost" onPress={onDone} /> : null}
    </View>
  );
}

function ReviewStep({ doc, result, onConfirm }: { doc: DocRecord; result: ExtractionResult; onConfirm: (e: ReviewEdits) => void }) {
  const { c } = useTheme();
  const currency = useCurrency();
  const existing = useStore((s) => s.income);
  const fmt = (n: number) => money(n, currency);
  const [net, setNet] = useState(result.income?.net?.value ?? 0);
  const [rejected, setRejected] = useState<string[]>([]);
  const groceryMonthly = result.variableCategories.food_grocery?.monthly ?? 0;
  const diningMonthly = result.variableCategories.food_dining?.monthly ?? 0;
  const [weeklyFood, setWeeklyFood] = useState(Math.round((groceryMonthly * 12) / 52 / 10) * 10 || 700);
  const [savings, setSavings] = useState(result.savingsTransfers.reduce((a, t) => a + t.monthly, 0));
  const [answers, setAnswers] = useState<Record<string, Category>>({});
  const [receiptCat, setReceiptCat] = useState<Category>(result.receipt?.categoryGuess ?? 'food_grocery');
  const [receiptTotal, setReceiptTotal] = useState(result.receipt?.total ?? 0);
  const [billsOpen, setBillsOpen] = useState(true);
  const [editing, setEditing] = useState<null | { label: string; value: number; set: (n: number) => void }>(null);
  const [draft, setDraft] = useState('');
  const questions = result.transactions.filter((t) => t.question);

  const bills = result.recurringBills;
  const billTotal = bills.filter((b) => !rejected.includes(b.id)).reduce((a, b) => a + b.amount, 0);
  const edit = (label: string, value: number, set: (n: number) => void) => {
    setDraft(String(value));
    setEditing({ label, value, set });
  };
  const unchangedNet = existing?.source === 'document' && Math.abs((existing?.net ?? 0) - net) < 1;
  const firstEditable = () => (result.income?.net ? edit('Net income (monthly)', net, setNet) : result.receipt ? edit('Total', receiptTotal, setReceiptTotal) : undefined);

  return (
    <View style={{ gap: 12 }}>
      <Txt v="title">Does this look right?</Txt>
      <Txt muted>We read {doc.pages > 1 ? `${doc.pages} pages of ` : ''}your {doc.type.replace('_', ' ')}. Nothing is used until you confirm — tap the pencil to fix any number.</Txt>

      {result.income?.net ? (
        <ReviewFieldCard label="Net income (monthly)" value={fmt(net)} confidence={result.income.net.confidence} source={result.income.net.sourceText} onEdit={() => edit('Net income (monthly)', net, setNet)} unchanged={unchangedNet}>
          {result.income.gross ? (
            <Txt v="small" muted>
              Gross {fmt(result.income.gross.value)} · {result.income.deductions.length} deductions
            </Txt>
          ) : null}
        </ReviewFieldCard>
      ) : null}

      {result.documentType === 'payslip' && result.income?.deductions.length ? (
        <Card style={{ gap: 6 }}>
          <Txt v="smallStrong" muted>
            Deductions
          </Txt>
          {result.income.deductions.map((d) => (
            <Row key={d.label} style={{ justifyContent: 'space-between' }}>
              <Txt v="small">{d.label}</Txt>
              <Txt v="small" tabular>
                {fmt(d.amount)}
              </Txt>
            </Row>
          ))}
        </Card>
      ) : null}

      {bills.length ? (
        <ReviewFieldCard label={`Fixed bills detected (${bills.length - rejected.length})`} value={fmt(billTotal)} confidence={bills.some((b) => b.confidence !== 'high') ? 'medium' : 'high'}>
          <Pressable onPress={() => setBillsOpen((o) => !o)} accessibilityRole="button" style={{ minHeight: 32, justifyContent: 'center' }}>
            <Txt v="smallStrong" color={c.amber}>
              {billsOpen ? 'Hide list' : 'Review list'}
            </Txt>
          </Pressable>
          {billsOpen
            ? bills.map((b) => {
                const off = rejected.includes(b.id);
                return (
                  <Row key={b.id} gap={10} style={{ opacity: off ? 0.5 : 1 }}>
                    <View style={{ flex: 1 }}>
                      <Txt v="bodyStrong" style={off ? { textDecorationLine: 'line-through' } : undefined}>
                        {b.name}
                      </Txt>
                      <Txt v="caption" muted>
                        {fmt(b.amount)} · day {b.day} · {b.confidence === 'high' ? 'seen every month' : 'looks like a subscription'}
                      </Txt>
                    </View>
                    <Chip small label={off ? 'Not a bill' : 'Keep'} selected={!off} onPress={() => setRejected((r) => (off ? r.filter((x) => x !== b.id) : [...r, b.id]))} />
                  </Row>
                );
              })
            : null}
        </ReviewFieldCard>
      ) : null}

      {result.documentType === 'bank_statement' ? (
        <ReviewFieldCard label="Dynamic expenses (food, monthly)" value={fmt(groceryMonthly + diningMonthly)} confidence="medium" onEdit={() => edit('Weekly grocery budget', weeklyFood, setWeeklyFood)}>
          <Row gap={6} wrap>
            <Pill label={`Groceries ${fmt(groceryMonthly)}`} tone="green" icon="basket-outline" />
            <Pill label={`Eating out ${fmt(diningMonthly)}`} tone="amber" icon="fast-food-outline" />
          </Row>
          <Txt v="small" muted>
            Your weekly grocery budget starts at {fmt(weeklyFood)} — your meal plan will aim to come in under it.
          </Txt>
        </ReviewFieldCard>
      ) : null}

      {result.documentType === 'bank_statement' ? (
        <ReviewFieldCard label="Savings / investments (monthly)" value={fmt(savings)} confidence={result.savingsTransfers[0]?.confidence ?? 'medium'} onEdit={() => edit('Savings / investments (monthly)', savings, setSavings)}>
          {savings > 0 ? (
            <Txt v="small" muted>
              You already save {fmt(savings)} a month — nice. We’ll count it toward your Emergency Fund.
            </Txt>
          ) : null}
        </ReviewFieldCard>
      ) : null}

      {questions.map((q) => (
        <Card key={q.id} tone="gray" style={{ gap: 8 }}>
          <Row gap={8}>
            <Icon name="help-circle-outline" size={18} />
            <Txt v="bodyStrong" style={{ flex: 1 }}>
              {q.question} ({fmt(q.amount)})
            </Txt>
          </Row>
          <Row gap={8} wrap>
            {(q.alternatives ?? []).map((a) => (
              <Chip key={a} label={CATEGORY_LABEL[a]} selected={answers[q.id] === a} onPress={() => setAnswers((s) => ({ ...s, [q.id]: a }))} />
            ))}
          </Row>
        </Card>
      ))}

      {result.receipt ? (
        <>
          <ReviewFieldCard label={`${result.receipt.merchant} · ${shortDate(result.receipt.date)}`} value={money(receiptTotal, currency, { decimals: 2 })} confidence={result.receipt.confidence} onEdit={() => edit('Receipt total', receiptTotal, setReceiptTotal)}>
            <Row gap={6} wrap>
              {(['food_grocery', 'food_dining', 'household'] as Category[]).map((cat) => (
                <Chip key={cat} small label={CATEGORY_LABEL[cat]} selected={receiptCat === cat} onPress={() => setReceiptCat(cat)} />
              ))}
            </Row>
          </ReviewFieldCard>
          <Card style={{ gap: 6 }}>
            <Txt v="smallStrong" muted>
              {result.receipt.lineItems.length} items
            </Txt>
            {result.receipt.lineItems.map((i) => (
              <Row key={i.name} style={{ justifyContent: 'space-between' }}>
                <Txt v="small" style={{ flex: 1 }}>
                  {i.name}
                </Txt>
                {i.brand ? <Pill label="Brand" tone="amber" /> : null}
                <Txt v="small" tabular style={{ minWidth: 64, textAlign: 'right' }}>
                  {money(i.price, currency, { decimals: 2 })}
                </Txt>
              </Row>
            ))}
          </Card>
        </>
      ) : null}

      {result.taxForm ? (
        <>
          <ReviewFieldCard label="Annual taxable income" value={fmt(result.taxForm.annualIncome)} confidence="high" />
          <ReviewFieldCard label="Retirement contributions (year)" value={fmt(result.taxForm.retirement)} confidence="high">
            <Txt v="small" muted>
              Used for your annual view. This isn’t tax advice — check with a registered practitioner before changing contributions.
            </Txt>
          </ReviewFieldCard>
        </>
      ) : null}

      <Button
        label={result.receipt ? 'Save receipt' : 'Looks right — build my plan'}
        icon="checkmark"
        style={{ marginTop: 8 }}
        disabled={questions.some((q) => !answers[q.id])}
        onPress={() => onConfirm({ net, rejectedBillIds: rejected, weeklyFood, savingsMonthly: savings, answers, receiptCategory: receiptCat, receiptTotal })}
      />
      {questions.some((q) => !answers[q.id]) ? (
        <Txt v="caption" muted center>
          Answer the question above so we file it correctly.
        </Txt>
      ) : null}
      <Button label="Fix anything that’s wrong" variant="ghost" onPress={firstEditable} />

      <Sheet
        visible={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.label}
        footer={
          <Button
            label="Save"
            onPress={() => {
              const n = parseFloat(draft);
              if (!Number.isNaN(n) && editing) editing.set(n);
              setEditing(null);
            }}
          />
        }>
        <AmountInput value={draft} onChange={setDraft} autoFocus />
      </Sheet>
    </View>
  );
}

function DoneStep({ result, onDone, currency }: { result: ExtractionResult; onDone: () => void; currency: Parameters<typeof money>[1] }) {
  const s = useStore();
  const flex = useMemo(() => weeklyFlexible(s.income, s.bills, s.goals), [s.income, s.bills, s.goals]);
  const sources = result.documentType === 'payslip' ? 'your payslip' : result.documentType === 'bank_statement' ? 'your statement' : 'your document';
  const needsStatement = result.documentType === 'payslip' && s.bills.length === 0;
  return (
    <View style={{ gap: 16, paddingTop: 20 }}>
      <View style={{ alignItems: 'center', gap: 10 }}>
        <Txt style={{ fontSize: 54, lineHeight: 64 }}>🌱</Txt>
        <Txt v="title" center>
          {needsStatement ? 'Income added' : 'Your plan is ready'}
        </Txt>
      </View>
      <Card style={{ gap: 6 }}>
        <Txt muted>Based on {sources}, you have about</Txt>
        <Txt v="hero">{money(Math.max(0, Math.round(flex / 10) * 10), currency)}</Txt>
        <Txt muted>of flexible money each week.</Txt>
      </Card>
      {needsStatement ? (
        <Txt v="small" muted center>
          Add a bank statement next and we’ll subtract your bills automatically.
        </Txt>
      ) : null}
      <Button label="See my plan" icon="arrow-forward" onPress={onDone} />
    </View>
  );
}
