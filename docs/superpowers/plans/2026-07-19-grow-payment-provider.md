# Grow Payment Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Grow (Meshulam "light server" API) as a second clearing provider next to Cardcom, with a provider dropdown at payment-link creation when both are connected.

**Architecture:** A second provider adapter (`supabase/functions/_shared/grow.ts`) behind the same interface as `cardcom.ts`; Edge Functions dispatch by `provider`; webhook routes by `?provider=` query param (absent ⇒ Cardcom, fully backward compatible); org settings gets a second connection card; the link modal gets a conditional dropdown. Spec: `docs/superpowers/specs/2026-07-19-grow-payment-provider-design.md`.

**Tech Stack:** React 19 + Vite (JS/JSX, Hebrew RTL UI), Supabase (Postgres + RLS + Edge Functions in Deno TS), Vitest for unit tests, oxlint.

## Global Constraints

- UI text is Hebrew; all interactive elements get `data-testid`.
- Soft-delete only (`is_archived`); **no DELETE policies** — hard project rule.
- Provider credentials: admins-only via RLS; secrets write-only + Vault-encrypted; **never** returned to the browser (read via `payment_provider_accounts_safe`).
- Never trust webhook bodies — settlement truth comes from a server-side verify call to the provider.
- Currency fixed to ILS. Existing Cardcom behavior must not change (webhook URLs without `?provider=` keep working).
- Grow sandbox base URL: `https://sandbox.meshulam.co.il/api/light/server/1.0` (per-account `sandbox` flag; production base from `GROW_BASE_URL_PROD` env).
- Commands: `npm test` (vitest run), `npm run lint` (oxlint). Migrations are run manually in Supabase → SQL Editor and must be idempotent.

---

### Task 1: Migration — `provider_meta`, `save_payment_provider_v2`, uniqueness

**Files:**
- Create: `supabase/migration_021_grow_provider.sql`

**Interfaces:**
- Consumes: existing tables/functions from `migration_014_payments.sql` and `migration_020_payment_security.sql` (`payment_provider_accounts`, `payments`, `protect_provider_payment_fields`, Vault key `payment_creds_key`, `payment_provider_accounts_safe` view).
- Produces: `payments.provider_meta jsonb`; RPC `save_payment_provider_v2(p_org_id uuid, p_provider text, p_credentials jsonb, p_secret text, p_settings jsonb) returns uuid`; v1 `save_payment_provider` delegating to v2; partial unique index `uq_ppa_org_provider_live`.

- [ ] **Step 1: Write the migration file**

```sql
-- migration_021_grow_provider.sql — ספק סליקה שני: Grow (Meshulam)
-- ראו docs/superpowers/specs/2026-07-19-grow-payment-provider-design.md
-- הריצו ב-Supabase → SQL Editor. בטוח להריץ שוב (idempotent).

-- 1) מטא-דאטה של הספק לתשלום (Grow: { process_token }) — נכתב ע"י service_role בלבד
alter table public.payments add column if not exists provider_meta jsonb;

-- 2) אחד-לספק: שורה חיה אחת לכל (org, provider)
--    (אם קיימות כפילויות היסטוריות — ארכבו ידנית לפני ההרצה; האינדקס ייכשל אחרת)
create unique index if not exists uq_ppa_org_provider_live
  on public.payment_provider_accounts(org_id, provider) where is_archived = false;

-- 3) הרחבת הטריגר: גם provider_meta נעול אחרי סליקה (service_role בלבד)
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
       or new.provider_meta is distinct from old.provider_meta
       or new.amount is distinct from old.amount then
      raise exception 'payment settled by provider — fields are read-only';
    end if;
  end if;
  return new;
end $$;

-- 4) RPC כללי לשמירת חיבור ספק (אדמינים בלבד). p_secret: כתיבה-בלבד, מוצפן ב-Vault.
--    cardcom: credentials { terminal_number, api_name }, secret = API password
--    grow:    credentials { user_id, page_code, sandbox }, secret לא בשימוש
create or replace function public.save_payment_provider_v2(
  p_org_id uuid,
  p_provider text,
  p_credentials jsonb,
  p_secret text default null,
  p_settings jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public, extensions, vault as $$
declare
  v_id uuid;
  v_key text;
  v_creds jsonb;
  v_name text;
begin
  if not public.is_org_admin(p_org_id) then
    raise exception 'not authorized';
  end if;
  if p_provider not in ('cardcom', 'grow') then
    raise exception 'unsupported provider';
  end if;

  if p_provider = 'cardcom' then
    v_creds := jsonb_build_object(
      'terminal_number', trim(coalesce(p_credentials->>'terminal_number', '')),
      'api_name',        trim(coalesce(p_credentials->>'api_name', ''))
    );
    v_name := 'Cardcom';
  else
    v_creds := jsonb_build_object(
      'user_id',   trim(coalesce(p_credentials->>'user_id', '')),
      'page_code', trim(coalesce(p_credentials->>'page_code', '')),
      'sandbox',   coalesce((p_credentials->>'sandbox')::boolean, true)
    );
    v_name := 'Grow';
  end if;

  select id into v_id from public.payment_provider_accounts
    where org_id = p_org_id and provider = p_provider and is_archived = false
    order by created_at limit 1;

  if v_id is null then
    insert into public.payment_provider_accounts (org_id, provider, display_name, credentials, settings)
    values (p_org_id, p_provider, v_name, v_creds, coalesce(p_settings, '{}'::jsonb))
    returning id into v_id;
  else
    update public.payment_provider_accounts
      set credentials = v_creds, settings = coalesce(p_settings, '{}'::jsonb)
      where id = v_id;
  end if;

  if p_secret is not null and length(trim(p_secret)) > 0 then
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'payment_creds_key' limit 1;
    update public.payment_provider_accounts
      set api_password_enc = extensions.pgp_sym_encrypt(trim(p_secret), v_key)
      where id = v_id;
  end if;

  return v_id;
end $$;

revoke all on function public.save_payment_provider_v2(uuid, text, jsonb, text, jsonb) from public, anon;
grant execute on function public.save_payment_provider_v2(uuid, text, jsonb, text, jsonb) to authenticated;

-- 5) v1 — נשמר לתאימות לאחור; מאציל ל-v2
create or replace function public.save_payment_provider(
  p_org_id uuid,
  p_terminal text,
  p_api_name text,
  p_api_password text,
  p_auto_invoice boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  return public.save_payment_provider_v2(
    p_org_id, 'cardcom',
    jsonb_build_object('terminal_number', p_terminal, 'api_name', p_api_name),
    p_api_password,
    jsonb_build_object('auto_invoice', coalesce(p_auto_invoice, true), 'document_type', 'invoice_receipt', 'language', 'he')
  );
end $$;
```

- [ ] **Step 2: Sanity-check the SQL is idempotent**

Re-read the file and confirm: every statement is `if not exists` / `create or replace`. No `drop` of data. (Migrations run manually in Supabase SQL Editor — there is no local runner; note in the PR that the user must run it before deploying functions.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migration_021_grow_provider.sql
git commit -m "feat(payments): migration 021 — provider_meta, generalized save_payment_provider_v2, per-provider uniqueness"
```

---

### Task 2: Provider labels in the pure payments lib

**Files:**
- Modify: `src/lib/payments.js` (append after `PAYMENT_METHODS`)
- Test: `src/lib/payments.test.js` (append)

**Interfaces:**
- Produces: `PAYMENT_PROVIDERS = { cardcom: { label }, grow: { label } }` — used by Tasks 8–9 UI.

- [ ] **Step 1: Write the failing test** (append to `src/lib/payments.test.js`, add `PAYMENT_PROVIDERS` to the existing import block)

```js
  it('has labels for every provider', () => {
    for (const pr of ['cardcom', 'grow']) {
      expect(PAYMENT_PROVIDERS[pr].label).toBeTruthy()
    }
  })
```

- [ ] **Step 2: Run to verify it fails** — `npm test` → FAIL (`PAYMENT_PROVIDERS` is not exported).

- [ ] **Step 3: Implement** (append to `src/lib/payments.js` after `PAYMENT_METHODS`)

```js
export const PAYMENT_PROVIDERS = {
  cardcom: { label: 'Cardcom' },
  grow:    { label: 'Grow' },
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments.js src/lib/payments.test.js
git commit -m "feat(payments): provider labels (cardcom/grow)"
```

---

### Task 3: Grow adapter — pure helpers (TDD)

**Files:**
- Create: `supabase/functions/_shared/grow.ts`
- Test: `supabase/functions/_shared/grow.test.ts`

**Interfaces:**
- Produces (pure, no network, no Deno globals at module top level — Vitest imports this file directly):
  - `normalizeIsraeliPhone(raw: string | null | undefined): string | null` — returns local `05XXXXXXXX` format or null if not a valid Israeli mobile.
  - `buildCreateProcessForm(creds: GrowCreds, p: GrowCreateParams): Record<string, string>` — flat field map for the FormData body; throws `Error('client_phone_required')` when the phone is missing/invalid.
  - `mapProcessInfo(data: unknown): { status: 'paid' | 'pending'; transactionCode?: string }` — maps a `getPaymentProcessInfo` `data` object.
  - `growBaseUrl(creds: GrowCreds): string`
  - Types: `GrowCreds { user_id: string; page_code: string; sandbox?: boolean }`, `GrowCreateParams { amount, description, clientName, clientPhone, clientEmail?, maxInstallments?, successUrl, cancelUrl, notifyUrl, paymentId }`.

- [ ] **Step 1: Write the failing tests** — create `supabase/functions/_shared/grow.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeIsraeliPhone, buildCreateProcessForm, mapProcessInfo, growBaseUrl } from './grow.ts'

const creds = { user_id: 'u-123', page_code: 'pc-456', sandbox: true }
const params = {
  amount: 150.5, description: 'חוג ג׳ודו — יולי', clientName: 'ישראל ישראלי',
  clientPhone: '050-123-4567', clientEmail: 'a@b.co', maxInstallments: 3,
  successUrl: 'https://app.example/pay/thanks', cancelUrl: 'https://app.example/pay/thanks?failed=1',
  notifyUrl: 'https://x.supabase.co/functions/v1/payment-webhook?provider=grow&s=sec',
  paymentId: 'pay-1',
}

describe('normalizeIsraeliPhone', () => {
  it('normalizes local and international formats to 05XXXXXXXX', () => {
    expect(normalizeIsraeliPhone('050-123-4567')).toBe('0501234567')
    expect(normalizeIsraeliPhone('+972501234567')).toBe('0501234567')
    expect(normalizeIsraeliPhone('972501234567')).toBe('0501234567')
  })
  it('rejects missing/landline/short numbers', () => {
    expect(normalizeIsraeliPhone(null)).toBeNull()
    expect(normalizeIsraeliPhone('')).toBeNull()
    expect(normalizeIsraeliPhone('031234567')).toBeNull()   // לא סלולרי
    expect(normalizeIsraeliPhone('05012')).toBeNull()
  })
})

describe('buildCreateProcessForm', () => {
  const form = buildCreateProcessForm(creds, params)
  it('includes required Grow fields', () => {
    expect(form.pageCode).toBe('pc-456')
    expect(form.userId).toBe('u-123')
    expect(form.sum).toBe('150.5')
    expect(form.description).toBe('חוג ג׳ודו — יולי')
    expect(form.successUrl).toBe(params.successUrl)
    expect(form.cancelUrl).toBe(params.cancelUrl)
    expect(form.notifyUrl).toBe(params.notifyUrl)
    expect(form['pageField[fullName]']).toBe('ישראל ישראלי')
    expect(form['pageField[phone]']).toBe('0501234567')
    expect(form['pageField[email]']).toBe('a@b.co')
    expect(form.cField1).toBe('pay-1')
    expect(form.chargeType).toBe('1')
  })
  it('sets installments only when maxInstallments > 1', () => {
    expect(form.maxPaymentNum).toBe('3')
    const single = buildCreateProcessForm(creds, { ...params, maxInstallments: 1 })
    expect(single.maxPaymentNum).toBeUndefined()
  })
  it('omits email when absent', () => {
    const noMail = buildCreateProcessForm(creds, { ...params, clientEmail: undefined })
    expect(noMail['pageField[email]']).toBeUndefined()
  })
  it('throws client_phone_required for a missing phone', () => {
    expect(() => buildCreateProcessForm(creds, { ...params, clientPhone: null })).toThrow('client_phone_required')
  })
})

describe('mapProcessInfo', () => {
  it('paid when a transactionCode exists', () => {
    expect(mapProcessInfo({ transactionCode: 'TC1', sum: 150.5 })).toEqual({ status: 'paid', transactionCode: 'TC1' })
  })
  it('pending otherwise', () => {
    expect(mapProcessInfo({})).toEqual({ status: 'pending', transactionCode: undefined })
    expect(mapProcessInfo(null)).toEqual({ status: 'pending', transactionCode: undefined })
  })
})

describe('growBaseUrl', () => {
  it('uses sandbox when flagged', () => {
    expect(growBaseUrl(creds)).toBe('https://sandbox.meshulam.co.il/api/light/server/1.0')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npm test` → FAIL ("Failed to resolve import ./grow.ts").

- [ ] **Step 3: Implement the pure part** — create `supabase/functions/_shared/grow.ts`:

```ts
// מתאם Grow (Meshulam "light server" API) — דפי תשלום מתארחים
// חוזה מתועד ב-docs/superpowers/specs/grow-api-contract.md — אם ה-API בפועל שונה, עדכנו שם וכאן בלבד.
// שימו לב: אין Deno globals ברמת המודול — הפונקציות הטהורות נבדקות ב-Vitest (Node).

const SANDBOX_BASE = 'https://sandbox.meshulam.co.il/api/light/server/1.0'
const DEFAULT_PROD_BASE = 'https://meshulam.co.il/api/light/server/1.0'

export interface GrowCreds { user_id: string; page_code: string; sandbox?: boolean }
export interface GrowCreateParams {
  amount: number; description: string
  clientName: string; clientPhone: string | null | undefined; clientEmail?: string
  maxInstallments?: number
  successUrl: string; cancelUrl: string; notifyUrl: string
  paymentId: string // cField1 — חוזר אלינו ב-notify
}

export function growBaseUrl(creds: GrowCreds): string {
  if (creds.sandbox !== false) return SANDBOX_BASE
  // deno-lint-ignore no-explicit-any
  const env = (globalThis as any).Deno?.env?.get?.('GROW_BASE_URL_PROD')
  return env || DEFAULT_PROD_BASE
}

// נייד ישראלי בלבד (05X). מקבל פורמט מקומי/בינלאומי עם מקפים/רווחים.
export function normalizeIsraeliPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  let d = String(raw).replace(/\D/g, '')
  if (d.startsWith('972')) d = '0' + d.slice(3)
  if (!/^05\d{8}$/.test(d)) return null
  return d
}

export function buildCreateProcessForm(creds: GrowCreds, p: GrowCreateParams): Record<string, string> {
  const phone = normalizeIsraeliPhone(p.clientPhone)
  if (!phone) throw new Error('client_phone_required')
  const form: Record<string, string> = {
    pageCode: creds.page_code,
    userId: creds.user_id,
    sum: String(p.amount),
    description: p.description.slice(0, 250),
    chargeType: '1',
    successUrl: p.successUrl,
    cancelUrl: p.cancelUrl,
    notifyUrl: p.notifyUrl,
    'pageField[fullName]': p.clientName,
    'pageField[phone]': phone,
    cField1: p.paymentId,
  }
  if (p.clientEmail) form['pageField[email]'] = p.clientEmail
  if (p.maxInstallments && p.maxInstallments > 1) form.maxPaymentNum = String(Math.min(p.maxInstallments, 12))
  return form
}

// getPaymentProcessInfo: עסקה קיימת (transactionCode) = שולם; אחרת עדיין ממתין.
// Grow לא שולחים notify על כישלון — עמוד התשלום מאפשר ניסיון חוזר; לכן אין מיפוי ל-failed.
export function mapProcessInfo(data: unknown): { status: 'paid' | 'pending'; transactionCode?: string } {
  const d = (data ?? {}) as Record<string, unknown>
  const tc = d.transactionCode ? String(d.transactionCode) : undefined
  return { status: tc ? 'paid' : 'pending', transactionCode: tc }
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/grow.ts supabase/functions/_shared/grow.test.ts
git commit -m "feat(payments): Grow adapter — pure helpers (phone, form, status mapping) with tests"
```

---

### Task 4: Grow adapter — network functions

**Files:**
- Modify: `supabase/functions/_shared/grow.ts` (append)

**Interfaces:**
- Consumes: Task 3 helpers.
- Produces (used by Tasks 5–7):
  - `createPaymentLink(creds: GrowCreds, p: GrowCreateParams): Promise<{ url: string; providerRef: string; providerMeta: { process_token: string } }>`
  - `verifyTransaction(creds: GrowCreds, providerRef: string, providerMeta: { process_token?: string } | null): Promise<VerifyResult>` — `VerifyResult` shape identical to `cardcom.ts` (`{ status, paidAt?, invoiceUrl?, invoiceNumber?, raw }`).
  - `parseWebhook(req: Request): Promise<{ paymentId: string | null; providerRef: string | null; notifyBody: Record<string, string> }>`
  - `approveTransaction(creds: GrowCreds, notifyBody: Record<string, string>): Promise<void>` — logs and swallows failures.

- [ ] **Step 1: Append the network functions to `grow.ts`**

```ts
export interface VerifyResult {
  status: 'paid' | 'failed' | 'pending'
  paidAt?: string; invoiceUrl?: string; invoiceNumber?: string; raw: unknown
}

function toFormData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return fd
}

async function growPost(creds: GrowCreds, path: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`${growBaseUrl(creds)}/${path}`, { method: 'POST', body: toFormData(fields) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || (data as Record<string, unknown>).status !== 1) {
    throw new Error(`grow ${path} failed: http ${res.status} ${JSON.stringify((data as Record<string, unknown>).err ?? data)}`)
  }
  return data as Record<string, unknown>
}

export async function createPaymentLink(creds: GrowCreds, p: GrowCreateParams):
  Promise<{ url: string; providerRef: string; providerMeta: { process_token: string } }> {
  const data = await growPost(creds, 'createPaymentProcess', buildCreateProcessForm(creds, p))
  const d = (data.data ?? {}) as Record<string, unknown>
  if (!d.url || !d.processId || !d.processToken) throw new Error('grow createPaymentProcess: missing url/processId/processToken')
  return { url: String(d.url), providerRef: String(d.processId), providerMeta: { process_token: String(d.processToken) } }
}

export async function verifyTransaction(creds: GrowCreds, providerRef: string,
  providerMeta: { process_token?: string } | null): Promise<VerifyResult> {
  if (!providerMeta?.process_token) return { status: 'pending', raw: { error: 'missing process_token' } }
  const data = await growPost(creds, 'getPaymentProcessInfo', {
    pageCode: creds.page_code, processId: providerRef, processToken: providerMeta.process_token,
  })
  const mapped = mapProcessInfo(data.data)
  return {
    status: mapped.status,
    paidAt: mapped.status === 'paid' ? new Date().toISOString() : undefined,
    // חשבוניות מונפקות בצד Grow (ראו spec §8) — אין שדות מסמך ב-flow הזה כרגע
    raw: data,
  }
}

// ה-notify של Grow — form-encoded. cField1 = מזהה התשלום שלנו; processId = provider_ref.
export async function parseWebhook(req: Request):
  Promise<{ paymentId: string | null; providerRef: string | null; notifyBody: Record<string, string> }> {
  try {
    const body: Record<string, string> = {}
    const ct = req.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) {
      const data = await req.json()
      for (const [k, v] of Object.entries(data ?? {})) body[k] = String(v)
    } else {
      const form = await req.formData()
      for (const [k, v] of form.entries()) body[k] = String(v)
    }
    return { paymentId: body.cField1 ?? null, providerRef: body.processId ?? null, notifyBody: body }
  } catch {
    return { paymentId: null, providerRef: null, notifyBody: {} }
  }
}

// אישור קבלת העדכון — חובה, אחרת Grow שולחים שוב עד 5 פעמים. כישלון נרשם ולא מפיל את ה-webhook.
export async function approveTransaction(creds: GrowCreds, notifyBody: Record<string, string>): Promise<void> {
  try {
    await growPost(creds, 'approveTransaction', { ...notifyBody, pageCode: creds.page_code })
  } catch (e) {
    console.error(`grow approveTransaction failed (processId=${notifyBody.processId ?? '?'})`, e)
  }
}
```

- [ ] **Step 2: Run existing tests still pass** — `npm test` → green (pure helpers unaffected; network code has no top-level side effects).

- [ ] **Step 3: Lint** — `npm run lint` → no new errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/grow.ts
git commit -m "feat(payments): Grow adapter — createPaymentProcess/getPaymentProcessInfo/approveTransaction/notify parse"
```

---

### Task 5: Provider selection + dispatch in `create-payment-link`

**Files:**
- Create: `supabase/functions/_shared/providers.ts`
- Test: `supabase/functions/_shared/providers.test.ts`
- Modify: `supabase/functions/create-payment-link/index.ts`

**Interfaces:**
- Consumes: `cardcom.ts` and `grow.ts` adapters (Tasks 3–4).
- Produces: `pickAccount(accounts: Array<{ provider: string }>, requested?: string | null): { account?: T; error?: 'no_active_provider' | 'provider_required' }`; Edge Function response error codes `'no active provider'` (legacy string kept), `'provider_required'`, `'client_phone_required'` — consumed by Task 9's UI error mapping.

- [ ] **Step 1: Write the failing test** — create `supabase/functions/_shared/providers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pickAccount } from './providers.ts'

const cc = { id: '1', provider: 'cardcom' }
const gr = { id: '2', provider: 'grow' }

describe('pickAccount', () => {
  it('errors when no active accounts', () => {
    expect(pickAccount([], null)).toEqual({ error: 'no_active_provider' })
  })
  it('uses the single active account when none requested', () => {
    expect(pickAccount([gr], null)).toEqual({ account: gr })
  })
  it('requires explicit choice when several are active', () => {
    expect(pickAccount([cc, gr], null)).toEqual({ error: 'provider_required' })
  })
  it('honors the requested provider', () => {
    expect(pickAccount([cc, gr], 'grow')).toEqual({ account: gr })
  })
  it('errors when requested provider is not connected', () => {
    expect(pickAccount([cc], 'grow')).toEqual({ error: 'no_active_provider' })
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npm test` → FAIL (module not found).

- [ ] **Step 3: Implement** — create `supabase/functions/_shared/providers.ts`:

```ts
// בחירת חשבון סליקה לבקשה: מפורש > יחיד > דורש בחירה
export function pickAccount<T extends { provider: string }>(
  accounts: T[], requested?: string | null,
): { account?: T; error?: 'no_active_provider' | 'provider_required' } {
  if (requested) {
    const account = accounts.find((a) => a.provider === requested)
    return account ? { account } : { error: 'no_active_provider' }
  }
  if (accounts.length === 0) return { error: 'no_active_provider' }
  if (accounts.length > 1) return { error: 'provider_required' }
  return { account: accounts[0] }
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → green.

- [ ] **Step 5: Rewrite `supabase/functions/create-payment-link/index.ts`**

```ts
import { serviceClient, requireOrgAdmin, json, corsPreflight } from '../_shared/db.ts'
import * as cardcom from '../_shared/cardcom.ts'
import * as grow from '../_shared/grow.ts'
import { pickAccount } from '../_shared/providers.ts'

Deno.serve(async (req) => {
  const pre = corsPreflight(req); if (pre) return pre
  try {
    const { org_id, client_id, amount, description, max_installments, provider } = await req.json()
    if (!org_id || !client_id || !amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return json({ error: 'bad request' }, 400)
    if (provider && !['cardcom', 'grow'].includes(provider)) return json({ error: 'bad request' }, 400)

    const auth = await requireOrgAdmin(req, org_id)
    if (auth instanceof Response) return auth

    const svc = serviceClient()
    const [{ data: accounts }, { data: client }] = await Promise.all([
      svc.from('payment_provider_accounts').select('*')
        .eq('org_id', org_id).eq('is_active', true).eq('is_archived', false),
      svc.from('clients').select('id, org_id, name, email, phone').eq('id', client_id).maybeSingle(),
    ])
    const picked = pickAccount(accounts ?? [], provider ?? null)
    if (picked.error) {
      // תאימות לאחור: הלקוח הישן מצפה ל-'no active provider'
      return json({ error: picked.error === 'no_active_provider' ? 'no active provider' : picked.error }, 400)
    }
    const account = picked.account!
    if (!client || client.org_id !== org_id) return json({ error: 'client not found' }, 404)

    // ל-Grow חובה טלפון נייד ישראלי — נכשלים מוקדם עם קוד ייעודי ל-UI
    if (account.provider === 'grow' && !grow.normalizeIsraeliPhone(client.phone)) {
      return json({ error: 'client_phone_required' }, 400)
    }

    // יוצרים קודם שורת תשלום כדי לקבל id; אם יצירת הלינק תיכשל — מארכבים
    const { data: payment, error: insErr } = await svc.from('payments').insert({
      org_id, client_id, provider_account_id: account.id,
      amount: Number(amount), description: description ?? null,
      method: 'credit_card', status: 'pending', created_by: auth.userId,
    }).select().single()
    if (insErr) return json({ error: 'db insert failed' }, 500)

    try {
      const appUrl = Deno.env.get('APP_BASE_URL') ?? 'https://base-crm-kohl.vercel.app'
      const webhookSecret = Deno.env.get('PAYMENT_WEBHOOK_SECRET')
      const webhook = new URL(`${Deno.env.get('SUPABASE_URL')}/functions/v1/payment-webhook`)
      if (webhookSecret) webhook.searchParams.set('s', webhookSecret)

      let url: string, providerRef: string, providerMeta: Record<string, string> | null = null
      if (account.provider === 'grow') {
        webhook.searchParams.set('provider', 'grow')
        const r = await grow.createPaymentLink(account.credentials, {
          amount: Number(amount), description: description || 'תשלום',
          clientName: client.name, clientPhone: client.phone, clientEmail: client.email ?? undefined,
          maxInstallments: max_installments ? Number(max_installments) : undefined,
          successUrl: `${appUrl}/pay/thanks`, cancelUrl: `${appUrl}/pay/thanks?failed=1`,
          notifyUrl: webhook.toString(), paymentId: payment.id,
        })
        url = r.url; providerRef = r.providerRef; providerMeta = r.providerMeta
      } else {
        const r = await cardcom.createPaymentLink(account.credentials, {
          amount: Number(amount), description: description ?? 'תשלום',
          clientName: client.name, clientEmail: client.email ?? undefined,
          maxInstallments: max_installments ? Number(max_installments) : undefined,
          autoInvoice: account.settings?.auto_invoice !== false,
          successUrl: `${appUrl}/pay/thanks`, failedUrl: `${appUrl}/pay/thanks?failed=1`,
          webhookUrl: webhook.toString(),
          paymentId: payment.id,
        })
        url = r.url; providerRef = r.providerRef
      }
      await svc.from('payments').update({ payment_link: url, provider_ref: providerRef, provider_meta: providerMeta }).eq('id', payment.id)
      return json({ payment_id: payment.id, url })
    } catch (e) {
      await svc.from('payments').update({ is_archived: true }).eq('id', payment.id)
      console.error('create link failed', e)
      const msg = e instanceof Error && e.message === 'client_phone_required' ? 'client_phone_required' : 'provider error'
      return json({ error: msg }, msg === 'client_phone_required' ? 400 : 502)
    }
  } catch (e) {
    console.error(e)
    return json({ error: 'internal' }, 500)
  }
})
```

- [ ] **Step 6: Verify** — `npm test` (green) and `npm run lint` (no new errors). Note: Cardcom's webhook URL is now built via `URL` — same effective URL (`?s=...`), no `provider` param, so existing links/webhooks are unaffected.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/providers.ts supabase/functions/_shared/providers.test.ts supabase/functions/create-payment-link/index.ts
git commit -m "feat(payments): provider dispatch in create-payment-link (cardcom/grow)"
```

---

### Task 6: Webhook routing + Grow settlement

**Files:**
- Modify: `supabase/functions/payment-webhook/index.ts`

**Interfaces:**
- Consumes: `grow.parseWebhook`, `grow.verifyTransaction`, `grow.approveTransaction` (Task 4); existing `cardcom.parseWebhook`/`verifyTransaction`.
- Produces: webhook accepts `?provider=grow`; absent/other ⇒ Cardcom path unchanged.

- [ ] **Step 1: Rewrite `supabase/functions/payment-webhook/index.ts`**

```ts
import { serviceClient, json } from '../_shared/db.ts'
import * as cardcom from '../_shared/cardcom.ts'
import * as grow from '../_shared/grow.ts'

// השוואת מחרוזות בזמן קבוע (מונע time-based side-channel על הסוד)
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// עדכון תשלום שהוסדר — משותף לשני הספקים
async function settle(svc: ReturnType<typeof serviceClient>, paymentId: string,
  result: { status: string; paidAt?: string; invoiceUrl?: string; invoiceNumber?: string; raw: unknown }) {
  if (result.status === 'pending') return
  await svc.from('payments').update({
    status: result.status,
    paid_at: result.status === 'paid' ? (result.paidAt ?? new Date().toISOString()) : null,
    invoice_url: result.invoiceUrl ?? null,
    invoice_number: result.invoiceNumber ?? null,
    raw_webhook: result.raw,
    is_archived: false,
  }).eq('id', paymentId)
}

Deno.serve(async (req) => {
  // אימות סוד משותף — נאכף רק אם הוגדר PAYMENT_WEBHOOK_SECRET (תאימות לאחור).
  const params = new URL(req.url).searchParams
  const expectedSecret = Deno.env.get('PAYMENT_WEBHOOK_SECRET')
  if (expectedSecret && !safeEqual(params.get('s') ?? '', expectedSecret)) return json({ error: 'forbidden' }, 401)

  const svc = serviceClient()
  try {
    if (params.get('provider') === 'grow') {
      const { paymentId, providerRef, notifyBody } = await grow.parseWebhook(req)
      if (!paymentId && !providerRef) return json({ ok: true })

      // איתור לפי המזהה שלנו (cField1); נפילה חזרה ל-provider_ref (processId)
      let payment = null
      if (paymentId) ({ data: payment } = await svc.from('payments').select('*').eq('id', paymentId).maybeSingle())
      if (!payment && providerRef) ({ data: payment } = await svc.from('payments').select('*').eq('provider_ref', providerRef).maybeSingle())
      if (!payment) return json({ ok: true })

      const { data: account } = await svc.from('payment_provider_accounts')
        .select('credentials').eq('id', payment.provider_account_id).maybeSingle()
      if (!account) return json({ ok: true })

      if (payment.status !== 'paid') {
        // לעולם לא סומכים על גוף ה-notify — מאמתים מול Grow
        const result = await grow.verifyTransaction(account.credentials, payment.provider_ref, payment.provider_meta)
        await settle(svc, payment.id, result)
      }
      // חובה לאשר קבלה גם אם כבר שולם (idempotent אצלנו; מונע 5 שליחות חוזרות)
      await grow.approveTransaction(account.credentials, notifyBody)
      return json({ ok: true })
    }

    // ברירת מחדל: Cardcom — נתיב קיים ללא שינוי התנהגות
    const { providerRef } = await cardcom.parseWebhook(req)
    if (!providerRef) return json({ ok: true })

    const { data: payment } = await svc.from('payments').select('*').eq('provider_ref', providerRef).maybeSingle()
    if (!payment || payment.status === 'paid') return json({ ok: true })

    const { data: account } = await svc.from('payment_provider_accounts')
      .select('credentials').eq('id', payment.provider_account_id).maybeSingle()
    if (!account) return json({ ok: true })

    const result = await cardcom.verifyTransaction(account.credentials, providerRef)
    await settle(svc, payment.id, result)
    return json({ ok: true })
  } catch (e) {
    console.error('webhook error', e)
    return json({ ok: true }) // 200 תמיד — נדיאג דרך הלוגים
  }
})
```

- [ ] **Step 2: Verify** — `npm test` + `npm run lint` → green/clean. Confirm `supabase/config.toml` still lists `payment-webhook` with `verify_jwt = false` (same endpoint — no config change expected).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/payment-webhook/index.ts
git commit -m "feat(payments): webhook routes ?provider=grow — verify via getPaymentProcessInfo + approveTransaction ack"
```

---

### Task 7: `check-payment-status` dispatch

**Files:**
- Modify: `supabase/functions/check-payment-status/index.ts`

**Interfaces:**
- Consumes: both adapters' `verifyTransaction`; account row now selected with `provider` column.

- [ ] **Step 1: Update the function** — full new content:

```ts
import { serviceClient, requireOrgMember, json, corsPreflight } from '../_shared/db.ts'
import * as cardcom from '../_shared/cardcom.ts'
import * as grow from '../_shared/grow.ts'

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
      .select('provider, credentials').eq('id', payment.provider_account_id).maybeSingle()
    if (!account) return json({ error: 'no provider' }, 400)

    const result = account.provider === 'grow'
      ? await grow.verifyTransaction(account.credentials, payment.provider_ref, payment.provider_meta)
      : await cardcom.verifyTransaction(account.credentials, payment.provider_ref)
    if (result.status !== 'pending') {
      await svc.from('payments').update({
        status: result.status,
        paid_at: result.status === 'paid' ? (result.paidAt ?? new Date().toISOString()) : null,
        invoice_url: result.invoiceUrl ?? null,
        invoice_number: result.invoiceNumber ?? null,
        raw_webhook: result.raw,
        is_archived: false,
      }).eq('id', payment.id)
    }
    return json({ status: result.status })
  } catch (e) {
    console.error(e)
    return json({ error: 'internal' }, 500)
  }
})
```

- [ ] **Step 2: Verify** — `npm test` + `npm run lint`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/check-payment-status/index.ts
git commit -m "feat(payments): check-payment-status dispatches by account provider"
```

---

### Task 8: Org settings — two provider cards

**Files:**
- Modify: `src/components/crm/PaymentProviderManager.jsx` (full rewrite; keep filename and default export so `OrgSettingsPage.jsx` is untouched)

**Interfaces:**
- Consumes: `save_payment_provider_v2` RPC (Task 1), `payment_provider_accounts_safe` view, `create-payment-link` with `provider` (Task 5).
- Produces: `data-testid`s — Cardcom card keeps ALL existing testids (`payment-provider-manager`, `provider-terminal-input`, `provider-apiname-input`, `provider-apipassword-input`, `provider-autoinvoice-checkbox`, `provider-save-btn`, `provider-test-btn`, `provider-active-toggle`, `provider-test-url`); Grow card adds `payment-provider-grow`, `provider-grow-userid-input`, `provider-grow-pagecode-input`, `provider-grow-sandbox-checkbox`, `provider-grow-save-btn`, `provider-grow-test-btn`, `provider-grow-active-toggle`, `provider-grow-test-url`.

- [ ] **Step 1: Rewrite the component**

```jsx
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import Button from '../ui/Button'
import Input from '../ui/Input'
import { handleEnterAsTab } from '../../lib/formNav'

// חיבור חשבונות סליקה (Cardcom + Grow) — אדמינים בלבד, מוצג בהגדרות הארגון

// בדיקת חיבור משותפת: יוצרים לינק אמיתי על ₪1 ומארכבים מיד
async function runConnectionTest(orgId, provider, toast, setTestUrl) {
  const { data: client } = await supabase.from('clients')
    .select('id').eq('org_id', orgId).eq('is_archived', false).limit(1).maybeSingle()
  if (!client) { toast('נדרש לפחות לקוח אחד בארגון לבדיקה.', 'error'); return }
  const { data, error } = await supabase.functions.invoke('create-payment-link', {
    body: { org_id: orgId, client_id: client.id, amount: 1, description: 'בדיקת חיבור — נא לא לשלם', provider },
  })
  if (error || data?.error) throw new Error(data?.error || error.message)
  setTestUrl(data.url)
  const { error: archiveError } = await supabase.from('payments').update({ is_archived: true }).eq('id', data.payment_id)
  if (archiveError) {
    toast('החיבור תקין, אך ניקוי תשלום הבדיקה נכשל — ארכבו אותו ידנית מדף התשלומים.', 'error')
  } else {
    toast('החיבור תקין ✓')
  }
}

function ActiveToggle({ account, onToggled, testid }) {
  if (!account) return null
  async function toggle() {
    const { error } = await supabase.from('payment_provider_accounts')
      .update({ is_active: !account.is_active }).eq('id', account.id)
    if (!error) onToggled()
  }
  return (
    <button type="button" onClick={toggle}
      className={`rounded-full border px-2 py-0.5 text-xs ${account.is_active ? 'border-emerald-500/30 text-emerald-400' : 'border-border text-text-dim'}`}
      data-testid={testid}>
      {account.is_active ? 'פעיל' : 'כבוי'}
    </button>
  )
}

function CardcomCard({ orgId, account, reload }) {
  const { toast } = useToast()
  const [terminal, setTerminal] = useState(account?.credentials?.terminal_number ?? '')
  const [apiName, setApiName] = useState(account?.credentials?.api_name ?? '')
  const [apiPassword, setApiPassword] = useState('')
  const [autoInvoice, setAutoInvoice] = useState(account?.settings?.auto_invoice !== false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testUrl, setTestUrl] = useState('')
  const hasPassword = !!account?.has_password

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.rpc('save_payment_provider_v2', {
      p_org_id: orgId, p_provider: 'cardcom',
      p_credentials: { terminal_number: terminal.trim(), api_name: apiName.trim() },
      p_secret: apiPassword || null,
      p_settings: { auto_invoice: autoInvoice, document_type: 'invoice_receipt', language: 'he' },
    })
    setSaving(false)
    if (error) { toast('שמירת החיבור נכשלה.', 'error'); return }
    toast('חיבור הסליקה נשמר')
    setApiPassword('')
    reload()
  }

  async function test() {
    setTesting(true); setTestUrl('')
    try { await runConnectionTest(orgId, 'cardcom', toast, setTestUrl) }
    catch { toast('בדיקת החיבור נכשלה — בדקו את פרטי ה-API.', 'error') }
    finally { setTesting(false) }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="payment-provider-manager">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-text">תשלומים וסליקה (Cardcom)</h2>
        <ActiveToggle account={account} onToggled={reload} testid="provider-active-toggle" />
      </div>
      <form onSubmit={save} onKeyDown={handleEnterAsTab} className="space-y-3">
        <Input label="מספר טרמינל" value={terminal} onChange={(e) => setTerminal(e.target.value)} dir="ltr" data-testid="provider-terminal-input" required />
        <Input label="API Name" value={apiName} onChange={(e) => setApiName(e.target.value)} dir="ltr" data-testid="provider-apiname-input" required />
        <Input label="API Password" type="password" value={apiPassword} onChange={(e) => setApiPassword(e.target.value)} dir="ltr"
          placeholder={hasPassword ? '•••••• — שמורה. השאירו ריק כדי לא לשנות' : ''}
          autoComplete="new-password" data-testid="provider-apipassword-input" />
        <label className="flex items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={autoInvoice} onChange={(e) => setAutoInvoice(e.target.checked)} data-testid="provider-autoinvoice-checkbox" />
          הפקת חשבונית מס/קבלה אוטומטית בכל תשלום
        </label>
        <div className="flex gap-2">
          <Button type="submit" loading={saving} data-testid="provider-save-btn">שמירה</Button>
          {account && (
            <Button type="button" variant="secondary" loading={testing} onClick={test} data-testid="provider-test-btn">בדוק חיבור</Button>
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

function GrowCard({ orgId, account, reload }) {
  const { toast } = useToast()
  const [userId, setUserId] = useState(account?.credentials?.user_id ?? '')
  const [pageCode, setPageCode] = useState(account?.credentials?.page_code ?? '')
  const [sandbox, setSandbox] = useState(account?.credentials?.sandbox !== false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testUrl, setTestUrl] = useState('')

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.rpc('save_payment_provider_v2', {
      p_org_id: orgId, p_provider: 'grow',
      p_credentials: { user_id: userId.trim(), page_code: pageCode.trim(), sandbox },
      p_secret: null, p_settings: {},
    })
    setSaving(false)
    if (error) { toast('שמירת החיבור נכשלה.', 'error'); return }
    toast('חיבור הסליקה נשמר')
    reload()
  }

  async function test() {
    setTesting(true); setTestUrl('')
    try { await runConnectionTest(orgId, 'grow', toast, setTestUrl) }
    catch (e) {
      toast(e?.message === 'client_phone_required'
        ? 'ללקוח הבדיקה אין טלפון נייד תקין — נדרש עבור Grow.'
        : 'בדיקת החיבור נכשלה — בדקו את פרטי החיבור.', 'error')
    }
    finally { setTesting(false) }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="payment-provider-grow">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-text">תשלומים וסליקה (Grow)</h2>
        <ActiveToggle account={account} onToggled={reload} testid="provider-grow-active-toggle" />
      </div>
      <form onSubmit={save} onKeyDown={handleEnterAsTab} className="space-y-3">
        <Input label="User ID" value={userId} onChange={(e) => setUserId(e.target.value)} dir="ltr" data-testid="provider-grow-userid-input" required />
        <Input label="Page Code" value={pageCode} onChange={(e) => setPageCode(e.target.value)} dir="ltr" data-testid="provider-grow-pagecode-input" required />
        <label className="flex items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} data-testid="provider-grow-sandbox-checkbox" />
          סביבת בדיקות (Sandbox)
        </label>
        <p className="text-xs text-text-muted">חשבוניות מונפקות דרך מודול החשבוניות של Grow (מוגדר בחשבון Grow שלכם), לא דרך המערכת.</p>
        <div className="flex gap-2">
          <Button type="submit" loading={saving} data-testid="provider-grow-save-btn">שמירה</Button>
          {account && (
            <Button type="button" variant="secondary" loading={testing} onClick={test} data-testid="provider-grow-test-btn">בדוק חיבור</Button>
          )}
        </div>
        {testUrl && (
          <p className="text-xs text-text-muted" data-testid="provider-grow-test-url">
            נוצר לינק בדיקה בהצלחה: <a className="text-accent hover:underline" href={testUrl} target="_blank" rel="noreferrer">צפייה (אין לשלם)</a>
          </p>
        )}
      </form>
    </section>
  )
}

export default function PaymentProviderManager({ orgId }) {
  const [accounts, setAccounts] = useState(null) // null = טוען

  const load = useCallback(async () => {
    const { data } = await supabase.from('payment_provider_accounts_safe')
      .select('*').eq('org_id', orgId).eq('is_archived', false)
    setAccounts(data ?? [])
  }, [orgId])
  useEffect(() => { load() }, [load])

  if (accounts === null) return null
  const byProvider = Object.fromEntries(accounts.map((a) => [a.provider, a]))
  return (
    <div className="space-y-4">
      {/* key מאלץ רימאונט אחרי טעינה-מחדש כדי לרענן ערכים התחלתיים מהשרת */}
      <CardcomCard key={`cc-${byProvider.cardcom?.id ?? 'new'}`} orgId={orgId} account={byProvider.cardcom} reload={load} />
      <GrowCard key={`gr-${byProvider.grow?.id ?? 'new'}`} orgId={orgId} account={byProvider.grow} reload={load} />
    </div>
  )
}
```

- [ ] **Step 2: Verify** — `npm run lint` + `npm test` green; `npm run build` succeeds. Manual check in dev (`npm run dev`): org settings shows both cards; Cardcom card behaves as before (existing values load, password placeholder shows when saved).

- [ ] **Step 3: Commit**

```bash
git add src/components/crm/PaymentProviderManager.jsx
git commit -m "feat(payments): org settings — Cardcom + Grow connection cards via save_payment_provider_v2"
```

---

### Task 9: Payment-link modal — provider dropdown

**Files:**
- Modify: `src/components/crm/AddPaymentModal.jsx`

**Interfaces:**
- Consumes: `PAYMENT_PROVIDERS` (Task 2); `create-payment-link` `provider` body field + error codes `client_phone_required` / `provider_required` / legacy `no active provider` (Task 5).
- Produces: `data-testid="payment-provider-select"` (rendered only when 2+ active providers).

- [ ] **Step 1: Add provider state + loading** — in `AddPaymentModal.jsx`:

Change the react import to `import { useState, useEffect } from 'react'` and the payments import to `import { PAYMENT_METHODS, PAYMENT_PROVIDERS } from '../../lib/payments'`.

Add after the existing state declarations:

```jsx
  const [providers, setProviders] = useState([])   // ספקים פעילים של הארגון
  const [provider, setProvider] = useState('')

  useEffect(() => {
    if (!open) return
    supabase.from('payment_provider_accounts_safe')
      .select('provider').eq('org_id', orgId).eq('is_archived', false).eq('is_active', true)
      .then(({ data }) => {
        const list = (data ?? []).map((a) => a.provider)
        setProviders(list)
        setProvider(list.includes('cardcom') ? 'cardcom' : (list[0] ?? ''))
      })
  }, [open, orgId])
```

- [ ] **Step 2: Send the provider + map new errors** — in `createLink`, replace the invoke + error handling:

```jsx
    const { data, error: err } = await supabase.functions.invoke('create-payment-link', {
      body: {
        org_id: orgId, client_id: clientId, amount: amt, description: description.trim(),
        max_installments: Number(maxInstallments) || 1,
        ...(providers.length > 1 ? { provider } : {}),
      },
    })
    setSaving(false)
    if (err || data?.error) {
      const code = data?.error
      setError(
        code === 'no active provider' ? 'אין חשבון סליקה פעיל — חברו ספק בהגדרות הארגון.'
        : code === 'client_phone_required' ? 'ללקוח אין מספר טלפון נייד תקין — נדרש עבור סליקה ב-Grow. עדכנו את כרטיס הלקוח.'
        : code === 'provider_required' ? 'יש לבחור ספק סליקה.'
        : 'יצירת הקישור נכשלה.')
      return
    }
```

- [ ] **Step 3: Render the dropdown** — in the link-mode form, directly above the installments `<label>`:

```jsx
          {providers.length > 1 && (
            <label className="block">
              <span className="mb-1 block text-sm text-text-muted">ספק סליקה</span>
              <select value={provider} onChange={(e) => setProvider(e.target.value)}
                className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text outline-none focus:border-accent"
                data-testid="payment-provider-select">
                {providers.map((pr) => (
                  <option key={pr} value={pr}>{PAYMENT_PROVIDERS[pr]?.label || pr}</option>
                ))}
              </select>
            </label>
          )}
```

- [ ] **Step 4: Verify** — `npm run lint`, `npm test`, `npm run build` all pass. Manual dev check: with one active provider the modal is identical to before (no dropdown, no `provider` in the request).

- [ ] **Step 5: Commit**

```bash
git add src/components/crm/AddPaymentModal.jsx
git commit -m "feat(payments): provider dropdown in payment-link modal (shown for 2+ active providers)"
```

---

### Task 10: Grow API contract doc + deploy/E2E checklist

**Files:**
- Create: `docs/superpowers/specs/grow-api-contract.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Write the contract doc**

```markdown
# Grow (Meshulam light-server) API Contract — as implemented

Source: https://developers.grow.business (public docs) + sandbox verification. The adapter
(`supabase/functions/_shared/grow.ts`) depends on THIS contract; if sandbox testing reveals
differences, update this file and the adapter together.

## Base URLs
- Sandbox: `https://sandbox.meshulam.co.il/api/light/server/1.0` (hardcoded)
- Production: `GROW_BASE_URL_PROD` env var (issued by Grow after sandbox approval; fallback `https://meshulam.co.il/api/light/server/1.0`)

All calls: server-side POST, FormData body, response JSON `{ status: 1 | 0, data | err }`.

## createPaymentProcess
Sent: `pageCode, userId, sum, description, chargeType=1, successUrl, cancelUrl, notifyUrl,
pageField[fullName], pageField[phone] (05XXXXXXXX), pageField[email]?, cField1=<payments.id>,
maxPaymentNum? (2-12)`
Expected `data`: `{ url, processId, processToken, authCode? }` — `provider_ref`=processId,
`payments.provider_meta.process_token`=processToken.

## notify (server-to-server, notifyUrl)
Form-encoded POST. Fields per docs: `transactionCode, paymentSum, paymentDate, fullName,
payerEmail, payerPhone, cardSuffix, cardBrand, cardType, processId, processToken, cField1`.
NEVER trusted — only triggers getPaymentProcessInfo. Webhooks may need enabling by Grow support.

## getPaymentProcessInfo
Sent: `pageCode, processId, processToken`.
Mapping (confirm in sandbox — update here + mapProcessInfo if wrong): `data.transactionCode`
present ⇒ paid; otherwise pending. Grow does not notify on failure (the payment page loops for
retry), so `failed` is never produced by this adapter.

## approveTransaction
Sent: entire notify body + `pageCode`. Mandatory acknowledgment after each server update;
non-acked updates are re-sent up to 5 times. Failures are logged, never fatal.

## Sandbox test data
Cards: 4580000000000000, 4580111111111121 (success), 4580458045804580 (recurring-fail).
Bank: bank 41, branch 410, account 411111111. Bit/Google Pay/Apple Pay have NO sandbox (real
charges) — do not test them. PayBox does not work in sandbox.

## Deploy checklist (run in order)
1. Run `supabase/migration_021_grow_provider.sql` in Supabase → SQL Editor.
2. Deploy functions: `supabase functions deploy create-payment-link payment-webhook check-payment-status`.
3. (When production credentials arrive) `supabase secrets set GROW_BASE_URL_PROD=<url from Grow>`.
4. Sandbox E2E: connect Grow card (sandbox checked) in org settings → "בדוק חיבור" → create a
   real link for a client WITH a mobile phone → pay with 4580000000000000 → payment flips to
   "שולם" via webhook → Grow dashboard shows the notify acked (no repeats).
5. Regression: Cardcom link + payment still settle; org with only Cardcom sees no dropdown.
```

- [ ] **Step 2: Full verification sweep** — `npm test`, `npm run lint`, `npm run build` → all green.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/grow-api-contract.md
git commit -m "docs(payments): Grow API contract + deploy/E2E checklist"
```
