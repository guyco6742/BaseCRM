# Payments Module — Design Spec

**Date:** 2026-07-07
**Status:** Approved by user (brainstorming session)
**Scope:** Phase A — organizations collect payments from their CRM clients. Phase B (BaseCRM SaaS billing of orgs) is explicitly out of scope for this spec and will get its own spec later.

## 1. Goal

Let each BaseCRM organization (e.g., Tonika) charge its clients and track payments:

1. **Manual payment tracking** — record cash / bank-transfer / check payments on the client card.
2. **One-time payment links** — create a charge (amount + description + optional installments), send the client a hosted payment-page link (WhatsApp/email), status updates automatically on payment.
3. **Auto invoice/receipt** — חשבונית מס/קבלה issued automatically on successful payment (legal requirement in Israel).
4. **Recurring charges** — monthly standing charges (הוראת קבע) for ongoing services.

## 2. Market constraints (Israel) — why the architecture looks like this

- **Stripe does not onboard Israeli businesses.** Realistic PSPs: Cardcom, Grow (Meshulam), PayPlus, Tranzila.
- **Each org must have its own clearing account (חשבון סליקה).** Funds must flow payer → org directly. BaseCRM must NOT touch the money (that would make it a regulated payment facilitator). Therefore: each org connects **its own PSP credentials** in org settings.
- **Invoice/receipt is legally required per payment.** First provider is **Cardcom** because one integration covers hosted payment pages + installments + recurring + built-in document (invoice/receipt) issuing. Grow/PayPlus can be added later via the adapter interface.
- The payer enters card details only on the PSP's hosted page — PCI compliance stays with the PSP.

## 3. Architecture (approved: "Approach 1")

Per-org PSP credentials, stored server-readable-only for members; Supabase **Edge Functions** do all PSP API calls and receive webhooks; hosted payment pages; provider-agnostic adapter. This is the project's **first server-side code** (`supabase/functions/`).

Rejected alternatives: frontend-only integration (secrets exposed to browser, no webhooks) and BaseCRM-as-payment-facilitator (regulatory licensing).

## 4. Data model — `supabase/migration_014_payments.sql`

Follow existing conventions: denormalized `org_id` on every table, RLS keyed on org membership, soft-delete via `is_archived` (NO DELETE policies — hard project rule), `created_at`/`updated_at`, `data-testid` in UI.

### `payment_provider_accounts`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| org_id | uuid not null → organizations | |
| provider | text not null default 'cardcom' | 'cardcom' \| 'grow' \| 'payplus' |
| display_name | text | |
| credentials | jsonb not null default '{}' | Cardcom: `{ terminal_number, api_name, api_password }` |
| settings | jsonb not null default '{}' | e.g. `{ auto_invoice: true, document_type: 'invoice_receipt', language: 'he' }` |
| is_active | boolean default true | |
| is_archived | boolean default false | |
| created_at | timestamptz | |

**RLS (mirrors `lead_sources`):** SELECT/INSERT/UPDATE for **org admins only** (admins typed the credentials, so they may read them back; members get nothing). No DELETE. Edge Functions read via service_role.

### `payments` (the ledger)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| org_id | uuid not null → organizations | |
| client_id | uuid not null → clients | |
| provider_account_id | uuid null → payment_provider_accounts | null = manual record |
| kind | text default 'one_time' | 'one_time' \| 'subscription_charge' |
| method | text | 'credit_card' \| 'bit' \| 'cash' \| 'bank_transfer' \| 'check' \| 'other' |
| amount | numeric(12,2) not null, check > 0 | |
| currency | text not null default 'ILS' | fixed ILS for now |
| description | text | |
| status | text not null default 'pending' | 'pending' \| 'paid' \| 'failed' \| 'canceled' \| 'refunded' |
| due_date | date | |
| paid_at | timestamptz | |
| payment_link | text | hosted-page URL |
| provider_ref | text unique | PSP transaction / LowProfile id — **webhook idempotency key** |
| invoice_url | text | |
| invoice_number | text | |
| raw_webhook | jsonb | last webhook payload, audit |
| created_by | uuid → profiles | |
| is_archived | boolean default false | |
| created_at / updated_at | timestamptz | |

**RLS:** org members SELECT/INSERT/UPDATE within their org (same shape as `clients`). No DELETE.
**Hardening trigger:** BEFORE UPDATE — if the row has `provider_ref` set and the caller is not service_role, block changes to `status`/`paid_at`/`invoice_*` (provider-linked payments settle only via webhook; manual rows can be marked paid by hand).

**Indexes:** `(org_id)`, `(client_id)`, `(org_id, status)`, unique on `provider_ref`.

### `payment_subscriptions` (delivery step 3)
`id, org_id, client_id, provider_account_id, amount, currency, description, day_of_month int, status ('active'|'paused'|'canceled'), provider_ref, next_charge_at, is_archived, created_at, updated_at`. Each successful cycle inserts a `payments` row with `kind='subscription_charge'`.

## 5. Server side — Edge Functions (`supabase/functions/`)

### Adapter interface (shared module)
```ts
interface PaymentAdapter {
  createPaymentLink(creds, { amount, description, clientName, clientEmail, maxInstallments, autoInvoice, successUrl, webhookUrl }): Promise<{ url, providerRef }>
  verifyTransaction(creds, providerRef): Promise<{ status: 'paid'|'failed'|'pending', paidAt?, invoiceUrl?, invoiceNumber?, raw }>
  parseWebhook(req): { providerRef, claimedStatus }
}
```
First implementation: `cardcom.ts` (LowProfile hosted-page API). **Verify exact current API endpoints/fields against Cardcom's docs during implementation — do not trust memory.**

### `create-payment-link` (JWT verified)
1. Authenticate caller from JWT; verify org membership (service_role query on `memberships`, honoring the super-admin fallback).
2. Load the org's active `payment_provider_accounts` row.
3. Call `adapter.createPaymentLink(...)`.
4. Insert `payments` row: status `pending`, `payment_link`, `provider_ref`.
5. Return `{ payment_id, url }`.

### `payment-webhook` (public, no JWT)
1. `adapter.parseWebhook(req)` → `provider_ref`.
2. **Never trust the payload**: Cardcom callbacks are not signed, so call `adapter.verifyTransaction()` to re-query the PSP before changing anything.
3. Update the payment row (status, `paid_at`, `invoice_url`, `invoice_number`, `raw_webhook`). Idempotent: already-`paid` rows are not re-processed.
4. Return 200 always (avoid PSP retry storms); log anomalies.

### `check-payment-status` (JWT verified) — fallback for missed webhooks
Given `payment_id` (pending, provider-linked), re-query via `verifyTransaction` and update. Powers the "בדוק סטטוס" button.

Secrets: Edge Functions use `SUPABASE_SERVICE_ROLE_KEY` from function env (never in the frontend bundle).

## 6. UI (Hebrew RTL, dark theme, existing patterns)

1. **Org settings → "תשלומים וסליקה" section** (`PaymentProviderManager.jsx`, mirrors `LeadSourcesManager`): provider select (Cardcom first), credentials form, auto-invoice toggle, active toggle, connection-test button ("בדוק חיבור": creates a real ₪1 payment link via `create-payment-link` and shows it without sending — proves credentials work end-to-end; the test payment row is created archived).
2. **Client card (`ClientPage.jsx`) → "תשלומים" section**: payment history (date, amount, description, method, status chip, invoice link) + "הוסף תשלום" button opening `AddPaymentModal.jsx` with two modes:
   - **Manual record**: method, amount, description, paid/pending, paid date.
   - **Payment link** (only when org has an active provider): amount, description, max installments → returns link with copy button + WhatsApp share (`https://wa.me/<client-phone>?text=...`).
   Pending provider payments show a "בדוק סטטוס" refresh action.
3. **Org payments page** `/org/:orgId/payments` (`PaymentsPage.jsx`): all-org payments table — filters (status, date range, client), totals row (sum pending / sum paid), CSV export reusing `exportRowsToCSV` from `src/lib/csv.js`.
4. **Payer-facing**: payment happens on the PSP's hosted page; success redirect lands on a minimal public `/pay/thanks` route.

Status chips: pending=amber, paid=green, failed/canceled=red, refunded=gray. `formNav.js` `handleEnterAsTab` wired on new forms per convention.

## 7. Delivery steps (each independently shippable)

1. **Ledger (no PSP needed):** migration 014 (all three tables can ship now; subscriptions can also wait), manual payments UI on client card, org payments page, CSV export. Tonika can track payments immediately.
2. **Cardcom integration:** adapter + 3 Edge Functions, provider-connect UI, payment-link mode in the modal, webhook settlement, auto-invoice. Requires opening a Cardcom account (use their sandbox/test terminal first).
3. **Recurring + installments:** installments = parameter on the payment link (effectively ships with step 2); recurring = `payment_subscriptions` UI + Cardcom recurring API.

**Phase B (separate spec later):** BaseCRM charges orgs (plans, trials, enforcement) — reuses the same adapter/Edge-Function infrastructure with BaseCRM as the merchant.

## 8. Error handling

- Webhook missed → "בדוק סטטוס" re-query button; consider a daily sweep later (out of scope).
- Link-creation failure → error surfaced in modal, no payment row left behind (insert after successful PSP call).
- Duplicate webhooks → idempotent by unique `provider_ref` + skip already-paid.
- Provider misconfigured/inactive → payment-link mode hidden/disabled with explanatory text.

## 9. Testing

- Pure logic (status transitions, Cardcom payload mapping, filter/sum helpers) as unit-testable pure functions in `src/lib/payments.js` and the shared adapter module.
- E2E against Cardcom's test terminal before any real charge.
- `data-testid` on all new interactive elements (Cypress/Playwright convention).
- RLS pen-test additions: member cannot read `payment_provider_accounts`; anon cannot read/write `payments`; cross-tenant reads return empty; client-side status flip on provider-linked payment is blocked.

## 10. Security summary

- PSP credentials: admin-only RLS, never in frontend bundle; Edge Functions read via service_role.
- Webhook trust: verify-by-requery, never trust unsigned callbacks.
- Money settlement fields immutable from the client for provider-linked rows (trigger).
- No DELETE policies (soft-delete rule).
- Payer card data never touches BaseCRM (hosted pages only).
