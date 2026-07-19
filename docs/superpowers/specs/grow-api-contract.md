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
