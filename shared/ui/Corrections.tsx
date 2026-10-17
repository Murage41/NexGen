import { useEffect, useState } from 'react';
import { ApproverFields, useApprover, type ApprovalApi } from './ApproverConfirm';

// Corrections (backend services/corrections.ts, docs/CORRECTIONS.md): the one
// way to fix a mistake in a closed record. Before a shift closes, fix it on the
// shift; after, correct it here. The shift keeps what it closed with; the
// correction is recorded next to it with what it changed.
//
// The flow: what was wrong → the right value → the effects in
// plain words (and, if a shift gets worse, who carries it) → a reason → the
// admin approves exactly what was shown (desktop: name and PIN; phone: the
// signed-in admin). Opening declarations and custody movements also use this
// flow. Closing cash and M-Pesa are corrected as independent full totals.

const kes = (value: unknown) =>
  `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900 text-sm';
const errorText = (e: any, fallback: string) => e?.response?.data?.error || e?.message || fallback;
const litresText = (litres: unknown, fuel: unknown) => `${Number(litres || 0).toFixed(2)} L of ${fuel}`;
const methodName = (method: unknown) => (method === 'mpesa' ? 'M-Pesa' : 'cash');
const day = (date: unknown) => (date ? ` (${String(date).slice(0, 10)})` : '');
const validCollectionTotal = (value: string) => {
  const text = value.trim();
  const number = Number(text);
  return /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text)
    && Number.isFinite(number) && number >= 0 && number <= 100000000;
};
const validCustomerCorrectionAmount = (value: string) => validCollectionTotal(value) && Number(value) > 0;

export type RecordType = 'fuel_on_account' | 'credit_sale' | 'debt_receipt' | 'drawer_expense' | 'collection' | 'opening_funds' | 'shift_funds';

export type CorrectionApi = {
  // POST /corrections/preview, POST /corrections, POST /corrections/:id/undo,
  // GET /corrections/reasons (axios responses).
  preview: (body: Record<string, unknown>) => Promise<any>;
  post: (body: Record<string, unknown>) => Promise<any>;
  undo: (id: number, body: Record<string, unknown>) => Promise<any>;
  reasons: () => Promise<any>;
  // Customers the record may belong to: invoice customers for fuel on
  // account, credit customers for credit sales and debt payments.
  customers: (billing: 'invoice' | 'money') => Promise<Array<{ id: number; name: string }>>;
  // Expense categories (GET /expenses/categories).
  categories: () => Promise<string[]>;
};

export const RECORD_LABELS: Record<string, string> = {
  fuel_on_account: 'Fuel on account',
  credit_sale: 'Credit sale',
  debt_receipt: 'Debt payment',
  drawer_expense: 'Drawer expense',
  collection: 'Cash and M-Pesa',
  opening_funds: 'Opening funds',
  shift_funds: 'Money added / removed',
};

const KINDS: Record<RecordType, Array<{ kind: string; label: string }>> = {
  fuel_on_account: [
    { kind: 'wrong_litres', label: 'The litres were wrong' },
    { kind: 'wrong_fuel', label: 'It was the other fuel' },
    { kind: 'wrong_customer', label: 'It was another customer' },
    { kind: 'wrong_shift', label: 'It was on another shift' },
    { kind: 'duplicate', label: 'It was never taken, or was recorded twice' },
    { kind: 'missing', label: 'Fuel was taken but not recorded' },
  ],
  credit_sale: [
    { kind: 'wrong_customer', label: 'It was another customer' },
    { kind: 'wrong_amount', label: 'The amount was wrong' },
    { kind: 'wrong_shift', label: 'It was on another shift' },
    { kind: 'duplicate', label: 'It was never given, or was recorded twice' },
    { kind: 'missing', label: 'A credit sale was not recorded' },
  ],
  debt_receipt: [
    { kind: 'wrong_customer', label: 'Another customer paid' },
    { kind: 'wrong_amount', label: 'The amount was wrong' },
    { kind: 'wrong_method', label: 'Cash and M-Pesa the wrong way round' },
    { kind: 'wrong_shift', label: 'It was received in another shift' },
    { kind: 'duplicate', label: 'It was never received, or was recorded twice' },
    { kind: 'missing', label: 'A payment received was not recorded' },
  ],
  drawer_expense: [
    { kind: 'wrong_amount', label: 'The amount was wrong' },
    { kind: 'wrong_category', label: 'It was another category' },
    { kind: 'duplicate', label: 'It was never paid, or was recorded twice' },
    { kind: 'missing', label: 'An expense paid from the drawer was not recorded' },
  ],
  collection: [{ kind: 'wrong_amount', label: 'The recorded cash or M-Pesa total was wrong' }],
  opening_funds: [{ kind: 'wrong_amount', label: 'The opening amount was wrong' }],
  shift_funds: [
    { kind: 'missing', label: 'Record money added or removed' },
    { kind: 'duplicate', label: 'Reverse this money movement' },
  ],
};

export const errorKindLabel = (kind: string, recordType = 'fuel_on_account') =>
  kind === 'undo' ? 'Undo' : recordType === 'collection' && kind === 'wrong_split'
    ? 'Recorded the wrong way round' : KINDS[recordType as RecordType]?.find((k) => k.kind === kind)?.label || kind;
// "Credit sale: the amount was wrong".
export const correctionTitle = (recordType: string, kind: string) => {
  if (kind === 'undo') return 'Undo';
  const label = errorKindLabel(kind, recordType);
  return `${RECORD_LABELS[recordType] || recordType}: ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
};

// What a correction line did, in a few words.
export function lineText(line: any) {
  const verb = line.action === 'add' ? 'added' : line.action === 'restore' ? 'restored' : 'reversed';
  const party = line.party_name ? ` ${line.record_type === 'debt_receipt' ? 'by' : 'to'} ${line.party_name}` : '';
  switch (line.record_type) {
    case 'credit_sale': return `${verb} credit sale of ${kes(line.amount)}${party}`;
    case 'debt_receipt': return `${verb} ${kes(line.amount)} paid${party} in ${methodName(line.method)}`;
    case 'drawer_expense': return `${verb} expense of ${kes(line.amount)}${line.category ? ` (${line.category})` : ''}`;
    case 'collection': return line.category === 'closing_total'
      ? `${verb} recorded ${methodName(line.method)} total of ${kes(line.amount)}`
      : line.action === 'add' || line.action === 'restore'
        ? `${kes(line.amount)} into ${methodName(line.method)}`
        : `${kes(line.amount)} out of ${methodName(line.method)}`;
    case 'opening_funds': return `${verb} opening ${methodName(line.method)} of ${kes(line.amount)}`;
    case 'shift_funds': return `${verb} ${methodName(line.method)} ${line.category === 'removed' ? 'removal' : 'addition'} of ${kes(line.amount)}`;
    default: return `${verb} ${litresText(line.litres, line.fuel_type)}${line.party_name ? ` on ${line.party_name}` : ''}`;
  }
}

// The record as it was recorded, for the top of the form.
function recordedText(recordType: RecordType, target: any, shift: any) {
  const where = ` in shift #${target?.shift_id ?? shift?.id}${day(target?.shift_date ?? shift?.shift_date)}`;
  switch (recordType) {
    case 'credit_sale': return `credit sale of ${kes(target.amount)} to ${target.account_name || target.customer_name}${where}.`;
    case 'debt_receipt': return `${kes(target.amount)} paid by ${target.account_name} in ${methodName(target.payment_method)}${where}.`;
    case 'drawer_expense': return `drawer expense of ${kes(target.amount)} (${target.category}${target.description ? `: ${target.description}` : ''})${where}.`;
    case 'collection': return `shift #${shift?.id}${day(shift?.shift_date)}: cash ${kes(target?.cash_amount)}, M-Pesa ${kes(target?.mpesa_amount)}.`;
    case 'opening_funds': return `opening ${methodName(target.payment_method)} ${kes(target.amount)}${where}.`;
    case 'shift_funds': return `${methodName(target.method)} ${target.direction === 'removed' ? 'removed' : 'added'}: ${kes(target.amount)}, reference ${target.reference}${where}.`;
    default: return `fuel entry #${target.id}, ${litresText(target.litres, target.fuel_type)}${target.account_name ? ` on ${target.account_name}` : ''}${where}, ${kes(target.retail_amount)}.`;
  }
}

const MISSING: Record<RecordType, string> = {
  fuel_on_account: "Fuel on account taken in this shift but not recorded. It is added at the shift's pump price.",
  credit_sale: 'A credit sale given in this shift but not recorded.',
  debt_receipt: 'A debt payment received in this shift but not recorded. It pays the customer\'s oldest debts first.',
  drawer_expense: 'An expense paid from this shift\'s drawer but not recorded (for example a receipt found later).',
  collection: '',
  opening_funds: 'Correct the amount declared before this shift opened. Enter the full correct opening amount, including zero.',
  shift_funds: 'Record an otherwise unrecorded custody movement. Do not repeat expenses, wages or customer payments already recorded. For a cash/M-Pesa transfer, record a removal and an addition with the same reference.',
};

export function CorrectionForm({
  api,
  approval,
  recordType,
  target,
  shift,
  onDone,
  onCancel,
  inputClassName = field,
}: {
  api: CorrectionApi;
  approval?: ApprovalApi;
  recordType: RecordType;
  // The record being corrected (for cash and M-Pesa: the shift's collections),
  // or none: something missing from the shift.
  target?: any | null;
  shift?: { id: number; shift_date?: string | null; reconciliation_basis?: string | null } | null;
  onDone: (correction: any) => Promise<void> | void;
  onCancel: () => void;
  inputClassName?: string;
}) {
  const approver = useApprover(approval);
  const fuel = recordType === 'fuel_on_account';
  const collection = recordType === 'collection';
  const customerMoney = recordType === 'credit_sale' || recordType === 'debt_receipt';
  const balanceBased = shift?.reconciliation_basis === 'balances_v1';
  // A record being corrected offers every mistake but "missing"; adding a
  // missing record offers only that.
  const kinds = recordType === 'collection' || recordType === 'opening_funds'
    ? KINDS[recordType]
    : KINDS[recordType].filter((k) => (target ? k.kind !== 'missing' : k.kind === 'missing'));
  const single = kinds.length === 1 ? kinds[0].kind : '';
  const [kind, setKind] = useState(single || (target ? '' : 'missing'));
  const [litres, setLitres] = useState(fuel && target ? String(Number(target.litres)) : '');
  const [fuelType, setFuelType] = useState(fuel && target ? (target.fuel_type === 'diesel' ? 'petrol' : 'diesel') : '');
  const [amount, setAmount] = useState('');
  const [cashAmount, setCashAmount] = useState(collection && target?.cash_amount != null ? String(target.cash_amount) : '');
  const [mpesaAmount, setMpesaAmount] = useState(collection && target?.mpesa_amount != null ? String(target.mpesa_amount) : '');
  const [method, setMethod] = useState(recordType === 'opening_funds' ? target?.payment_method || '' : '');
  const [category, setCategory] = useState('');
  const [source, setSource] = useState('');
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [accountId, setAccountId] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [chargeTo, setChargeTo] = useState('');
  const [override, setOverride] = useState(false);
  const [reasons, setReasons] = useState<Array<{ code: string; label: string }>>([]);
  const [customers, setCustomers] = useState<Array<{ id: number; name: string }>>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [reasonCode, setReasonCode] = useState('');
  const [reasonNote, setReasonNote] = useState('');
  const [plan, setPlan] = useState<{ data?: any; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.reasons().then((r) => setReasons(r.data.data || [])).catch(() => setReasons([]));
    if (recordType === 'fuel_on_account' || recordType === 'credit_sale' || recordType === 'debt_receipt') {
      api.customers(fuel ? 'invoice' : 'money').then(setCustomers).catch(() => setCustomers([]));
    }
    if (recordType === 'drawer_expense') api.categories().then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (customerMoney && kind === 'wrong_amount' && target) setAmount(String(target.amount ?? ''));
  }, [recordType, kind, target?.id, target?.amount]);

  // What the request needs for this record and mistake.
  const needs = {
    litres: fuel && ['wrong_litres', 'wrong_fuel', 'missing'].includes(kind),
    fuel: fuel && ['wrong_fuel', 'missing'].includes(kind),
    amount: !fuel && !collection && ['wrong_amount', 'missing'].includes(kind),
    collectionTotals: collection,
    customer: ['fuel_on_account', 'credit_sale', 'debt_receipt'].includes(recordType) && ['wrong_customer', 'missing'].includes(kind),
    method: (['debt_receipt', 'shift_funds'].includes(recordType) && kind === 'missing') || recordType === 'opening_funds',
    category: (recordType === 'drawer_expense' && ['wrong_category', 'missing'].includes(kind)) || (recordType === 'shift_funds' && kind === 'missing'),
    description: ['credit_sale', 'drawer_expense', 'shift_funds'].includes(recordType) && kind === 'missing',
    custody: recordType === 'shift_funds' && kind === 'missing',
    shift: kind === 'wrong_shift',
  };
  const request: Record<string, unknown> = { record_type: recordType, error_kind: kind };
  if (target && !['collection', 'opening_funds'].includes(recordType)) request.target_id = target.id;
  if (kind === 'missing' || ['collection', 'opening_funds'].includes(recordType)) request.shift_id = shift?.id;
  if (needs.litres) request.litres = Number(litres);
  if (needs.fuel) request.fuel_type = fuelType;
  if (needs.amount) request.amount = Number(amount);
  if (needs.collectionTotals) { request.cash_amount = Number(cashAmount); request.mpesa_amount = Number(mpesaAmount); }
  if (needs.customer) request.account_id = Number(accountId);
  if (needs.method) request.payment_method = method;
  if (needs.category) request.category = category;
  if (needs.description && description.trim()) request.description = description.trim();
  if (needs.custody) { request.source = source; request.reference = reference.trim(); }
  if (needs.shift) request.shift_id = Number(shiftId);
  if (chargeTo) request.charge_to = chargeTo;
  if (override) request.limit_override = true;
  const totalsChanged = !collection || Number(cashAmount) !== Number(target?.cash_amount)
    || Number(mpesaAmount) !== Number(target?.mpesa_amount);
  const moneyAmountChanged = !customerMoney || kind !== 'wrong_amount' || Number(amount) !== Number(target?.amount);
  const complete = Boolean(kind)
    && totalsChanged
    && moneyAmountChanged
    && (!needs.litres || Number(litres) > 0)
    && (!needs.fuel || Boolean(fuelType))
    && (!needs.amount || (customerMoney ? validCustomerCorrectionAmount(amount)
      : amount.trim() !== '' && Number.isFinite(Number(amount)) && (recordType === 'opening_funds' ? Number(amount) >= 0 : Number(amount) > 0)))
    && (!needs.collectionTotals || (validCollectionTotal(cashAmount) && validCollectionTotal(mpesaAmount)))
    && (!needs.customer || Number(accountId) > 0)
    && (!needs.method || Boolean(method))
    && (!needs.category || Boolean(category.trim()))
    && (!needs.shift || Number(shiftId) > 0)
    && (!needs.custody || (Boolean(source) && reference.trim().length > 0 && description.trim().length >= 10));
  const key = JSON.stringify(request);

  useEffect(() => {
    setPlan(null);
    if (!complete) return;
    let live = true;
    const timer = setTimeout(() => {
      api.preview(request)
        .then((r) => { if (live) setPlan({ data: r.data.data }); })
        .catch((e) => { if (live) setPlan({ error: errorText(e, 'This correction is not possible.') }); });
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [key, complete]);

  const needsChoice = Boolean(plan?.data?.needs_choice);
  const needsOverride = Boolean(plan?.data?.needs_override);
  const ready = complete && Boolean(plan?.data) && (!needsChoice || Boolean(chargeTo)) && (!needsOverride || override)
    && Boolean(reasonCode) && reasonNote.trim().length >= 10 && approver.ready;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      // The approval is for exactly this plan, reason included: preview it
      // once more and stop if anything changed since it was shown.
      const body = { ...request, reason_code: reasonCode, reason_note: reasonNote.trim() };
      const final = (await api.preview(body)).data.data;
      const previewChanged = JSON.stringify(final.effects) !== JSON.stringify(plan?.data?.effects)
        || JSON.stringify(final.shifts) !== JSON.stringify(plan?.data?.shifts);
      if (previewChanged) {
        setPlan({ data: final });
        setError('Something changed since this was shown. Check the effects again, then post.');
        return;
      }
      const approved = await approver.confirm('correction', { plan_hash: final.plan_hash });
      const posted = await api.post({
        ...body,
        plan_hash: final.plan_hash,
        ...(approved.approval_token ? { approval_token: approved.approval_token } : {}),
      });
      await onDone(posted.data.data);
    } catch (e: any) {
      console.error('[Corrections:submit]', e?.response?.data || e?.message);
      setError(errorText(e, 'The correction could not be posted.'));
    } finally {
      setBusy(false);
    }
  }

  const worse = (plan?.data?.shifts || []).filter((s: any) => s.worse && s.attendant_id);
  const others = customers.filter((c) => !target?.account_id || Number(c.id) !== Number(target.account_id));
  const label = (text: string) => <span className="text-xs text-gray-600">{text}</span>;

  return (
    <div className="space-y-3 text-sm text-gray-800">
      {target ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs text-gray-600">
          As recorded: {recordedText(recordType, target, shift)}
        </div>
      ) : (
        <p className="text-xs text-gray-600">{MISSING[recordType]} Shift #{shift?.id}{day(shift?.shift_date)}.</p>
      )}

      {recordType === 'credit_sale' && (
        <p className="text-xs text-gray-600">Correct the full credit sale, not its unpaid balance. Payments already received stay with the customer who paid and are reapplied or held as credit. Counted cash and M-Pesa stay as recorded.</p>
      )}
      {recordType === 'debt_receipt' && (
        <p className="text-xs text-gray-600">This corrects the customer's payment record and what the shift was expected to hold. Add a missing payment only when money was actually received. Counted cash and M-Pesa stay as recorded; correct the closing totals separately if that count was wrong.</p>
      )}

      {kinds.length > 1 && (
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold text-gray-700 mb-1">What was wrong?</legend>
          {kinds.map((k) => (
            <label key={k.kind} className="flex items-center gap-2">
              <input type="radio" name="error_kind" checked={kind === k.kind} onChange={() => { setKind(k.kind); setChargeTo(''); setOverride(false); }} />
              {k.label}
            </label>
          ))}
        </fieldset>
      )}

      {kind && kind !== 'duplicate' && kind !== 'wrong_method' && (
        <div className="grid grid-cols-2 gap-2">
          {needs.collectionTotals && <>
            <p className="col-span-2 text-xs text-gray-600">Enter both correct full totals. To change one, leave the other at its current amount. Zero is valid; these amounts do not have to add up to the previous total.</p>
            <label className="block">{label(balanceBased ? 'Cash remaining (KES)' : 'Correct full cash received total (KES)')}
              <input className={inputClassName} type="number" inputMode="decimal" step="0.01" min="0" max="100000000" required value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} />
            </label>
            <label className="block">{label(balanceBased ? 'M-Pesa balance at close (KES)' : 'Correct full M-Pesa received total (KES)')}
              <input className={inputClassName} type="number" inputMode="decimal" step="0.01" min="0" max="100000000" required value={mpesaAmount} onChange={(e) => setMpesaAmount(e.target.value)} />
            </label>
            {(!validCollectionTotal(cashAmount) || !validCollectionTotal(mpesaAmount)) && <p className="col-span-2 text-xs text-gray-600">Both totals are required: 0 to 100,000,000 KES, with at most two decimal places.</p>}
            {!totalsChanged && <p className="col-span-2 text-xs text-gray-500">Change at least one total to see the correction preview.</p>}
          </>}
          {needs.fuel && (
            <label className="block">{label('Fuel taken')}
              <select className={inputClassName} value={fuelType} onChange={(e) => setFuelType(e.target.value)}>
                <option value="">Choose</option>
                {['petrol', 'diesel'].filter((f) => kind === 'missing' || f !== target?.fuel_type).map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
          )}
          {needs.litres && (
            <label className="block">{label('Litres taken')}
              <input className={inputClassName} type="number" inputMode="decimal" step="0.01" min="0" value={litres} onChange={(e) => setLitres(e.target.value)} />
            </label>
          )}
          {needs.method && (
            <label className="block">{label(recordType === 'opening_funds' ? 'Opening funds method' : needs.custody ? 'Money method' : 'Paid in')}
              <select className={inputClassName} value={method} disabled={recordType === 'opening_funds' && Boolean(target?.payment_method)} onChange={(e) => setMethod(e.target.value)}>
                <option value="">Choose</option>
                <option value="cash">Cash</option>
                <option value="mpesa">M-Pesa</option>
              </select>
            </label>
          )}
          {needs.amount && (
            <label className="block">{label(recordType === 'opening_funds' ? 'Correct full opening amount (KES)' : recordType === 'credit_sale' ? 'Full credit sale amount (KES)' : recordType === 'debt_receipt' ? 'Full payment received (KES)' : 'Amount (KES)')}
              <input className={inputClassName} type="number" inputMode="decimal" step="0.01" min={customerMoney ? '0.01' : '0'} max={customerMoney ? '100000000' : undefined} value={amount} onChange={(e) => setAmount(e.target.value)} />
              {customerMoney && !validCustomerCorrectionAmount(amount) && <span className="block mt-1 text-xs text-gray-500">Enter a positive amount up to 100,000,000 KES, with at most two decimal places.</span>}
              {customerMoney && !moneyAmountChanged && <span className="block mt-1 text-xs text-gray-500">Change the full amount to see the correction preview.</span>}
            </label>
          )}
          {needs.customer && (
            <label className="block col-span-2">{label(recordType === 'debt_receipt' ? 'Customer who paid' : 'Customer who took it')}
              <select className={inputClassName} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Choose the customer</option>
                {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          {needs.category && (
            <label className="block col-span-2">{label(needs.custody ? 'Money movement' : 'Category')}
              <select className={inputClassName} value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Choose the category</option>
                {needs.custody ? <><option value="added">Money added</option><option value="removed">Money removed</option></> : categories.filter((c) => c !== target?.category).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
          {needs.custody && <>
            <label className="block col-span-2">{label(category === 'removed' ? 'Destination' : 'Source')}
              <select className={inputClassName} value={source} onChange={(e) => setSource(e.target.value)}><option value="">Choose</option><option value="station_bank_safe">Station bank / safe</option><option value="owner">Owner</option><option value="other">Other</option></select>
            </label>
            <label className="block col-span-2">{label('Reference (required)')}<input className={inputClassName} maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} /></label>
          </>}
          {needs.description && (
            <label className="block col-span-2">{label(needs.custody ? 'Source / destination explanation (at least 10 characters)' : 'Description (optional)')}
              <input className={inputClassName} maxLength={needs.custody ? 1000 : 200} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
          )}
          {needs.shift && (
            <label className="block col-span-2">{label('The right shift (shift number, from Shifts)')}
              <input className={inputClassName} type="number" inputMode="numeric" min="1" value={shiftId} onChange={(e) => setShiftId(e.target.value)} />
            </label>
          )}
        </div>
      )}

      {plan?.error && <p className="text-xs text-red-700">{plan.error}</p>}
      {plan?.data && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs text-gray-800">
          <p className="font-semibold mb-1">What this correction does</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {plan.data.effects.map((effect: string, i: number) => <li key={i}>{effect}</li>)}
          </ul>
          {(collection || customerMoney) && (plan.data.shifts || []).map((impact: any) => (
            <p key={impact.shift_id} className="font-semibold mt-2">Shift #{impact.shift_id} result after correction: {result(Number(impact.corrected))}.</p>
          ))}
        </div>
      )}

      {needsOverride && (
        <label className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={override} onChange={(e) => setOverride(e.target.checked)} />
          <span>Approve going past the customer's credit limit with this correction.</span>
        </label>
      )}

      {needsChoice && (
        <fieldset className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs">
          <legend className="font-semibold text-gray-800 px-1">Who carries it?</legend>
          <p className="text-gray-700">
            {worse.map((s: any) => `Shift #${s.shift_id} (${s.attendant_name || 'no attendant'}) gets worse by ${kes(-s.change)}.`).join(' ')}
          </p>
          <label className="flex items-center gap-2">
            <input type="radio" name="charge_to" checked={chargeTo === 'attendant'} onChange={() => setChargeTo('attendant')} />
            The attendant (normal rules: it adds to their shortage on that shift)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="charge_to" checked={chargeTo === 'station'} onChange={() => setChargeTo('station')} />
            The station (not their doing)
          </label>
        </fieldset>
      )}

      {plan?.data && (
        <>
          <label className="block">{label('Reason')}
            <select className={inputClassName} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              <option value="">Choose a reason</option>
              {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
          </label>
          <label className="block">{label('What happened (at least 10 characters)')}
            <textarea className={inputClassName} rows={2} maxLength={500} value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} />
          </label>
          <ApproverFields state={approver} inputClassName={inputClassName} />
        </>
      )}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-gray-700">Cancel</button>
        <button type="button" onClick={() => void submit()} disabled={busy || !ready}
          className="px-3 py-2 rounded-lg text-white font-medium bg-blue-600 disabled:opacity-50">
          {busy ? 'Posting…' : recordType === 'shift_funds' ? target ? 'Reverse movement' : 'Record movement' : 'Post the correction'}
        </button>
      </div>
    </div>
  );
}

// Undoing a correction made in error: a new correction that cancels it.
export function CorrectionUndo({
  correction,
  api,
  approval,
  onDone,
  onCancel,
  inputClassName = field,
}: {
  correction: { id: number; number: string };
  api: CorrectionApi;
  approval?: ApprovalApi;
  onDone: (undo: any) => Promise<void> | void;
  onCancel: () => void;
  inputClassName?: string;
}) {
  const approver = useApprover(approval);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const approved = await approver.confirm('correction_undo', { correction_id: correction.id });
      const done = await api.undo(correction.id, {
        reason_note: reason.trim(),
        ...(approved.approval_token ? { approval_token: approved.approval_token } : {}),
      });
      await onDone(done.data.data);
    } catch (e: any) {
      console.error('[Corrections:undo]', e?.response?.data || e?.message);
      setError(errorText(e, 'The correction could not be undone.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm text-gray-800">
      <p className="text-xs text-gray-600">
        A new correction cancels {correction.number} exactly: the record it reversed comes back, the one it added is reversed, and
        anything it did to the attendant is cancelled.
      </p>
      <label className="block"><span className="text-xs text-gray-600">Why (at least 10 characters)</span>
        <textarea className={inputClassName} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <ApproverFields state={approver} inputClassName={inputClassName} />
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-gray-700">Cancel</button>
        <button type="button" onClick={() => void submit()} disabled={busy || reason.trim().length < 10 || !approver.ready}
          className="px-3 py-2 rounded-lg text-white font-medium bg-red-600 disabled:opacity-50">
          {busy ? 'Undoing…' : `Undo ${correction.number}`}
        </button>
      </div>
    </div>
  );
}

const result = (value: number) => (value < 0 ? `short ${kes(-value)}` : value > 0 ? `over ${kes(value)}` : 'balanced');

export function OriginalCloseFigures({ figures, formatMoney }: {
  figures: Record<string, unknown> | null | undefined;
  formatMoney: (amount: number) => string;
}) {
  if (!figures) return null;
  const balances = figures.reconciliation_basis === 'balances_v1';
  const rows = [
    ['expected_sales', 'Expected sales'], ['expected_shift_total', balances ? 'Total to account for' : 'Expected shift total'],
    ...(balances ? [
      ['opening_cash_amount', 'Opening cash float'], ['opening_mpesa_amount', 'Opening M-Pesa balance'],
      ['funds_added_total', 'Money added'], ['funds_removed_total', 'Money removed'],
      ['expected_closing', 'Expected closing funds'], ['inferred_collections', 'Collections inferred from counted funds'], ['expected_receipts', 'Expected receipts'],
    ] : []),
    ['total_cash', balances ? 'Cash remaining' : 'Cash'], ['total_mpesa', balances ? 'M-Pesa balance at close' : 'M-Pesa'], ['total_credit_receipts', 'Debt receipts included'],
    ['total_credits', 'Credits issued'], ['total_invoice_consumption', 'Invoice fuel value'],
    ['total_expenses', 'Expenses'], ['employee_wage', 'Direct wage payment'],
    ['total_payroll_payments', 'Other payroll payments'], ['total_accounted', 'Total accounted'], ['variance', 'Over / short'],
  ];
  return (
    <details className="mt-3 border-t pt-2 text-sm">
      <summary className="cursor-pointer text-blue-700">View original figures</summary>
      <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
        {rows.map(([key, label]) => (
          <div key={key} className="flex justify-between gap-3"><dt className="text-gray-500">{label}</dt><dd>{formatMoney(Number(figures[key] ?? 0))}</dd></div>
        ))}
      </dl>
    </details>
  );
}

// On a closed shift: corrections alongside its preserved original close.
export function ShiftCorrectionsBanner({ corrections, asClosed }: { corrections: any; asClosed: number }) {
  if (!corrections?.lines?.length) return null;
  const numbers = [...new Set(corrections.lines.map((l: any) => l.number))];
  const laterNumbers = new Set(corrections.lines.filter((line: any) => !line.shift_open).map((line: any) => line.number));
  const byNumber = numbers.map((number) => ({ number, lines: corrections.lines.filter((l: any) => l.number === number) }));
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-gray-800 space-y-1">
      <p className="font-semibold">
        {laterNumbers.size > 0 ? `${laterNumbers.size} correction${laterNumbers.size === 1 ? '' : 's'} since close` : 'Recorded amendments included in the original close'}: result at close {result(asClosed)}; current result{' '}
        {result(Number(corrections.current_variance ?? corrections.corrected_variance ?? asClosed))}.
      </p>
      <p className="text-xs text-gray-600">The original close is preserved. Current figures include the corrections recorded since.</p>
      <ul className="text-xs space-y-0.5">
        {byNumber.map(({ number, lines }: any) => {
          const change = lines.reduce((sum: number, l: any) => sum + Number(l.shift_effect || 0), 0);
          const first = lines[0];
          const includedAtClose = lines.every((line: any) => Boolean(line.shift_open));
          return (
            <li key={number}>
              <strong>{number}</strong> ({String(first.posting_date).slice(0, 10)}{first.status === 'undone' ? ', undone' : ''}):{' '}
              {correctionTitle(first.record_type, first.error_kind)}
              {lines.map((l: any, i: number) => <span key={i}> · {lineText(l)}</span>)}
              {' '}· {includedAtClose ? 'included in the original close' : change === 0 ? 'the result does not change' : `shift ${change > 0 ? 'better' : 'worse'} by ${kes(Math.abs(change))}`}
              {change < 0 && first.charge_to ? ` (${first.charge_to === 'station' ? 'the station carries it' : 'the attendant carries it'})` : ''}
              {first.reason_note ? `: ${first.reason_note}` : ''}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
