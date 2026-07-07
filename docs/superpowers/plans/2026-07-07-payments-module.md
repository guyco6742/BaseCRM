# Payments Module Implementation Plan (Handover Doc)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each BaseCRM organization record payments from its clients (manual ledger) and charge them online via Cardcom hosted payment pages with automatic invoice/receipt issuing.

**Architecture:** Per-org PSP credentials stored admin-only; all PSP API calls and webhooks go through Supabase Edge Functions (the project's first server-side code) behind a provider-agnostic adapter; payments live in a `payments` ledger table rendered on the client card and an org-wide payments page.

**Tech Stack:** React 19 + Vite (plain JSX, no TS in frontend), Tailwind v4, Supabase (Postgres + RLS + Edge Functions in Deno/TypeScript), react-router v7, Netlify hosting.

**Spec:** `docs/superpowers/specs/2026-07-07-payments-design.md` — read it first.

## Project Orientation (read before touching anything)

- **App:** Monday.com-style multi-tenant CRM, **Hebrew RTL, dark theme**. All UI copy in Hebrew. Deployed at https://basecrm-app.netlify.app.
- **Supabase project ref:** `iezgyetfwgmlczcrnrvx`. Migrations are plain `.sql` files in `supabase/` numbered `migration_NNN_*.sql`; they are applied **manually** by the user in the Supabase Dashboard SQL editor (or via Supabase MCP `apply_migration`). Migrations 001–013 are applied. **You write the file; ask the user to apply it before testing DB-dependent steps.**
- **Multi-tenancy:** every table carries denormalized `org_id`; RLS uses helper functions `public.is_org_member(org_id)` / `public.is_org_admin(org_id)` (both SECURITY DEFINER, defined in `supabase/schema.sql`, already treat super-admins as members/admins).
- **HARD RULE — no physical deletes:** soft-delete via `is_archived boolean`; **never create a DELETE RLS policy**.
- **Conventions:** `data-testid` on every interactive element; `handleEnterAsTab` from `src/lib/formNav.js` wired as `onKeyDown` on forms; toasts via `useToast()` from `src/context/ToastContext`; confirms via `useConfirm()` from `src/context/ConfirmContext`; org context via `useOrg()` from OrgLayout (gives `orgId`, `isAdmin`, `members`).
- **UI kit:** `src/components/ui/` — `Modal` (`{open, onClose, title, children, footer, size, testid}`), `Button` (`{variant: primary|secondary|ghost|danger, size, loading}`), `Input` (`{label, ...props}`).
- **Worktree gotcha:** `.env` is gitignored. In a fresh worktree copy it from the main repo (`cp <main-repo>/.env .env`) or the app silently runs against a placeholder Supabase URL. Also kill any stray `npm run dev` from the main repo before starting yours (port 5173 collision).
- **Build/lint:** `npm run build`, `npm run lint` (oxlint). There is currently **no test runner** — Task 2 adds vitest.
- **Deploy:** `npm run build` then `netlify deploy --prod --dir=dist --no-build` (CLI already logged in). Edge Functions deploy separately (Task 6).

## Global Constraints

- Currency fixed to `'ILS'`; amounts `numeric(12,2)`, must be `> 0`.
- Payment statuses exactly: `'pending' | 'paid' | 'failed' | 'canceled' | 'refunded'`.
- Payment methods exactly: `'credit_card' | 'bit' | 'cash' | 'bank_transfer' | 'check' | 'other'`.
- Providers exactly: `'cardcom' | 'grow' | 'payplus'` (only cardcom implemented now).
- PSP credentials must never be readable by non-admin org members and never appear in the frontend bundle.
- Provider-linked payments (rows with `provider_ref`) settle only server-side; client-side status flips are blocked by trigger.
- All new UI in Hebrew, RTL-safe, with `data-testid`.
- No DELETE policies anywhere.

## Milestones

- **Milestone 1 (Tasks 1–4): manual ledger** — ships value with no PSP account.
- **Milestone 2 (Tasks 5–9): Cardcom online payments** — requires a Cardcom account (sandbox first).
- **Milestone 3: recurring charges (הוראת קבע)** — deliberately NOT planned here. Write a fresh plan after Milestone 2 ships and real Cardcom recurring-API behavior is known. Installments ARE included (a parameter on the payment link).

---

### Task 1: Database migration — payments ledger + provider accounts

**Files:**
- Create: `supabase/migration_014_payments.sql`

**Interfaces:**
- Produces: tables `public.payments`, `public.payment_provider_accounts`, `public.payment_subscriptions` with RLS; trigger `protect_provider_payment_fields`. All later tasks depend on these exact column names.

- [ ] **Step 1: Write the migration file**

```sql
-- migration_014_payments.sql — מודול תשלומים (שלב א: לקוחות משלמים לארגון)
-- ראו docs/superpowers/specs/2026-07-07-payments-design.md

-- חשבון סליקה של הארגון (Cardcom וכו') — קריאה/כתיבה לאדמינים בלבד
create table if not exists public.payment_provider_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'cardcom' check (provider in ('cardcom','grow','payplus')),
  display_name text,
  credentials jsonb not null default '{}'::jsonb,  -- cardcom: { terminal_number, api_name, api_password }
  settings jsonb not null default '{}'::jsonb,     -- { auto_invoice: true, document_type: 'invoice_receipt', language: 'he' }
  is_active boolean not null default true,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- יומן תשלומים — שורה לכל חיוב/תשלום
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  provider_account_id uuid references public.payment_provider_accounts(id),
  kind text not null default 'one_time' check (kind in ('one_time','subscription_charge')),
  method text check (method in ('credit_card','bit','cash','bank_transfer','check','other')),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'ILS',
  description text,
  status text not null default 'pending' check (status in ('pending','paid','failed','canceled','refunded')),
  due_date date,
  paid_at timestamptz,
  payment_link text,
  provider_ref text unique,        -- מזהה עסקה אצל הספק — מפתח אידמפוטנטיות ל-webhook
  invoice_url text,
  invoice_number text,
  raw_webhook jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- הוראות קבע (שלב ג — הטבלה מוכנה, אין UI עדיין)
create table if not exists public.payment_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  provider_account_id uuid references public.payment_provider_accounts(id),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'ILS',
  description text,
  day_of_month int check (day_of_month between 1 and 28),
  status text not null default 'active' check (status in ('active','paused','canceled')),
  provider_ref text unique,
  next_charge_at timestamptz,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payments_org on public.payments(org_id);
create index if not exists idx_payments_client on public.payments(client_id);
create index if not exists idx_payments_org_status on public.payments(org_id, status);
create index if not exists idx_ppa_org on public.payment_provider_accounts(org_id);
create index if not exists idx_psub_org on public.payment_subscriptions(org_id);

-- updated_at אוטומטי (משתמש בפונקציה הקיימת set_updated_at אם קיימת; אחרת יוצר)
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists payments_updated_at on public.payments;
create trigger payments_updated_at before update on public.payments
  for each row execute function public.tg_set_updated_at();
drop trigger if exists psub_updated_at on public.payment_subscriptions;
create trigger psub_updated_at before update on public.payment_subscriptions
  for each row execute function public.tg_set_updated_at();

-- הקשחה: תשלום שמקושר לספק (provider_ref) — שדות הסליקה משתנים רק דרך service_role (webhook)
create or replace function public.protect_provider_payment_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.provider_ref is not null
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    if new.status is distinct from old.status
       or new.paid_at is distinct from old.paid_at
       or new.invoice_url is distinct from old.invoice_url
       or new.invoice_number is distinct from old.invoice_number
       or new.provider_ref is distinct from old.provider_ref
       or new.amount is distinct from old.amount then
      raise exception 'payment settled by provider — fields are read-only';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists protect_provider_payment on public.payments;
create trigger protect_provider_payment before update on public.payments
  for each row execute function public.protect_provider_payment_fields();

-- RLS
alter table public.payment_provider_accounts enable row level security;
alter table public.payments enable row level security;
alter table public.payment_subscriptions enable row level security;

-- חשבון סליקה: אדמינים בלבד (כמו lead_sources)
create policy ppa_select on public.payment_provider_accounts for select using (public.is_org_admin(org_id));
create policy ppa_insert on public.payment_provider_accounts for insert with check (public.is_org_admin(org_id));
create policy ppa_update on public.payment_provider_accounts for update using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
-- אין policy למחיקה — מחיקה רכה בלבד

-- תשלומים: כל חברי הארגון
create policy payments_select on public.payments for select using (public.is_org_member(org_id));
create policy payments_insert on public.payments for insert with check (public.is_org_member(org_id));
create policy payments_update on public.payments for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- הוראות קבע: חברי הארגון רואים, אדמינים מנהלים
create policy psub_select on public.payment_subscriptions for select using (public.is_org_member(org_id));
create policy psub_insert on public.payment_subscriptions for insert with check (public.is_org_admin(org_id));
create policy psub_update on public.payment_subscriptions for update using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
```

- [ ] **Step 2: Sanity-check the SQL locally**

Run: `npx --yes sql-formatter --help` is NOT needed — just eyeball. Then verify the file parses by asking the user to run it, OR if Supabase MCP is available run `apply_migration` with name `migration_014_payments`.
Expected: applies cleanly; `list_tables` (or Dashboard) shows the 3 tables with RLS enabled.

- [ ] **Step 3: Verify RLS from anon (pen-test snippet)**

With the anon key from `.env` (`VITE_SUPABASE_ANON_KEY`):
```bash
curl -s "https://iezgyetfwgmlczcrnrvx.supabase.co/rest/v1/payments?select=*" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
```
Expected: `[]` (empty — no anon access).

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_014_payments.sql
git commit -m "feat(payments): migration 014 - payments ledger, provider accounts, subscriptions"
```

---

### Task 2: Pure payments logic + vitest setup

**Files:**
- Modify: `package.json` (add vitest devDependency + `"test": "vitest run"` script)
- Create: `src/lib/payments.js`
- Test: `src/lib/payments.test.js`

**Interfaces:**
- Produces (used by Tasks 3–4 and 8):
  - `PAYMENT_STATUSES` — `{ [status]: { label, chipClass } }`
  - `PAYMENT_METHODS` — `{ [method]: { label } }`
  - `formatAmount(amount, currency='ILS') => string` (e.g. `'₪1,200.50'`)
  - `sumByStatus(payments) => { pending: number, paid: number }` (ignores archived rows)
  - `filterPayments(payments, { status, clientId, from, to }) => payments[]`
  - `paymentToCSVRow(payment, clientName) => string[]` and `PAYMENT_CSV_HEADERS` — array of Hebrew headers

- [ ] **Step 1: Install vitest and add script**

```bash
npm install -D vitest
```
In `package.json` scripts add: `"test": "vitest run"`.

- [ ] **Step 2: Write the failing tests**

```js
// src/lib/payments.test.js
import { describe, it, expect } from 'vitest'
import {
  PAYMENT_STATUSES, PAYMENT_METHODS, formatAmount,
  sumByStatus, filterPayments, paymentToCSVRow, PAYMENT_CSV_HEADERS,
} from './payments'

const p = (over = {}) => ({
  id: 'x', amount: 100, currency: 'ILS', status: 'pending', method: 'cash',
  description: 'חוג', client_id: 'c1', paid_at: null, due_date: null,
  created_at: '2026-07-01T10:00:00Z', is_archived: false, ...over,
})

describe('payments lib', () => {
  it('has Hebrew labels for every status and method', () => {
    for (const s of ['pending', 'paid', 'failed', 'canceled', 'refunded']) {
      expect(PAYMENT_STATUSES[s].label).toBeTruthy()
      expect(PAYMENT_STATUSES[s].chipClass).toBeTruthy()
    }
    for (const m of ['credit_card', 'bit', 'cash', 'bank_transfer', 'check', 'other']) {
      expect(PAYMENT_METHODS[m].label).toBeTruthy()
    }
  })

  it('formats ILS amounts', () => {
    // לא משווים למחרוזת מלאה — Intl מוסיף תווי כיווניות שתלויים בסביבת הריצה
    expect(formatAmount(1200.5)).toMatch(/1,200\.50/)
    expect(formatAmount(1200.5)).toMatch(/₪/)
  })

  it('sums pending and paid, skipping archived', () => {
    const rows = [p(), p({ status: 'paid', amount: 50 }), p({ status: 'paid', amount: 25, is_archived: true }), p({ status: 'failed' })]
    expect(sumByStatus(rows)).toEqual({ pending: 100, paid: 50 })
  })

  it('filters by status, client and date range', () => {
    const rows = [
      p({ id: 'a', status: 'paid', client_id: 'c1', created_at: '2026-01-05T00:00:00Z' }),
      p({ id: 'b', status: 'paid', client_id: 'c2', created_at: '2026-02-05T00:00:00Z' }),
      p({ id: 'c', status: 'pending', client_id: 'c1', created_at: '2026-03-05T00:00:00Z' }),
    ]
    expect(filterPayments(rows, { status: 'paid' }).map(r => r.id)).toEqual(['a', 'b'])
    expect(filterPayments(rows, { clientId: 'c1' }).map(r => r.id)).toEqual(['a', 'c'])
    expect(filterPayments(rows, { from: '2026-02-01', to: '2026-02-28' }).map(r => r.id)).toEqual(['b'])
    expect(filterPayments(rows, {}).length).toBe(3)
  })

  it('builds a CSV row matching the headers length', () => {
    const row = paymentToCSVRow(p({ status: 'paid', paid_at: '2026-07-02T08:00:00Z' }), 'משפחת כהן')
    expect(row.length).toBe(PAYMENT_CSV_HEADERS.length)
    expect(row).toContain('משפחת כהן')
    expect(row.join(',')).toMatch(/שולם/)
  })
})
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `npx vitest run src/lib/payments.test.js`
Expected: FAIL — cannot resolve `./payments`.

- [ ] **Step 4: Implement `src/lib/payments.js`**

```js
// לוגיקה טהורה של מודול התשלומים — ללא תלות ב-React/Supabase (ניתן לבדיקה ביחידה)

export const PAYMENT_STATUSES = {
  pending:  { label: 'ממתין לתשלום', chipClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  paid:     { label: 'שולם',          chipClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  failed:   { label: 'נכשל',          chipClass: 'bg-red-500/15 text-red-400 border-red-500/30' },
  canceled: { label: 'בוטל',          chipClass: 'bg-red-500/15 text-red-400 border-red-500/30' },
  refunded: { label: 'זוכה',          chipClass: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
}

export const PAYMENT_METHODS = {
  credit_card:   { label: 'כרטיס אשראי' },
  bit:           { label: 'ביט' },
  cash:          { label: 'מזומן' },
  bank_transfer: { label: 'העברה בנקאית' },
  check:         { label: 'צ׳ק' },
  other:         { label: 'אחר' },
}

export function formatAmount(amount, currency = 'ILS') {
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency, minimumFractionDigits: 2 }).format(Number(amount) || 0)
}

export function sumByStatus(payments) {
  const acc = { pending: 0, paid: 0 }
  for (const p of payments || []) {
    if (p.is_archived) continue
    if (p.status === 'pending') acc.pending += Number(p.amount) || 0
    if (p.status === 'paid') acc.paid += Number(p.amount) || 0
  }
  return acc
}

export function filterPayments(payments, { status, clientId, from, to } = {}) {
  return (payments || []).filter((p) => {
    if (status && p.status !== status) return false
    if (clientId && p.client_id !== clientId) return false
    const t = new Date(p.created_at).getTime()
    if (from && t < new Date(from + 'T00:00:00').getTime()) return false
    if (to && t > new Date(to + 'T23:59:59').getTime()) return false
    return true
  })
}

export const PAYMENT_CSV_HEADERS = ['תאריך', 'לקוח', 'תיאור', 'סכום', 'אמצעי', 'סטטוס', 'שולם בתאריך', 'מס׳ חשבונית']

export function paymentToCSVRow(p, clientName) {
  const d = (v) => (v ? new Date(v).toLocaleDateString('he-IL') : '')
  return [
    d(p.created_at),
    clientName || '',
    p.description || '',
    String(p.amount ?? ''),
    p.method ? PAYMENT_METHODS[p.method]?.label || p.method : '',
    PAYMENT_STATUSES[p.status]?.label || p.status,
    d(p.paid_at),
    p.invoice_number || '',
  ]
}
```

- [ ] **Step 5: Run tests, verify they pass; run lint**

Run: `npx vitest run src/lib/payments.test.js && npm run lint`
Expected: all tests PASS, lint clean.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/payments.js src/lib/payments.test.js
git commit -m "feat(payments): pure payments logic + vitest setup"
```

---

### Task 3: Client-card payments section + add-payment modal (manual mode)

**Files:**
- Create: `src/components/crm/PaymentsSection.jsx`
- Create: `src/components/crm/AddPaymentModal.jsx`
- Modify: `src/pages/ClientPage.jsx` — mount `<PaymentsSection />` right after the contacts `<section>` (search for `data-testid="client-contacts"`, add after its closing `</section>`).

**Interfaces:**
- Consumes: Task 1 tables, Task 2 lib.
- Produces: `<PaymentsSection orgId clientId clientName clientPhone />`; `<AddPaymentModal open onClose orgId clientId onSaved />`. Task 8 extends AddPaymentModal with a link mode — keep the manual form in its own component function so the mode switch is additive.

- [ ] **Step 1: Create `AddPaymentModal.jsx`**

```jsx
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { PAYMENT_METHODS } from '../../lib/payments'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import { handleEnterAsTab } from '../../lib/formNav'

// מצב "רישום ידני" — תשלום שנגבה מחוץ למערכת (מזומן/העברה/צ׳ק)
export default function AddPaymentModal({ open, onClose, orgId, clientId, onSaved }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [method, setMethod] = useState('cash')
  const [alreadyPaid, setAlreadyPaid] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(e) {
    e.preventDefault()
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('יש להזין סכום חיובי.'); return }
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('payments').insert({
      org_id: orgId,
      client_id: clientId,
      amount: amt,
      description: description.trim() || null,
      method,
      status: alreadyPaid ? 'paid' : 'pending',
      paid_at: alreadyPaid ? new Date().toISOString() : null,
      created_by: user?.id ?? null,
    })
    setSaving(false)
    if (err) { setError('שמירת התשלום נכשלה.'); return }
    toast('התשלום נשמר')
    setAmount(''); setDescription(''); setMethod('cash'); setAlreadyPaid(true)
    onSaved?.()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="הוספת תשלום" testid="add-payment-modal">
      <form onSubmit={save} onKeyDown={handleEnterAsTab} className="space-y-3">
        <Input label="סכום (₪)" type="number" step="0.01" min="0" value={amount}
          onChange={(e) => setAmount(e.target.value)} data-testid="payment-amount-input" required />
        <Input label="תיאור" value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="למשל: חוג ג׳ודו — יולי" data-testid="payment-description-input" />
        <label className="block">
          <span className="mb-1 block text-sm text-text-muted">אמצעי תשלום</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)}
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text outline-none focus:border-accent"
            data-testid="payment-method-select">
            {Object.entries(PAYMENT_METHODS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={alreadyPaid} onChange={(e) => setAlreadyPaid(e.target.checked)}
            data-testid="payment-already-paid-checkbox" />
          התשלום כבר בוצע
        </label>
        {error && <p className="text-sm text-status-red" data-testid="payment-error">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>ביטול</Button>
          <Button type="submit" loading={saving} data-testid="payment-save-btn">שמירה</Button>
        </div>
      </form>
    </Modal>
  )
}
```

- [ ] **Step 2: Create `PaymentsSection.jsx`**

```jsx
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import { PAYMENT_STATUSES, PAYMENT_METHODS, formatAmount, sumByStatus } from '../../lib/payments'
import Button from '../ui/Button'
import AddPaymentModal from './AddPaymentModal'

export function PaymentStatusChip({ status }) {
  const s = PAYMENT_STATUSES[status] || { label: status, chipClass: '' }
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${s.chipClass}`}
      data-testid={`payment-status-${status}`}>{s.label}</span>
  )
}

// היסטוריית תשלומים בכרטיס לקוח
export default function PaymentsSection({ orgId, clientId }) {
  const { toast } = useToast()
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('client_id', clientId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
    if (error) toast('טעינת התשלומים נכשלה (ודאו שמיגרציה 014 רצה).', 'error')
    else setPayments(data || [])
    setLoading(false)
  }, [clientId, toast])

  useEffect(() => { load() }, [load])

  async function markPaid(p) {
    const { error } = await supabase.from('payments')
      .update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', p.id)
    if (error) { toast('העדכון נכשל.', 'error'); return }
    await load()
  }

  async function archivePayment(p) {
    const { error } = await supabase.from('payments').update({ is_archived: true }).eq('id', p.id)
    if (error) { toast('הארכוב נכשל.', 'error'); return }
    await load()
  }

  const totals = sumByStatus(payments)

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="client-payments">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-text">תשלומים</h2>
        <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)} data-testid="payment-add-btn">
          + הוסף תשלום
        </Button>
      </div>
      <div className="mb-3 flex gap-4 text-sm text-text-muted" data-testid="payments-totals">
        <span>שולם: <b className="text-text">{formatAmount(totals.paid)}</b></span>
        <span>ממתין: <b className="text-text">{formatAmount(totals.pending)}</b></span>
      </div>
      {loading ? (
        <p className="text-sm text-text-dim">טוען…</p>
      ) : payments.length === 0 ? (
        <p className="text-sm text-text-dim" data-testid="payments-empty">אין תשלומים עדיין.</p>
      ) : (
        <ul className="divide-y divide-border">
          {payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-2" data-testid={`payment-row-${p.id}`}>
              <span className="text-sm text-text-dim">{new Date(p.created_at).toLocaleDateString('he-IL')}</span>
              <span className="font-medium text-text">{formatAmount(p.amount)}</span>
              <span className="flex-1 truncate text-sm text-text-muted">{p.description}</span>
              {p.method && <span className="text-xs text-text-dim">{PAYMENT_METHODS[p.method]?.label}</span>}
              <PaymentStatusChip status={p.status} />
              {p.invoice_url && (
                <a href={p.invoice_url} target="_blank" rel="noreferrer"
                  className="text-xs text-accent hover:underline" data-testid={`payment-invoice-${p.id}`}>חשבונית</a>
              )}
              {p.status === 'pending' && !p.provider_ref && (
                <button type="button" onClick={() => markPaid(p)}
                  className="text-xs text-emerald-400 hover:underline" data-testid={`payment-markpaid-${p.id}`}>
                  סמן כשולם
                </button>
              )}
              <button type="button" onClick={() => archivePayment(p)}
                className="text-xs text-text-dim hover:text-status-red" data-testid={`payment-archive-${p.id}`}>
                ארכב
              </button>
            </li>
          ))}
        </ul>
      )}
      <AddPaymentModal open={addOpen} onClose={() => setAddOpen(false)}
        orgId={orgId} clientId={clientId} onSaved={load} />
    </section>
  )
}
```

- [ ] **Step 3: Mount in `ClientPage.jsx`**

Import `PaymentsSection` (lazy import not needed — small) and render after the contacts section:
```jsx
import PaymentsSection from '../components/crm/PaymentsSection'
// ... inside the JSX, immediately after the client-contacts </section>:
<PaymentsSection orgId={orgId} clientId={clientId} />
```
(`orgId` and `clientId` already exist in scope — `useOrg()` and `useParams()`.)

- [ ] **Step 4: Verify in the browser**

Run: `npm run lint && npm run build`, then start dev server and open a client card (login required — ask the user for a test login if you don't have one, or use the preview tools if a session exists).
Expected: payments section renders; adding a manual paid payment shows a row with green "שולם" chip; "סמן כשולם" flips a pending row; totals update.

- [ ] **Step 5: Commit**

```bash
git add src/components/crm/PaymentsSection.jsx src/components/crm/AddPaymentModal.jsx src/pages/ClientPage.jsx
git commit -m "feat(payments): client-card payments section with manual ledger"
```

---

### Task 4: Org-wide payments page + CSV export + navigation

**Files:**
- Create: `src/pages/PaymentsPage.jsx`
- Modify: `src/App.jsx` — add lazy import + route `<Route path="payments" element={<PaymentsPage />} />` inside the `/org/:orgId` block (after the `clients/:clientId` route, line ~52).
- Modify: `src/components/Sidebar.jsx` — add a NavLink `💳 תשלומים` to `/org/${orgId}/payments` right after the existing `🤝 לקוחות` NavLink (line ~142), copying its exact className pattern.

**Interfaces:**
- Consumes: Task 2 lib (`filterPayments`, `sumByStatus`, `formatAmount`, `paymentToCSVRow`, `PAYMENT_CSV_HEADERS`), `exportRowsToCSV(headers, rows)` + `downloadCSV(filename, content)` from `src/lib/csv.js`, `PaymentStatusChip` from `PaymentsSection.jsx`.

- [ ] **Step 1: Create `PaymentsPage.jsx`**

```jsx
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTitle } from '../lib/useTitle'
import { PAYMENT_STATUSES, PAYMENT_METHODS, formatAmount, sumByStatus, filterPayments, paymentToCSVRow, PAYMENT_CSV_HEADERS } from '../lib/payments'
import { exportRowsToCSV, downloadCSV } from '../lib/csv'
import { PaymentStatusChip } from '../components/crm/PaymentsSection'
import Button from '../components/ui/Button'
import LoadingSpinner from '../components/ui/LoadingSpinner'

export default function PaymentsPage() {
  const { orgId } = useParams()
  useTitle('תשלומים')
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('payments')
        .select('*, clients:client_id(id, name)')
        .eq('org_id', orgId)
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
      setPayments(data || [])
      setLoading(false)
    })()
  }, [orgId])

  const filtered = useMemo(
    () => filterPayments(payments, { status: status || undefined, from: from || undefined, to: to || undefined }),
    [payments, status, from, to],
  )
  const totals = sumByStatus(filtered)

  function exportCSV() {
    const rows = filtered.map((p) => paymentToCSVRow(p, p.clients?.name))
    downloadCSV('payments.csv', exportRowsToCSV(PAYMENT_CSV_HEADERS, rows))
  }

  if (loading) return <div className="p-6"><LoadingSpinner label="טוען תשלומים..." /></div>

  return (
    <div className="mx-auto max-w-6xl p-6" data-testid="payments-page">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-text">תשלומים</h1>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text"
            data-testid="payments-status-filter">
            <option value="">כל הסטטוסים</option>
            {Object.entries(PAYMENT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text" data-testid="payments-from" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text" data-testid="payments-to" />
          <Button size="sm" variant="secondary" onClick={exportCSV} data-testid="payments-export-btn">⬇ ייצוא CSV</Button>
        </div>
      </div>
      <div className="mb-4 flex gap-6 text-sm text-text-muted" data-testid="payments-page-totals">
        <span>שולם: <b className="text-text">{formatAmount(totals.paid)}</b></span>
        <span>ממתין: <b className="text-text">{formatAmount(totals.pending)}</b></span>
        <span>{filtered.length} תשלומים</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-right text-text-muted">
              <th className="p-3 font-medium">תאריך</th>
              <th className="p-3 font-medium">לקוח</th>
              <th className="p-3 font-medium">תיאור</th>
              <th className="p-3 font-medium">סכום</th>
              <th className="p-3 font-medium">אמצעי</th>
              <th className="p-3 font-medium">סטטוס</th>
              <th className="p-3 font-medium">חשבונית</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className="border-b border-border/50" data-testid={`payments-page-row-${p.id}`}>
                <td className="p-3 text-text-dim">{new Date(p.created_at).toLocaleDateString('he-IL')}</td>
                <td className="p-3">
                  <Link to={`/org/${orgId}/clients/${p.client_id}`} className="text-accent hover:underline">
                    {p.clients?.name || '—'}
                  </Link>
                </td>
                <td className="p-3 text-text-muted">{p.description}</td>
                <td className="p-3 font-medium text-text">{formatAmount(p.amount)}</td>
                <td className="p-3 text-text-dim">{p.method ? PAYMENT_METHODS[p.method]?.label : ''}</td>
                <td className="p-3"><PaymentStatusChip status={p.status} /></td>
                <td className="p-3">
                  {p.invoice_url && <a className="text-accent hover:underline" href={p.invoice_url} target="_blank" rel="noreferrer">צפייה</a>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-text-dim" data-testid="payments-page-empty">אין תשלומים תואמים.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire route + sidebar link** (as listed under Files; copy exact NavLink styling from the לקוחות link).

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build`; in browser: sidebar shows 💳 תשלומים; page lists payments from Task 3; filters narrow the table; CSV downloads and opens correctly in Excel (BOM handled by `downloadCSV`).
Expected: all of the above.

- [ ] **Step 4: Commit — end of Milestone 1 (shippable)**

```bash
git add src/pages/PaymentsPage.jsx src/App.jsx src/components/Sidebar.jsx
git commit -m "feat(payments): org-wide payments page with filters and CSV export"
```
Deploy if desired: `npm run build && netlify deploy --prod --dir=dist --no-build`.

---

### Task 5: Cardcom account + API contract verification (BLOCKING for Tasks 6–9)

**Files:** none (research + user action)

- [ ] **Step 1: Ask the user to open a Cardcom account** (or get sandbox credentials). Cardcom offers a test terminal; the signup asks for business details (ע.מ/ח.פ). Needed values: **terminal number, API name (api_name), API password**. Also confirm the org's invoice document type (חשבונית מס קבלה).

- [ ] **Step 2: Verify the API contract against current official docs** — do NOT trust this plan's baseline blindly. Docs: https://secure.cardcom.solutions/swagger/index.html (API v11) and Cardcom's developer docs site. Verify:
  - Create hosted page: `POST https://secure.cardcom.solutions/api/v11/LowProfile/Create` — body fields `TerminalNumber`, `ApiName`, `Amount`, `Operation`, `ProductName`, `SuccessRedirectUrl`, `FailedRedirectUrl`, `WebHookUrl`, `ReturnValue`, `Document{...}` (invoice), `MaxNumOfPayments` (installments). Response: `ResponseCode` (0=OK), `LowProfileId`, `Url`.
  - Get result: `POST https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult` — body `TerminalNumber`, `ApiName`, `LowProfileId`. Response includes transaction status + document (invoice) info.
  - Webhook: Cardcom POSTs to `WebHookUrl` on completion; payload includes `LowProfileId`. **It is not signed → always re-query GetLpResult before trusting.**
  If the real contract differs, update `cardcom.ts` in Task 6 accordingly and note the deltas in the commit message.

- [ ] **Step 3: Record the sandbox credentials with the user** (they will enter them in the UI in Task 7 — do not commit them anywhere).

---

### Task 6: Edge Functions — Cardcom adapter + create-link / webhook / check-status

**Files:**
- Create: `supabase/functions/_shared/cardcom.ts`
- Create: `supabase/functions/_shared/db.ts`
- Create: `supabase/functions/create-payment-link/index.ts`
- Create: `supabase/functions/payment-webhook/index.ts`
- Create: `supabase/functions/check-payment-status/index.ts`

**Interfaces:**
- Consumes: Task 1 tables; Cardcom API per Task 5.
- Produces (called from frontend in Tasks 7–8 via `supabase.functions.invoke`):
  - `create-payment-link` body `{ org_id, client_id, amount, description, max_installments? }` → `{ payment_id, url }` or `{ error }`.
  - `check-payment-status` body `{ payment_id }` → `{ status }` or `{ error }`.
  - `payment-webhook` — public URL for Cardcom only: `https://iezgyetfwgmlczcrnrvx.supabase.co/functions/v1/payment-webhook`.

- [ ] **Step 1: `_shared/db.ts`** — service-role client + membership check

```ts
import { createClient } from 'npm:@supabase/supabase-js@2'

export function serviceClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

// מזהה את המשתמש מן ה-JWT של הבקשה ובודק חברות בארגון (כולל סופר-אדמין)
export async function requireOrgMember(req: Request, orgId: string): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'unauthorized' }, 401)

  const svc = serviceClient()
  const [{ data: member }, { data: profile }] = await Promise.all([
    svc.from('memberships').select('id').eq('org_id', orgId).eq('user_id', user.id).maybeSingle(),
    svc.from('profiles').select('is_super_admin').eq('id', user.id).maybeSingle(),
  ])
  if (!member && !profile?.is_super_admin) return json({ error: 'forbidden' }, 403)
  return { userId: user.id }
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey' },
  })
}

export function corsPreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return json(null, 204)
  return null
}
```

- [ ] **Step 2: `_shared/cardcom.ts`** — the adapter (verify field names per Task 5!)

```ts
// מתאם Cardcom — API v11 LowProfile (דפי תשלום מתארחים)
// אם החוזה בפועל שונה (ראו Task 5) — עדכנו כאן בלבד; שאר הפונקציות תלויות בממשק, לא ב-Cardcom.

const BASE = 'https://secure.cardcom.solutions/api/v11'

export interface CardcomCreds { terminal_number: string; api_name: string; api_password?: string }
export interface CreateLinkParams {
  amount: number; description: string; clientName?: string; clientEmail?: string
  maxInstallments?: number; autoInvoice?: boolean; successUrl: string; failedUrl: string; webhookUrl: string
  paymentId: string // ReturnValue — חוזר אלינו ב-webhook
}
export interface VerifyResult {
  status: 'paid' | 'failed' | 'pending'
  paidAt?: string; invoiceUrl?: string; invoiceNumber?: string; raw: unknown
}

export async function createPaymentLink(creds: CardcomCreds, p: CreateLinkParams): Promise<{ url: string; providerRef: string }> {
  const body: Record<string, unknown> = {
    TerminalNumber: Number(creds.terminal_number),
    ApiName: creds.api_name,
    Operation: 'ChargeOnly',
    Amount: p.amount,
    ProductName: p.description.slice(0, 250),
    SuccessRedirectUrl: p.successUrl,
    FailedRedirectUrl: p.failedUrl,
    WebHookUrl: p.webhookUrl,
    ReturnValue: p.paymentId,
    Language: 'he',
    ISOCoinId: 1, // ILS
  }
  if (p.maxInstallments && p.maxInstallments > 1) body.MaxNumOfPayments = p.maxInstallments
  if (p.autoInvoice) {
    body.Operation = 'ChargeAndCreateDocument'
    body.Document = {
      Name: p.clientName || 'לקוח',
      Email: p.clientEmail || undefined,
      Products: [{ Description: p.description.slice(0, 250), UnitCost: p.amount, Quantity: 1 }],
    }
  }
  const res = await fetch(`${BASE}/LowProfile/Create`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok || data.ResponseCode !== 0) {
    throw new Error(`cardcom create failed: ${data.ResponseCode} ${data.Description ?? ''}`)
  }
  return { url: data.Url, providerRef: data.LowProfileId }
}

export async function verifyTransaction(creds: CardcomCreds, providerRef: string): Promise<VerifyResult> {
  const res = await fetch(`${BASE}/LowProfile/GetLpResult`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ TerminalNumber: Number(creds.terminal_number), ApiName: creds.api_name, LowProfileId: providerRef }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`cardcom verify failed: http ${res.status}`)
  const paid = data.ResponseCode === 0 && data.TranzactionInfo?.ResponseCode === 0
  const failed = data.ResponseCode === 0 && data.TranzactionInfo && data.TranzactionInfo.ResponseCode !== 0
  return {
    status: paid ? 'paid' : failed ? 'failed' : 'pending',
    paidAt: paid ? new Date().toISOString() : undefined,
    invoiceUrl: data.DocumentInfo?.DocumentUrl ?? undefined,
    invoiceNumber: data.DocumentInfo?.DocumentNumber ? String(data.DocumentInfo.DocumentNumber) : undefined,
    raw: data,
  }
}

// ה-webhook של Cardcom — מחלצים רק את המזהה; את האמת מביאים מ-verifyTransaction
export async function parseWebhook(req: Request): Promise<{ providerRef: string | null }> {
  try {
    const ct = req.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) {
      const data = await req.json()
      return { providerRef: data.LowProfileId ?? data.lowprofilecode ?? null }
    }
    const form = await req.formData()
    return { providerRef: (form.get('LowProfileId') ?? form.get('lowprofilecode'))?.toString() ?? null }
  } catch {
    return { providerRef: null }
  }
}
```

- [ ] **Step 3: `create-payment-link/index.ts`**

```ts
import { serviceClient, requireOrgMember, json, corsPreflight } from '../_shared/db.ts'
import { createPaymentLink } from '../_shared/cardcom.ts'

Deno.serve(async (req) => {
  const pre = corsPreflight(req); if (pre) return pre
  try {
    const { org_id, client_id, amount, description, max_installments } = await req.json()
    if (!org_id || !client_id || !amount || Number(amount) <= 0) return json({ error: 'bad request' }, 400)

    const auth = await requireOrgMember(req, org_id)
    if (auth instanceof Response) return auth

    const svc = serviceClient()
    const [{ data: account }, { data: client }] = await Promise.all([
      svc.from('payment_provider_accounts').select('*')
        .eq('org_id', org_id).eq('is_active', true).eq('is_archived', false)
        .eq('provider', 'cardcom').limit(1).maybeSingle(),
      svc.from('clients').select('id, org_id, name, email').eq('id', client_id).maybeSingle(),
    ])
    if (!account) return json({ error: 'no active provider' }, 400)
    if (!client || client.org_id !== org_id) return json({ error: 'client not found' }, 404)

    // יוצרים קודם שורת תשלום כדי לקבל id (ReturnValue); אם יצירת הלינק תיכשל — מארכבים
    const { data: payment, error: insErr } = await svc.from('payments').insert({
      org_id, client_id, provider_account_id: account.id,
      amount: Number(amount), description: description ?? null,
      method: 'credit_card', status: 'pending', created_by: auth.userId,
    }).select().single()
    if (insErr) return json({ error: 'db insert failed' }, 500)

    try {
      const appUrl = Deno.env.get('APP_BASE_URL') ?? 'https://basecrm-app.netlify.app'
      const { url, providerRef } = await createPaymentLink(account.credentials, {
        amount: Number(amount), description: description ?? 'תשלום',
        clientName: client.name, clientEmail: client.email ?? undefined,
        maxInstallments: max_installments ? Number(max_installments) : undefined,
        autoInvoice: account.settings?.auto_invoice !== false,
        successUrl: `${appUrl}/pay/thanks`, failedUrl: `${appUrl}/pay/thanks?failed=1`,
        webhookUrl: `${Deno.env.get('SUPABASE_URL')}/functions/v1/payment-webhook`,
        paymentId: payment.id,
      })
      await svc.from('payments').update({ payment_link: url, provider_ref: providerRef }).eq('id', payment.id)
      return json({ payment_id: payment.id, url })
    } catch (e) {
      await svc.from('payments').update({ is_archived: true }).eq('id', payment.id)
      console.error('create link failed', e)
      return json({ error: 'provider error' }, 502)
    }
  } catch (e) {
    console.error(e)
    return json({ error: 'internal' }, 500)
  }
})
```

- [ ] **Step 4: `payment-webhook/index.ts`** (deployed with `--no-verify-jwt`)

```ts
import { serviceClient, json } from '../_shared/db.ts'
import { parseWebhook, verifyTransaction } from '../_shared/cardcom.ts'

Deno.serve(async (req) => {
  const svc = serviceClient()
  try {
    const { providerRef } = await parseWebhook(req)
    if (!providerRef) return json({ ok: true }) // מתעלמים בשקט — לא מפוצצים retries

    const { data: payment } = await svc.from('payments').select('*').eq('provider_ref', providerRef).maybeSingle()
    if (!payment || payment.status === 'paid') return json({ ok: true }) // אידמפוטנטי

    const { data: account } = await svc.from('payment_provider_accounts')
      .select('credentials').eq('id', payment.provider_account_id).maybeSingle()
    if (!account) return json({ ok: true })

    // לעולם לא סומכים על גוף ה-webhook — מאמתים מול Cardcom
    const result = await verifyTransaction(account.credentials, providerRef)
    if (result.status !== 'pending') {
      await svc.from('payments').update({
        status: result.status,
        paid_at: result.status === 'paid' ? (result.paidAt ?? new Date().toISOString()) : null,
        invoice_url: result.invoiceUrl ?? null,
        invoice_number: result.invoiceNumber ?? null,
        raw_webhook: result.raw,
      }).eq('id', payment.id)
    }
    return json({ ok: true })
  } catch (e) {
    console.error('webhook error', e)
    return json({ ok: true }) // 200 תמיד — נדיאג דרך הלוגים
  }
})
```

- [ ] **Step 5: `check-payment-status/index.ts`**

```ts
import { serviceClient, requireOrgMember, json, corsPreflight } from '../_shared/db.ts'
import { verifyTransaction } from '../_shared/cardcom.ts'

Deno.serve(async (req) => {
  const pre = corsPreflight(req); if (pre) return pre
  try {
    const { payment_id } = await req.json()
    if (!payment_id) return json({ error: 'bad request' }, 400)

    const svc = serviceClient()
    const { data: payment } = await svc.from('payments').select('*').eq('id', payment_id).maybeSingle()
    if (!payment || !payment.provider_ref) return json({ error: 'not found' }, 404)

    const auth = await requireOrgMember(req, payment.org_id)
    if (auth instanceof Response) return auth
    if (payment.status !== 'pending') return json({ status: payment.status })

    const { data: account } = await svc.from('payment_provider_accounts')
      .select('credentials').eq('id', payment.provider_account_id).maybeSingle()
    if (!account) return json({ error: 'no provider' }, 400)

    const result = await verifyTransaction(account.credentials, payment.provider_ref)
    if (result.status !== 'pending') {
      await svc.from('payments').update({
        status: result.status,
        paid_at: result.status === 'paid' ? (result.paidAt ?? new Date().toISOString()) : null,
        invoice_url: result.invoiceUrl ?? null,
        invoice_number: result.invoiceNumber ?? null,
        raw_webhook: result.raw,
      }).eq('id', payment.id)
    }
    return json({ status: result.status })
  } catch (e) {
    console.error(e)
    return json({ error: 'internal' }, 500)
  }
})
```

- [ ] **Step 6: Deploy the functions**

Via Supabase CLI (needs `supabase login` + `supabase link --project-ref iezgyetfwgmlczcrnrvx`):
```bash
supabase functions deploy create-payment-link
supabase functions deploy check-payment-status
supabase functions deploy payment-webhook --no-verify-jwt
supabase secrets set APP_BASE_URL=https://basecrm-app.netlify.app
```
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)
Alternative: Supabase MCP `deploy_edge_function` if CLI is unavailable. **`payment-webhook` MUST have JWT verification disabled** (Cardcom can't send a JWT) — via the flag above or the Dashboard function settings.

- [ ] **Step 7: Smoke-test deployed functions**

```bash
# ללא JWT — חייב להחזיר 401 (מוגן)
curl -s -X POST "https://iezgyetfwgmlczcrnrvx.supabase.co/functions/v1/create-payment-link" -H "Content-Type: application/json" -d '{}'
# webhook ציבורי — מחזיר {"ok":true} גם על שטויות (אידמפוטנטי-שקט)
curl -s -X POST "https://iezgyetfwgmlczcrnrvx.supabase.co/functions/v1/payment-webhook" -d 'LowProfileId=nonexistent'
```
Expected: first returns 401; second returns `{"ok":true}`.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions
git commit -m "feat(payments): edge functions - cardcom adapter, create-link, webhook, check-status"
```

---

### Task 7: Provider-connect UI in org settings

**Files:**
- Create: `src/components/crm/PaymentProviderManager.jsx`
- Modify: `src/pages/OrgSettingsPage.jsx` — render `<PaymentProviderManager orgId={orgId} />` as a new settings card, next to where `<LeadSourcesManager orgId={orgId} />` is rendered (search for `LeadSourcesManager`).

**Interfaces:**
- Consumes: `payment_provider_accounts` table (admin RLS), `create-payment-link` function (connection test).

- [ ] **Step 1: Create `PaymentProviderManager.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import Button from '../ui/Button'
import Input from '../ui/Input'
import { handleEnterAsTab } from '../../lib/formNav'

// חיבור חשבון סליקה (Cardcom) — אדמינים בלבד, מוצג בהגדרות הארגון
export default function PaymentProviderManager({ orgId }) {
  const { toast } = useToast()
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [terminal, setTerminal] = useState('')
  const [apiName, setApiName] = useState('')
  const [apiPassword, setApiPassword] = useState('')
  const [autoInvoice, setAutoInvoice] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testUrl, setTestUrl] = useState('')

  async function load() {
    const { data } = await supabase.from('payment_provider_accounts')
      .select('*').eq('org_id', orgId).eq('is_archived', false)
      .eq('provider', 'cardcom').limit(1).maybeSingle()
    if (data) {
      setAccount(data)
      setTerminal(data.credentials?.terminal_number ?? '')
      setApiName(data.credentials?.api_name ?? '')
      setApiPassword(data.credentials?.api_password ?? '')
      setAutoInvoice(data.settings?.auto_invoice !== false)
    }
    setLoading(false)
  }
  useEffect(() => { load() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [orgId])

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    const payload = {
      org_id: orgId, provider: 'cardcom', display_name: 'Cardcom',
      credentials: { terminal_number: terminal.trim(), api_name: apiName.trim(), api_password: apiPassword.trim() },
      settings: { auto_invoice: autoInvoice, document_type: 'invoice_receipt', language: 'he' },
    }
    const q = account
      ? supabase.from('payment_provider_accounts').update(payload).eq('id', account.id)
      : supabase.from('payment_provider_accounts').insert(payload)
    const { error } = await q
    setSaving(false)
    if (error) { toast('שמירת החיבור נכשלה.', 'error'); return }
    toast('חיבור הסליקה נשמר')
    await load()
  }

  async function toggleActive() {
    if (!account) return
    const { error } = await supabase.from('payment_provider_accounts')
      .update({ is_active: !account.is_active }).eq('id', account.id)
    if (error) { toast('העדכון נכשל.', 'error'); return }
    await load()
  }

  // בדיקת חיבור: יוצרים לינק אמיתי על ₪1 ללקוח לא-קיים? לא — צריך לקוח. משתמשים בלקוח הראשון בארגון.
  async function testConnection() {
    setTesting(true)
    setTestUrl('')
    try {
      const { data: client } = await supabase.from('clients')
        .select('id').eq('org_id', orgId).eq('is_archived', false).limit(1).maybeSingle()
      if (!client) { toast('נדרש לפחות לקוח אחד בארגון לבדיקה.', 'error'); return }
      const { data, error } = await supabase.functions.invoke('create-payment-link', {
        body: { org_id: orgId, client_id: client.id, amount: 1, description: 'בדיקת חיבור — נא לא לשלם' },
      })
      if (error || data?.error) throw new Error(data?.error || error.message)
      setTestUrl(data.url)
      // מארכבים את תשלום-הבדיקה מיד כדי שלא יזהם את היומן
      await supabase.from('payments').update({ is_archived: true }).eq('id', data.payment_id)
      toast('החיבור תקין ✓')
    } catch {
      toast('בדיקת החיבור נכשלה — בדקו את פרטי ה-API.', 'error')
    } finally {
      setTesting(false)
    }
  }

  if (loading) return null

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="payment-provider-manager">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-text">תשלומים וסליקה (Cardcom)</h2>
        {account && (
          <button type="button" onClick={toggleActive}
            className={`rounded-full border px-2 py-0.5 text-xs ${account.is_active ? 'border-emerald-500/30 text-emerald-400' : 'border-border text-text-dim'}`}
            data-testid="provider-active-toggle">
            {account.is_active ? 'פעיל' : 'כבוי'}
          </button>
        )}
      </div>
      <form onSubmit={save} onKeyDown={handleEnterAsTab} className="space-y-3">
        <Input label="מספר טרמינל" value={terminal} onChange={(e) => setTerminal(e.target.value)} dir="ltr" data-testid="provider-terminal-input" required />
        <Input label="API Name" value={apiName} onChange={(e) => setApiName(e.target.value)} dir="ltr" data-testid="provider-apiname-input" required />
        <Input label="API Password" type="password" value={apiPassword} onChange={(e) => setApiPassword(e.target.value)} dir="ltr" data-testid="provider-apipassword-input" />
        <label className="flex items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={autoInvoice} onChange={(e) => setAutoInvoice(e.target.checked)} data-testid="provider-autoinvoice-checkbox" />
          הפקת חשבונית מס/קבלה אוטומטית בכל תשלום
        </label>
        <div className="flex gap-2">
          <Button type="submit" loading={saving} data-testid="provider-save-btn">שמירה</Button>
          {account && (
            <Button type="button" variant="secondary" loading={testing} onClick={testConnection} data-testid="provider-test-btn">
              בדוק חיבור
            </Button>
          )}
        </div>
        {testUrl && (
          <p className="text-xs text-text-muted" data-testid="provider-test-url">
            נוצר לינק בדיקה בהצלחה: <a className="text-accent hover:underline" href={testUrl} target="_blank" rel="noreferrer">צפייה (אין לשלם)</a>
          </p>
        )}
      </form>
    </section>
  )
}
```

- [ ] **Step 2: Mount in `OrgSettingsPage.jsx`** next to `LeadSourcesManager`. Wrap with the same admin-only conditional the page uses for other admin sections (search for how `LeadSourcesManager` is gated — mirror it exactly).

- [ ] **Step 3: Verify** — `npm run lint && npm run build`; in browser as an org admin: enter sandbox credentials, save, "בדוק חיבור" produces a Cardcom URL. As a non-admin member: section shows empty/no data (RLS blocks reads — confirm no console errors leak credentials).

- [ ] **Step 4: Commit**

```bash
git add src/components/crm/PaymentProviderManager.jsx src/pages/OrgSettingsPage.jsx
git commit -m "feat(payments): cardcom provider connect UI in org settings"
```

---

### Task 8: Payment-link mode in the modal + status refresh + thanks page

**Files:**
- Modify: `src/components/crm/AddPaymentModal.jsx` — add a mode toggle (רישום ידני / קישור לתשלום).
- Modify: `src/components/crm/PaymentsSection.jsx` — pass `clientPhone` prop; add "בדוק סטטוס" on pending provider rows; add copy/WhatsApp actions on rows with `payment_link`.
- Modify: `src/pages/ClientPage.jsx` — pass `clientPhone={client.phone}` and `clientName={client.name}` to `PaymentsSection`.
- Create: `src/pages/PayThanksPage.jsx` + route in `src/App.jsx` (public route, NOT inside ProtectedRoute): `<Route path="/pay/thanks" element={<PayThanksPage />} />`.

**Interfaces:**
- Consumes: `create-payment-link` and `check-payment-status` Edge Functions (Task 6 signatures).

- [ ] **Step 1: Extend `AddPaymentModal.jsx`.** Add state `mode` (`'manual' | 'link'`), a toggle at the top, and a link form. Keep the existing manual form untouched. New link-mode submit:

```jsx
// בתוך AddPaymentModal — mode 'link'
const [maxInstallments, setMaxInstallments] = useState(1)
const [createdLink, setCreatedLink] = useState('')

async function createLink(e) {
  e.preventDefault()
  const amt = Number(amount)
  if (!amt || amt <= 0) { setError('יש להזין סכום חיובי.'); return }
  setSaving(true); setError('')
  const { data, error: err } = await supabase.functions.invoke('create-payment-link', {
    body: { org_id: orgId, client_id: clientId, amount: amt, description: description.trim(), max_installments: Number(maxInstallments) || 1 },
  })
  setSaving(false)
  if (err || data?.error) {
    setError(data?.error === 'no active provider'
      ? 'אין חשבון סליקה פעיל — חברו Cardcom בהגדרות הארגון.'
      : 'יצירת הקישור נכשלה.')
    return
  }
  setCreatedLink(data.url)
  onSaved?.()
}
```
Mode toggle UI (top of modal):
```jsx
<div className="mb-3 flex gap-1 rounded-md border border-border p-1 text-sm">
  {[['manual', 'רישום ידני'], ['link', 'קישור לתשלום']].map(([m, label]) => (
    <button key={m} type="button" onClick={() => { setMode(m); setError(''); setCreatedLink('') }}
      className={`flex-1 rounded px-2 py-1 ${mode === m ? 'bg-accent text-white' : 'text-text-muted hover:bg-surface-2'}`}
      data-testid={`payment-mode-${m}`}>{label}</button>
  ))}
</div>
```
Link form fields: amount + description (reuse the same inputs), installments select 1–12 (`data-testid="payment-installments-select"`). After `createdLink` is set, show a `CopyRow`-style readonly input with copy button and a WhatsApp share link:
```jsx
{createdLink && (
  <div className="space-y-2 rounded-md border border-border bg-bg p-3">
    <input readOnly dir="ltr" value={createdLink} onFocus={(e) => e.target.select()}
      className="w-full truncate rounded-md border border-border bg-surface px-2 py-1.5 text-xs" data-testid="payment-link-url" />
    <div className="flex gap-2">
      <Button size="sm" type="button" variant="secondary"
        onClick={() => navigator.clipboard.writeText(createdLink)} data-testid="payment-link-copy">העתק</Button>
      {clientPhone && (
        <a className="inline-flex items-center rounded-md bg-emerald-600 px-2.5 py-1 text-sm text-white hover:bg-emerald-500"
          target="_blank" rel="noreferrer" data-testid="payment-link-whatsapp"
          href={`https://wa.me/${clientPhone.replace(/\D/g, '').replace(/^0/, '972')}?text=${encodeURIComponent(`שלום, לתשלום עבור "${description}" בסך ₪${amount}: ${createdLink}`)}`}>
          שליחה בוואטסאפ
        </a>
      )}
    </div>
  </div>
)}
```
(AddPaymentModal now takes an extra `clientPhone` prop.)

- [ ] **Step 2: `PaymentsSection.jsx` additions.** On rows where `p.status === 'pending' && p.provider_ref`:

```jsx
<button type="button" data-testid={`payment-checkstatus-${p.id}`}
  className="text-xs text-accent hover:underline"
  onClick={async () => {
    const { data } = await supabase.functions.invoke('check-payment-status', { body: { payment_id: p.id } })
    if (data?.status && data.status !== 'pending') { toast('הסטטוס עודכן'); await load() }
    else toast('עדיין ממתין לתשלום')
  }}>
  בדוק סטטוס
</button>
```
And on rows with `p.payment_link`: a small "העתק לינק" button (`navigator.clipboard.writeText(p.payment_link)`).

- [ ] **Step 3: `PayThanksPage.jsx`** (public, minimal, no auth):

```jsx
import { useSearchParams, Link } from 'react-router-dom'

export default function PayThanksPage() {
  const [params] = useSearchParams()
  const failed = params.get('failed') === '1'
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6" dir="rtl">
      <div className="max-w-md rounded-lg border border-border bg-surface p-8 text-center" data-testid="pay-thanks">
        <div className="mb-3 text-4xl">{failed ? '😕' : '✅'}</div>
        <h1 className="mb-2 text-xl font-bold text-text">
          {failed ? 'התשלום לא הושלם' : 'התשלום התקבל — תודה!'}
        </h1>
        <p className="text-sm text-text-muted">
          {failed ? 'ניתן לנסות שוב דרך הקישור שקיבלתם, או לפנות לבית העסק.' : 'קבלה/חשבונית תישלח אליכם במייל.'}
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify lint + build:** `npm run lint && npm run build`. Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/crm/AddPaymentModal.jsx src/components/crm/PaymentsSection.jsx src/pages/ClientPage.jsx src/pages/PayThanksPage.jsx src/App.jsx
git commit -m "feat(payments): payment-link mode, status refresh, public thanks page"
```

---

### Task 9: End-to-end sandbox verification + security checks (Milestone 2 gate)

**Files:** none (verification)

- [ ] **Step 1: Full happy path on the Cardcom sandbox terminal.** Create a payment link for a real test client → open the URL → pay with Cardcom's test card (get test card numbers from their docs/sandbox) → confirm: webhook fires (check function logs: Dashboard → Edge Functions → payment-webhook → Logs), payment flips to `paid`, `invoice_url` populated, client card and payments page show it, thanks page rendered after redirect.

- [ ] **Step 2: Webhook-miss fallback.** Create a second link, pay it, and BEFORE the webhook lands (or by temporarily breaking the webhook URL) use "בדוק סטטוס" — payment flips to `paid` via re-query.

- [ ] **Step 3: Security regression checklist** (run with a non-admin member login + raw curl with anon key):
  - Member (non-admin) cannot `select` from `payment_provider_accounts` (empty result).
  - Anon curl on `payments`/`payment_provider_accounts` → `[]`.
  - As a member, try `update payments set status='paid'` on a provider-linked pending row via the JS console → error "payment settled by provider".
  - `create-payment-link` with a client_id from ANOTHER org → 404.
  - `check-payment-status` with a payment from an org you're not in → 403.

- [ ] **Step 4: Deploy frontend** — `npm run build && netlify deploy --prod --dir=dist --no-build`. Verify on https://basecrm-app.netlify.app.

- [ ] **Step 5: Update project memory/docs.** Append to `README.md` (or the org's runbook): how to connect Cardcom, where the webhook URL lives, that migration 014 must be applied. Commit:

```bash
git add README.md
git commit -m "docs(payments): cardcom setup runbook"
```

---

## Self-Review Notes (done at plan-writing time)

- **Spec coverage:** manual tracking (T3), payment links (T6+T8), auto-invoice (T6 Document flow), installments (T6/T8 MaxNumOfPayments), org payments page + CSV (T4), provider connect UI + test button (T7), webhook verify-by-requery + idempotency (T6), status-flip protection trigger (T1), pen-test items (T9). Recurring = Milestone 3, deliberately out (spec §7 allows this).
- **Known uncertainty:** exact Cardcom v11 field names — Task 5 exists precisely to resolve this before Task 6 code is trusted; the adapter isolates any deltas to one file.
- **Type consistency check:** `create-payment-link` body/return names match between Task 6 and Tasks 7–8; `PaymentStatusChip` exported from PaymentsSection and imported in PaymentsPage; `paymentToCSVRow`/`PAYMENT_CSV_HEADERS` names match Tasks 2 and 4.
