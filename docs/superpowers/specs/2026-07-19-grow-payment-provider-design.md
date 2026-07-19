# Grow Payment Provider — Design Spec

**Date:** 2026-07-19
**Status:** Approved by user (brainstorming session)
**Scope:** Add Grow (developers.grow.business — the rebranded Meshulam "light server" API) as a second clearing provider alongside Cardcom. Per-org credentials, sandbox-first, provider dropdown at payment-link creation. Recurring charges (הוראת קבע) via Grow are out of scope for this spec.

## 1. Goal

Organizations can connect a Grow clearing account (in addition to, or instead of, Cardcom) and create one-time hosted payment links through it. When both providers are connected and active, the admin picks the provider per payment link via a dropdown. Everything else — payments ledger, statuses, webhook-driven settlement — behaves identically regardless of provider.

## 2. Approved decisions

1. **Per-org credentials** — each org enters its own Grow `userId` + `pageCode` in org settings (same model as Cardcom; no platform-level apiKey agreement).
2. **Sandbox first** — integration targets `https://sandbox.meshulam.co.il/api/light/server/1.0/`; a per-account `sandbox` flag switches to the production base URL once Grow issues live credentials.
3. **Dropdown in the payment-link modal** — provider selection happens at link-creation time (AddPaymentModal), shown only when the org has 2+ active providers. Org settings shows both connection cards.

## 3. Grow API contract (as known from public docs)

Base URL: sandbox `https://sandbox.meshulam.co.il/api/light/server/1.0/`; production URL issued by Grow after testing. All requests are server-side `POST` with **FormData** bodies.

- **`createPaymentProcess`** — required: `pageCode`, `userId`, `sum`, `description`, `successUrl` (https), `cancelUrl`, `pageField[fullName]` (min two names), `pageField[phone]` (Israeli mobile). Optional: `chargeType=1`, `paymentNum`/`maxPaymentNum` (installments 1–12), `pageField[email]`, `cField1..9` (custom passthrough — we send our payment id in `cField1`), `notifyUrl` (server-to-server notification). Expected response (Meshulam light contract): `{ status: 1, data: { url, processId, processToken, authCode } }`.
- **Customer pays** on Grow's hosted page (redirect; iframe also supported but not used here).
- **Server notification** → Grow POSTs to `notifyUrl` with transaction fields (`transactionCode`, `paymentSum`, `fullName`, `cardSuffix`, our `cField1`, …). **Never trusted** — used only to trigger verification.
- **`getPaymentProcessInfo`** — `pageCode`, `processId`, `processToken` → authoritative transaction status.
- **`approveTransaction`** — MUST be called after receiving the server update, echoing the update data back. It does not change the charge; it acknowledges receipt. Unacknowledged updates are re-sent up to 5 times and may trigger manual contact from Grow.
- Sandbox test cards: `4580000000000000`, `4580111111111121` (success), `4580458045804580` (recurring-failure testing). Bit/Google Pay/Apple Pay have **no sandbox** — real charges; do not test those flows in sandbox.

Exact response shapes are not fully published; the adapter codifies the known contract in `docs/superpowers/specs/grow-api-contract.md` (mirroring `cardcom-api-contract.md`) and the sandbox E2E run validates it before production.

## 4. Data model — `supabase/migration_021_grow_provider.sql`

No change to `payment_provider_accounts` structure — the `provider` check constraint already allows `'grow'`.

- **`payments.provider_meta jsonb`** (new, nullable) — provider-specific references that settlement needs later. For Grow: `{ "process_token": "<token>" }` (verification requires `processId` **and** `processToken`; `provider_ref` holds `processId`). Cardcom rows leave it null. Written by service_role only (Edge Functions); added to the provider-settled read-only trigger's protected fields.
- **`save_payment_provider_v2(p_org_id uuid, p_provider text, p_credentials jsonb, p_secret text, p_settings jsonb) returns uuid`** — generalized admin-only, security-definer RPC:
  - Validates `is_org_admin`; validates `p_provider in ('cardcom','grow')`.
  - Upserts the single non-archived row for that `(org_id, provider)`.
  - `cardcom`: credentials `{ terminal_number, api_name }`; non-empty `p_secret` re-encrypts `api_password_enc` via the existing Vault key (write-only semantics preserved).
  - `grow`: credentials `{ user_id, page_code, sandbox }` (trimmed strings + boolean); `p_secret` unused (null) — `userId`/`pageCode` are identifiers, not passwords; they stay admin-read-only under existing RLS and are used server-side by Edge Functions.
  - Existing `save_payment_provider` (cardcom-hardcoded) is rewritten as a thin delegate to v2 — old clients keep working.
- Partial unique index `(org_id, provider) where is_archived = false` — enforces the one-account-per-provider assumption the code already makes.

## 5. Grow adapter — `supabase/functions/_shared/grow.ts`

Same interface as `cardcom.ts` so the Edge Functions stay provider-agnostic:

```ts
export interface GrowCreds { user_id: string; page_code: string; sandbox?: boolean }
createPaymentLink(creds, params): Promise<{ url, providerRef, providerMeta }>  // providerMeta = { process_token }
verifyTransaction(creds, providerRef, providerMeta): Promise<VerifyResult>      // getPaymentProcessInfo
parseWebhook(req): Promise<{ providerRef, notifyBody }>                         // form-encoded notify
approveTransaction(creds, notifyBody): Promise<void>                            // ack; failures logged, never fail the webhook response
```

- Base URL chosen by `creds.sandbox` (`GROW_BASE_URL_PROD` env var for the production URL Grow issues; sandbox URL hardcoded).
- Requests sent as `FormData`; success = HTTP 200 **and** `status === 1`, otherwise throw with Grow's error payload in the message.
- **Phone requirement:** `pageField[phone]` is mandatory. The adapter normalizes the client's phone to local Israeli format (`0XXXXXXXXX`); if missing/invalid, `create-payment-link` returns a dedicated error code `client_phone_required`, which the UI maps to: "ללקוח אין מספר טלפון תקין — נדרש עבור סליקה ב-Grow".
- **Name requirement:** `pageField[fullName]` needs two words minimum; single-word client names are handled per sandbox findings (contract doc updated with the observed behavior).
- `VerifyResult` maps Grow statuses onto the existing `'paid' | 'failed' | 'pending'`; invoice fields populated only if Grow returns document info (see §8).

## 6. Edge Functions

- **`create-payment-link`** — body gains optional `provider` (`'cardcom' | 'grow'`). Account selection: if `provider` given, load that org's active account for it (error if none); else if exactly one active account exists, use it; else return `provider_required` (UI always sends `provider` when 2+ are active, so this is a backstop). Dispatch via a `getAdapter(provider)` map. On Grow success, persist `provider_meta` alongside `payment_link`/`provider_ref`. `method` stays `'credit_card'`.
- **`payment-webhook`** — routed by `?provider=` query param appended to the notify/webhook URL at link-creation time. Missing param ⇒ Cardcom path (all previously issued Cardcom links keep working unchanged). Shared-secret `?s=` check unchanged and applies to both. Grow branch: `parseWebhook` → find payment by `provider_ref` → load account credentials → `verifyTransaction` (authoritative) → update payment (same idempotent guards) → `approveTransaction` (ack; logged-not-fatal on failure — Grow will retry the notify). Always respond 200.
- **`check-payment-status`** — dispatches to the adapter matching the payment's account `provider` instead of assuming Cardcom.

## 7. UI

- **Org settings — `PaymentProviderManager.jsx`** becomes a thin container rendering two connection cards (one section per provider):
  - **Cardcom card** — exactly today's fields/behavior (terminal, API name, write-only password, auto-invoice, active toggle, test button), now saving through `save_payment_provider_v2`.
  - **Grow card** — fields: `userId`, `pageCode`, "סביבת בדיקות (Sandbox)" checkbox; active toggle; "בדוק חיבור" test button (creates a ₪1 link via the shared test flow, which is provider-parameterized).
  - Loading reads all non-archived rows from `payment_provider_accounts_safe` in one query and distributes by `provider`.
- **`AddPaymentModal.jsx` (link mode)** — loads the org's active providers once on open. If 2+: a "ספק סליקה" dropdown (default: cardcom if present, else first) whose value is sent as `provider`. If exactly 1: no dropdown, no `provider` sent (today's behavior). Error mapping adds `client_phone_required` and `provider_required` messages.
- All new interactive elements get `data-testid` (`provider-grow-*`, `payment-provider-select`).

## 8. Invoices

Unchanged for Cardcom. For Grow, invoice issuance is configured on Grow's side (their invoice module attached to the payment page) — v1 does not call any Grow invoice API. If `getPaymentProcessInfo` returns document info, it is stored in the existing `invoice_url` / `invoice_number` columns; otherwise they remain empty and the org handles invoicing in Grow's dashboard. The Grow settings card states this explicitly in a help line.

## 9. Error handling

- Adapter throws on non-`status:1` responses; `create-payment-link` keeps its existing archive-on-failure compensation.
- Webhook never returns non-200 for processing errors (matches current behavior); `approveTransaction` failures are logged with `processId` for manual follow-up.
- Charge-succeeded-but-verify-failed: payment stays `pending`; `check-payment-status` provides the recovery path (same recovery story as Cardcom).

## 10. Testing

- **Unit:** Grow request building (FormData fields, phone normalization, installments), response parsing (`status:1` happy path, error payloads), webhook parse, provider-selection logic in `create-payment-link`.
- **Sandbox E2E (manual):** connect sandbox credentials → create link (single payment + installments) → pay with `4580000000000000` → webhook settles payment → `approveTransaction` acked → failed-payment path. Findings recorded in `grow-api-contract.md`.
- **Regression:** Cardcom link creation + webhook without `?provider=` param; single-provider orgs see no dropdown; `save_payment_provider` (v1 signature) still saves Cardcom.

## 11. Out of scope

Grow recurring charges (הוראת קבע), Bit/Apple Pay/Google Pay flows, Grow-side invoice API integration, migrating existing Cardcom orgs, multi-currency.
