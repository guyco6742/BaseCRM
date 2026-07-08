# Cardcom API v11 "LowProfile" contract (verified)

Verified 2026-07-07 against Cardcom's live OpenAPI v3 spec (`GET /swagger/v11/swagger.json`,
title "CardCom API", version "11.0", server `https://secure.cardcom.solutions/`) plus Cardcom's
official English/Hebrew knowledge-base articles. This supersedes the baseline assumptions in
`docs/superpowers/plans/2026-07-07-payments-module.md` where noted below — **the docs win**.

No cryptographic auth header exists for this API: every call authenticates via `TerminalNumber` +
`ApiName` in the JSON body. There is no separate `ApiPassword` except when `IsRefundDeal: true` is
set inside `AdvancedDefinition` on a `Create` call.

---

## 1. Create a hosted payment page — `LowProfile/Create`

```
POST https://secure.cardcom.solutions/api/v11/LowProfile/Create
Content-Type: application/json
```

### Request (schema `CreateLowProfile`)

Required: `TerminalNumber`, `ApiName`, `Amount`, `SuccessRedirectUrl`, `FailedRedirectUrl`, `WebHookUrl`.

```json
{
  "TerminalNumber": 1000,
  "ApiName": "MyApiDemo",
  "Operation": "ChargeOnly",
  "ReturnValue": "order-42",
  "Amount": 199.90,
  "ISOCoinId": 1,
  "Language": "he",
  "SuccessRedirectUrl": "https://app.example.com/pay/success",
  "FailedRedirectUrl": "https://app.example.com/pay/failed",
  "CancelRedirectUrl": "https://app.example.com/pay/cancel",
  "WebHookUrl": "https://app.example.com/api/webhooks/cardcom",
  "AdvancedDefinition": {
    "MinNumOfPayments": 1,
    "MaxNumOfPayments": 6
  },
  "Document": {
    "Name": "Client Ltd",
    "Email": "billing@client.com",
    "DocumentTypeToCreate": "TaxInvoiceAndReceipt",
    "IsSendByEmail": true,
    "Products": [
      { "Description": "Monthly subscription", "Quantity": 1, "UnitCost": 199.90 }
    ]
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `TerminalNumber` | int32 | required |
| `ApiName` | string | required — the account/terminal API credential |
| `Amount` | decimal | required |
| `SuccessRedirectUrl` / `FailedRedirectUrl` | string (≤500) | required |
| `WebHookUrl` | string (≤500) | required |
| `CancelRedirectUrl` | string | optional, redirect on user Cancel click |
| `Operation` | enum, default `ChargeOnly` | see enum below — **no `ChargeAndCreateDocument` value** |
| `ReturnValue` | string (≤250) | your own correlation id; echoed back verbatim in `GetLpResult`/webhook |
| `ProductName` | string | free-text shown to payer only if no `Document` is sent |
| `Language` | string (2 chars), default `he` | `he`, `en`, `ru`, `sp`... |
| `ISOCoinId` | int32, default `1` | **1 = ILS, 2 = USD**, else ISO 4217 numeric code |
| `UIDefinition` | object | optional page-UI customization |
| `AdvancedDefinition` | object (`AdvancedLPDefinition`) | installments, 3DS, tokens, refund — see below |
| `Document` | object (`DocumentLP`) | invoice/receipt to auto-issue — see below |
| `UTM` | object | optional UTM passthrough |

**`Operation` enum** (exact, case-sensitive): `ChargeOnly` (default) · `ChargeAndCreateToken` ·
`CreateTokenOnly` · `SuspendedDeal` · `Do3DSAndSubmit`.
Document issuance is **not** an `Operation` value — it happens automatically whenever a `Document`
object is present (any `Operation`), unless `Document.IsShowOnlyDocument: true` (page shows the
document preview but nothing is actually created).

**Installments** live under `AdvancedDefinition`, not top-level:
- `AdvancedDefinition.MinNumOfPayments` (int, default 1, 1–36)
- `AdvancedDefinition.MaxNumOfPayments` (int, default 1, 1–36) — the field a developer would call
  "installments cap"
- `AdvancedDefinition.SelectedNumOfPayments` (default = `MinNumOfPayments`)
- Other `AdvancedDefinition` fields of note: `ISOCoinName` (alt to `ISOCoinId`), `IsRefundDeal` +
  `ApiPassword` (password required only for refund deals), `Token`/`CardNumber`/`CVV` (server-side
  charge without hosted page), `ThreeDSecureState`, `VirtualTerminal`.

**`Document` object** (`DocumentLP` = `DocumentBase` + LP-only fields):
- Required: `Name` (string ≤50) — the customer/payer name on the document. **The baseline's `To`
  field name is wrong** (an old/inconsistent example in Cardcom's own swagger uses `To`, but the
  actual JSON-schema `required` field is `Name`).
- `DocumentTypeToCreate` enum, default `Auto` (uses the terminal's admin-panel default). Relevant
  values: `TaxInvoiceAndReceipt` (חשבונית מס/קבלה), `Receipt`, `TaxInvoice`, `DonationReceipt`,
  `Order`, `Quote`, `ProformaInvoice`, plus `...Refund` variants (24 values total).
  There is **no separate coin/currency on Document** — it uses the request's `ISOCoinId`.
- `Email` (≤50), `IsSendByEmail` (bool, default `true`), `TaxId` (business/id number),
  `AddressLine1/2`, `City`, `Mobile`, `Phone`, `Comments`, `IsVatFree`, `DepartmentId`.
- `Products[]` (array, required if you want line items): each item requires `Description` (≤250)
  and `UnitCost` (decimal); optional `ProductID`, `Quantity` (default 1), `TotalLineCost`
  (recommended when `Quantity` has decimals, to avoid rounding), `IsVatFree`, `IsGiftCard`.
- LP-only flags: `IsAllowEditDocument` (bool, default false — let payer edit their own info, not
  products/amount), `IsShowOnlyDocument` (bool, default false — if `true`, **no document is
  created**, it's preview-only), `Language` (document language, default `he`).

### Response (schema `CreateLowProfileResponse`)

| Field | Type | Notes |
|---|---|---|
| `ResponseCode` | int32 | **0 = success**; non-zero = developer error, see `Description` |
| `Description` | string | human-readable error/status text |
| `LowProfileId` | guid string | save this — the id to re-query later |
| `Url` | string | redirect the payer here |
| `UrlToPayPal` | string | alt redirect if PayPal flow enabled |
| `UrlToBit` | string | alt redirect if Bit flow enabled |

Failure signaling: HTTP 400 → body is `ErrorInfo` (`{ResponseCode, Description}`), "Invalid
request". HTTP 401 → `ErrorInfo`, "Invalid username" (bad `ApiName`/`TerminalNumber` pair). A 200
response can still carry a non-zero `ResponseCode` — always check the body, not just the status
code.

---

## 2. Verify a transaction — `LowProfile/GetLpResult`

```
POST https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult
Content-Type: application/json
```

### Request (schema `GetLowProfileResult`) — all 3 fields required, nothing else

```json
{
  "TerminalNumber": 1000,
  "ApiName": "MyApiDemo",
  "LowProfileId": "b3f1c2b0-....-....-............"
}
```

Auth confirmed: **`ApiName` only** — no `ApiPassword`/token needed for this call (matches the
plan baseline). `ApiPassword` is only ever used inside `AdvancedDefinition.ApiPassword` on
`Create`, and only for refund deals.

### Response (schema `LowProfileResult` — same shape Cardcom POSTs to your webhook)

Top-level fields: `ResponseCode` (0 = success for the *page/API call itself*), `Description`,
`TerminalNumber`, `LowProfileId`, `TranzactionId`, `ReturnValue` (echoes your `Create` value),
`Operation`, `UIValues`, `DocumentInfo`, `TokenInfo`, `SuspendedInfo`, `TranzactionInfo`, `UTM`,
`ExternalPaymentVector`, `Country`, `IssuerAuthCodeDescription`.

**The real "was the card actually charged" answer is `TranzactionInfo.ResponseCode`** (populated
for `ChargeOnly`/`ChargeAndCreateToken`), not the top-level `ResponseCode` alone:

| Path | Field | Notes |
|---|---|---|
| `TranzactionInfo.ResponseCode` | int32 | **0 = success** (700/701 = success specifically for J2/J5 validation-type ops) |
| `TranzactionInfo.Description` | string | decline/error reason |
| `TranzactionInfo.TranzactionId` | int64 | Cardcom's charge id |
| `TranzactionInfo.Amount` / `CoinId` | decimal / int32 | charged amount + currency (1=ILS) |
| `TranzactionInfo.ApprovalNumber` | string | issuer auth code |
| `TranzactionInfo.NumberOfPayments` | int32 | actual installments used |
| `TranzactionInfo.Last4CardDigits`, `CardInfo`, `Brand`, `Acquire`, `Issuer` | — | card/network metadata |
| `TranzactionInfo.DocumentUrl` | string | duplicate convenience link to the issued document |
| `TokenInfo.Token` | guid | populated only for `ChargeAndCreateToken` / `CreateTokenOnly` |

**Invoice/receipt info lives in `DocumentInfo`** (top-level sibling, not nested in
`TranzactionInfo`):

| Field | Notes |
|---|---|
| `DocumentInfo.ResponseCode` | 0 = document created successfully |
| `DocumentInfo.DocumentType` | e.g. `TaxInvoiceAndReceipt` |
| `DocumentInfo.DocumentNumber` | int32, the document's number in Cardcom's system |
| `DocumentInfo.DocumentUrl` | **the invoice/receipt URL to show/email the customer** |
| `DocumentInfo.AccountId` / `ForeignAccountNumber` | Cardcom customer-card linkage |

Practical check for "did this order fully succeed": top-level `ResponseCode == 0` AND
`TranzactionInfo.ResponseCode == 0` AND (if a document was requested) `DocumentInfo.ResponseCode
== 0`.

---

## 3. Webhook — what Cardcom POSTs to `WebHookUrl`

- **Content-type: JSON**, confirmed by Cardcom's own KB: *"ב-APILevel 11 - אנו מדווחים ב-POST
  ב-JSON"* ("at APILevel 11 we report via POST in JSON") — this is a delta from the legacy
  APILevel 10 interface, which posted Name-To-Value (form-encoded) instead.
- Body shape = the swagger `callbacks` block on `LowProfile/Create` confirms it's the **exact same
  `LowProfileResult` schema** as the `GetLpResult` response (§2 above). The LowProfile id field is
  top-level **`LowProfileId`** (guid string) — same name as everywhere else in v11 (the legacy
  `lowprofilecode` query-param name only appears in the old `.aspx`/APILevel-10 interfaces).
- Your endpoint must reply with HTTP 200 or Cardcom logs it as a failed callback (visible in the
  merchant panel under "דוח פעילות פרופיל נמוך" / Low-Profile activity report) and support tickets
  reference cases where it retries/flags via that report.

### Webhook trust — confirmed NOT signed

No signature, HMAC, or shared-secret field exists anywhere in the `LowProfileResult`/callback
schema, and none of Cardcom's KB articles (create page, webhook centralization article, activity
report article) mention a signing mechanism. The only integrity control Cardcom documents is
**IP allowlisting** — their webhook calls originate from `82.80.227.17/29` and `82.80.222.124/29`
(support tells merchants to open firewall/Cloudflare rules for these ranges). That is a network
control, not a payload authentication mechanism.

**Conclusion: treat the webhook strictly as a "go check now" trigger.** On receipt, extract
`LowProfileId` and call `LowProfile/GetLpResult` server-to-server with your own `ApiName` before
marking anything paid/issuing access — never trust `ResponseCode`/`TranzactionInfo` values taken
directly from the inbound webhook body, since anyone who knows or guesses a `LowProfileId` (a
GUID, so low risk, but still) could POST a fabricated payload to your public endpoint. This
confirms the plan baseline's assumption.

---

## Sandbox & test cards

Official KB ("מידע לביצוע טסטים (למתכנת)", API-Name-To-Value KB, updated 2026-06-16):

- **Test terminal**: `TerminalNumber = 1000`, `ApiName = Cardcomtest26` (password must be obtained
  by calling Cardcom support directly — not published). Transactions on this terminal run the full
  flow through to the card networks but never actually charge the card.
- **Israeli test card** (supports installments/credit): `4580280000000008`, expiry any future date
  e.g. `12/30`, CVV `123` (4 digits for Amex), any Teudat-Zehut/ID number.
- **Foreign/tourist test card** (does NOT support installments/credit): `4580000000000000`
  (`4580` + 12 zeros), same expiry/CVV format.
- Amounts **under 5000 ILS simulate success**; amounts **over 5000 ILS simulate decline** on these
  test cards.
- A real card number can also be run through the test terminal — it is never charged, but a
  temporary 3-day authorization hold is placed for the attempted amount, and (unlike the fake test
  cards) there's no 5000 ILS success/fail cap.
- UNVERIFIED / conflicting secondary source: one third-party integration guide cites terminal
  `1000` with username `test2025` / password `test5000$`. This may be a different/older shared demo
  account (`ApiName: "MyApiDemo"` also appears in Cardcom's own swagger examples for terminal
  1000) — **do not rely on it**; use the officially documented `Cardcomtest26` terminal and call
  Cardcom support for the password, or provision your own sandbox terminal.

---

## Deltas from plan baseline

| Baseline assumption | Verified reality |
|---|---|
| `Operation: "ChargeAndCreateDocument"` exists | **False.** Enum is only `ChargeOnly` (default), `ChargeAndCreateToken`, `CreateTokenOnly`, `SuspendedDeal`, `Do3DSAndSubmit`. Document creation is orthogonal — triggered by presence of the `Document` object on *any* operation, suppressed only by `Document.IsShowOnlyDocument: true`. |
| `MaxNumOfPayments` is a top-level `Create` field | **False.** It (and `MinNumOfPayments`) live under `AdvancedDefinition`, i.e. `AdvancedDefinition.MaxNumOfPayments`. |
| `Document.To` for the customer name | **False.** Required field is `Document.Name` (Cardcom's own swagger example is inconsistent and uses `To` in one sample, but the JSON-schema `required` array and every other example say `Name`). |
| `ISOCoinId`, 1 = ILS | **Confirmed.** Also 2 = USD explicitly, else raw ISO 4217 numeric. |
| `GetLpResult` needs only `TerminalNumber`+`ApiName`+`LowProfileId` | **Confirmed**, no `ApiPassword` required for this call. |
| Webhook is unsigned, re-verify via `GetLpResult` | **Confirmed.** No signature field in schema or docs; only IP allowlisting is documented. |
| Webhook success code at `TranzactionInfo.ResponseCode` | **Confirmed**, nested under the same `LowProfileResult` shape used by both `GetLpResult` and the webhook payload. |

---

## Sources

- [Cardcom OpenAPI v3 spec — `https://secure.cardcom.solutions/swagger/v11/swagger.json`](https://secure.cardcom.solutions/swagger/v11/swagger.json) (primary source for all field names/types/enums in §1–§2; fetched 2026-07-07, `info.version: "11.0"`)
- [`https://secure.cardcom.solutions/Api/v11/Docs`](https://secure.cardcom.solutions/Api/v11/Docs) — API docs landing page, links to the swagger.json above
- [Low profile interface - EN (Step 1+2) – API NAME TO VALUE KB](https://cardcomapinametovalue.zendesk.com/hc/he/articles/27008964534162-Low-profile-interface-EN-Step-1-2)
- [ריכוז ממשקי דיווחים מ קארדקום לשרתי צד ג' - webhook (וובהוק)](https://support.cardcom.solutions/hc/he/articles/27875111757970) — confirms JSON POST at APILevel 11, IP allowlist, no signature
- [מידע לביצוע טסטים (למתכנת) – API NAME TO VALUE KB](https://cardcomapinametovalue.zendesk.com/hc/he/articles/27008168721426) — sandbox terminal + test card numbers, updated 2026-06-16
- [LowProfile - Token creation work flow – API NAME TO VALUE KB](https://cardcomapinametovalue.zendesk.com/hc/he/articles/27009040347666)
