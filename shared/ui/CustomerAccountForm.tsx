import { useState, type FormEvent } from 'react';

// The one form for credit customers, on both platforms. Customers come into
// existence only here: shift credit entry is select-only. Limits are optional -
// blank means no rule - and a breach needs an administrator's approval rather
// than refusing the sale (backend services/creditLimits.ts).
const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900';
const label = 'block text-sm font-medium text-gray-700 mb-1';

type BillingMode = 'money' | 'invoice';

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));
const blankToNull = (value: string) => (value.trim() === '' ? null : Number(value));

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function CustomerAccountForm({
  account,
  lockBillingMode,
  onSubmit,
  onCancel,
  inputClassName = field,
}: {
  account?: any;
  lockBillingMode?: BillingMode;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  inputClassName?: string;
}) {
  const editing = Boolean(account?.id);
  const [form, setForm] = useState({
    name: text(account?.name),
    phone: text(account?.phone),
    kra_pin: text(account?.kra_pin),
    billing_mode: (lockBillingMode || (account?.billing_mode === 'invoice' ? 'invoice' : 'money')) as BillingMode,
    payment_terms_days: text(account?.payment_terms_days ?? 0),
    credit_limit: text(account?.credit_limit),
    credit_age_limit_days: text(account?.credit_age_limit_days),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = (key: keyof typeof form) => (event: any) => setForm({ ...form, [key]: event.target.value });

  // Customers saved before phones were required may still have none.
  const phoneRequired = !editing || Boolean(account?.phone);
  const invoice = form.billing_mode === 'invoice';

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
  const terms = Number(form.payment_terms_days || 0);
  const limitDays = form.credit_age_limit_days.trim() === '' ? null : Number(form.credit_age_limit_days);
  const example = limitDays === null || !Number.isInteger(limitDays) || limitDays < 0 || !Number.isInteger(terms)
    ? null
    : invoice
      ? `An invoice issued today would be due ${addDays(today, terms)}. If it is still unpaid, more fuel on account needs an administrator's approval from ${addDays(today, terms + limitDays + 1)}.`
      : `If credit given today is still unpaid, more credit needs an administrator's approval from ${addDays(today, limitDays + 1)}.`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit({
        name: form.name.trim(),
        phone: form.phone.trim(),
        kra_pin: form.kra_pin.trim(),
        billing_mode: form.billing_mode,
        payment_terms_days: invoice ? Number(form.payment_terms_days || 0) : 0,
        credit_limit: blankToNull(form.credit_limit),
        credit_age_limit_days: blankToNull(form.credit_age_limit_days),
      });
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'The customer could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <label className="block">
        <span className={label}>Name *</span>
        <input required maxLength={120} className={inputClassName} value={form.name} onChange={change('name')} />
      </label>
      <label className="block">
        <span className={label}>Phone{phoneRequired ? ' *' : ''}</span>
        <input
          required={phoneRequired}
          type="tel"
          inputMode="tel"
          className={inputClassName}
          value={form.phone}
          onChange={change('phone')}
          placeholder="e.g. 0712345678"
        />
        {!phoneRequired && (
          <span className="block text-xs text-amber-700 mt-1">No phone number on file. Add one when you have it.</span>
        )}
      </label>
      <label className="block">
        <span className={label}>KRA PIN (optional)</span>
        <input
          className={inputClassName}
          value={form.kra_pin}
          onChange={(event) => setForm({ ...form, kra_pin: event.target.value.toUpperCase() })}
          maxLength={11}
          autoCapitalize="characters"
          placeholder="e.g. A012345678Z"
        />
      </label>

      {!lockBillingMode && (
        <div>
          <span className={label}>Billing *</span>
          <div className="flex gap-2">
            {(['money', 'invoice'] as BillingMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setForm({ ...form, billing_mode: mode })}
                className={`flex-1 p-2 rounded-lg border text-sm font-medium ${
                  form.billing_mode === mode
                    ? mode === 'invoice' ? 'bg-purple-100 border-purple-400 text-purple-800' : 'bg-gray-100 border-gray-400 text-gray-800'
                    : 'bg-white border-gray-300 text-gray-500'
                }`}
              >
                {mode === 'money' ? 'Money' : 'Invoice'}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-1.5">
            {invoice
              ? 'Billed on invoice: shifts record litres per fuel type, and the invoice is issued later at an agreed price. Invoice customers are managed from Customer Invoices.'
              : 'Shift credits record a money amount owed.'}
          </p>
        </div>
      )}

      {invoice && (
        <label className="block">
          <span className={label}>Payment terms</span>
          <span className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Net</span>
            <input type="number" min="0" max="365" step="1" className={`${inputClassName} max-w-[6rem]`} value={form.payment_terms_days} onChange={change('payment_terms_days')} />
            <span className="text-sm text-gray-500">days</span>
          </span>
        </label>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={label}>Credit limit (KES)</span>
          <input type="number" min="0" step="0.01" className={inputClassName} value={form.credit_limit} onChange={change('credit_limit')} placeholder="No limit" />
        </label>
        <label className="block">
          <span className={label}>{invoice ? 'Repayment limit (days past due)' : 'Repayment limit (days)'}</span>
          <input type="number" min="0" max="365" step="1" className={inputClassName} value={form.credit_age_limit_days} onChange={change('credit_age_limit_days')} placeholder="No limit" />
        </label>
      </div>
      <p className="text-xs text-gray-500">
        {invoice
          ? 'Going over the credit limit, or having an invoice unpaid for more than the repayment limit past its due date, needs an administrator’s approval before more fuel on account. Leave blank for no limit.'
          : 'Going over the credit limit, or having credit unpaid for more than the repayment limit, needs an administrator’s approval before more credit. Leave blank for no limit.'}
      </p>
      {example && <p className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded p-2">{example}</p>}

      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onCancel} className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50">
          Cancel
        </button>
        <button type="submit" disabled={busy} className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'Saving…' : editing ? 'Save' : 'Create'}
        </button>
      </div>
    </form>
  );
}

// A one-line summary of a customer's limits and whether they are breached now,
// from the credit_check the accounts API returns for customers with limits.
export function CreditLimitSummary({ account }: { account: any }) {
  const kes = (value: any) => `KES ${Number(value).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
  const parts = [
    account.credit_limit != null ? `Limit ${kes(account.credit_limit)}` : null,
    account.credit_age_limit_days != null ? `${account.credit_age_limit_days} days` : null,
  ].filter(Boolean);
  if (parts.length === 0) return <span className="text-xs text-gray-400">No limits</span>;
  const rules = (account.credit_check?.breaches || []).map((breach: any) => breach.rule);
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-xs text-gray-600">
      <span>{parts.join(' · ')}</span>
      {rules.includes('credit_limit') && <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">Over limit</span>}
      {rules.includes('repayment_limit') && <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">Overdue</span>}
    </span>
  );
}

// A customer's limits, what breaches them right now, and the credits an
// administrator allowed past them (credit_limit_overrides).
export function CreditLimitDetails({ account }: { account: any }) {
  const overrides = account.limit_overrides || [];
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700 mb-1">Credit limits</h4>
      <div className="mb-2 text-sm">
        <CreditLimitSummary account={account} />
        {account.kra_pin && <span className="ml-3 text-xs text-gray-500">KRA PIN {account.kra_pin}</span>}
      </div>
      {(account.credit_check?.breaches || []).map((breach: any) => (
        <p key={breach.rule} className="text-xs text-red-700">{breach.message}</p>
      ))}
      {overrides.length > 0 && (
        <div className="border rounded-lg overflow-hidden mt-2">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="text-left p-2 text-gray-600 font-medium">When</th>
                <th className="text-right p-2 text-gray-600 font-medium">Amount</th>
                <th className="text-left p-2 text-gray-600 font-medium">Limit exceeded</th>
                <th className="text-left p-2 text-gray-600 font-medium">Approved by</th>
              </tr>
            </thead>
            <tbody>
              {overrides.map((override: any) => (
                <tr key={override.id} className="border-t align-top">
                  <td className="p-2 text-gray-500 whitespace-nowrap">
                    {new Date(override.created_at).toLocaleDateString('en-KE')} · Shift #{override.shift_id}
                  </td>
                  <td className="p-2 text-right">{`KES ${Number(override.amount).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`}</td>
                  <td className="p-2 text-gray-600">{override.breaches.map((breach: any) => breach.message).join(' ')}</td>
                  <td className="p-2">
                    {override.approved_by_name}
                    {override.recorded_by_name && override.recorded_by_name !== override.approved_by_name && (
                      <span className="block text-xs text-gray-500">for {override.recorded_by_name}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
