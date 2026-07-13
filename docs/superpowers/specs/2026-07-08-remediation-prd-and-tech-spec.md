# BaseCRM Remediation — PRD & Technical Specification

**Date:** 2026-07-08
**Status:** Draft for approval
**Source:** `BaseCRM-Spec-and-Analysis.md` (full code/security analysis, 2026-07-08)
**Scope:** All ~30 findings from the analysis, delivered in 5 phases. The 12 user-prioritized items lead phases 1–4.

---

## 1. Executive Summary

The analysis found BaseCRM in unusually good shape for its stage — real per-table RLS, a documented history of fixing critical security holes, and a correctly-built payments module — but surfaced one **new high-severity issue** (the "send contract" page), a **CSV formula-injection vulnerability**, and roughly thirty feature/UX/tech-debt gaps. This document turns those findings into an actionable, phased plan.

- **Phase 1 — Security & hygiene.** Delete the unsafe send-contract feature, neutralize CSV injection, add rate limiting to the public RPCs, plus three cheap riders (Sentry, upload validation, org-scoped local storage). Small, ships first.
- **Phase 2 — Core workflows.** The daily-pain gaps: real invite emails, a per-org dashboard + reports, import de-duplication, and pagination for large lists. Adopts managed migrations.
- **Phase 3 — Trust & visibility.** Audit log and in-app notifications, plus the highest-security-ROI item in the whole backlog: automated RLS regression tests in CI.
- **Phase 4 — Reach & polish.** Global search, mobile support, accessibility.
- **Phase 5 — Platform.** Shared data layer, generic Kanban, full drag-and-drop, recurring-payments UI, TypeScript.

Each phase is independently shippable. Within every phase, database objects land before the UI that depends on them.

---

## 2. Background & Current State

### 2.1 Stack

React 19 + React Router 7 + Vite 8 + Tailwind CSS v4 (plain JSX, no TypeScript). Supabase (Postgres + Auth + Storage + Deno Edge Functions). Netlify SPA hosting. Payments via Cardcom (server-side). Testing: Vitest, one pure-logic test file (`payments.test.js`). Lint: oxlint. ~9,450 lines across 71 `src/` files.

Two Supabase projects: **prod** `iezgyetfwgmlczcrnrvx` (TheGuysCRM) and **dev** `atgoyrojmwxmntonbmpd` (TheGuysCRM-dev).

### 2.2 Data & tenancy model

Hierarchy: `organizations` → `memberships` (admin/member) → `workspaces` → `boards` → `groups` → `items`. CRM: `client_statuses`, `client_fields`, `clients`, `contacts`. Lead ingestion: `lead_sources` + public `ingest_lead` RPC. Payments: `payment_provider_accounts`, `payments`, `payment_subscriptions`.

Every content row carries a denormalized `org_id`; multi-tenancy is enforced by RLS via the security-definer helpers `is_org_member(org_id)` / `is_org_admin(org_id)`. Soft-delete only (`is_archived`) — **no DELETE policies anywhere**, by design. Item column values (including due dates and assignees) live in `items.values` jsonb keyed by column id: `date` columns store `"YYYY-MM-DD"` strings, `person` columns store a member `user_id`. GIN index `idx_items_values` (jsonb_path_ops).

**Migrations** are flat numbered files (`migration_0NN_*.sql`) run **manually** in each project's SQL editor. Latest is **014**. `supabase/config.toml` contains only `[functions.payment-webhook] verify_jwt = false`.

### 2.3 Security precedent (why the RLS discipline matters)

Two real, in-production vulnerabilities were found and fixed:

- **Migration 007** — `profiles_update` lacked `WITH CHECK`, so any user could set their own `is_super_admin = true`. Verified exploitable. Fixed with a trigger reverting unauthorized flag changes.
- **Migration 012** — an org admin could demote another admin to member and then delete them, bypassing "only super-admin deletes admins."

**The recurring lesson:** an RLS policy that looks innocent without a correct `WITH CHECK` is a latent privilege-escalation. Every new policy in this plan states what it checks on both `USING` and `WITH CHECK`, and Phase 3 adds automated regression tests for exactly these exploit classes.

### 2.4 Finding inventory (F1–F30)

Finding IDs used for traceability (see Appendix). Grouped by analysis section.

| ID | Finding | Analysis § |
|----|---------|-----------|
| F1 | Send-contract page unsafe (TEST_MODE, personal worker/Gmail, hardcoded template, no org scoping, PII to external worker) | 3.2 |
| F2 | No file type/size validation on upload; removed files never cleaned from storage | 3.3 |
| F3 | Public RPCs (`ingest_lead`, `get_invitation_by_token`) have no rate limiting | 3.4 |
| F4 | CSV export formula injection (`exportRowsToCSV`) | 3.5 |
| F5 | User invites don't send a real email (manual copy-link only) | 4.1 |
| F6 | No dashboard / reports anywhere | 4.1 |
| F7 | No duplicate detection on manual CSV import | 4.1 |
| F8 | No pagination — lists load entire tables client-side (clients, items, payments) | 4.1 |
| F9 | No bulk actions | 4.1 |
| F10 | No audit/activity log at client or item level | 4.2 |
| F11 | No notifications (in-app or email) | 4.2 |
| F12 | No undo after archive | 4.2 |
| F13 | Partial drag-and-drop (kanban only; reordering via arrow buttons) | 4.2 |
| F14 | No global search | 4.2 |
| F15 | `localStorage` view prefs not isolated per org | 4.2 |
| F16 | No production error monitoring (Sentry) | 4.3 |
| F17 | Near-zero test coverage; no RLS tests; no CI | 4.3 |
| F18 | Weak mobile support (mouse-only sidebar resize, no responsive layout) | 4.3 |
| F19 | Inconsistent form validation (no IL phone format, no per-org unique email/phone) | 4.3 |
| F20 | `payment_subscriptions` (recurring) has no UI | 4.3 |
| F21 | Accessibility gaps (missing aria-labels, table caption/scope, form labels) | 4.4 |
| F22 | No TypeScript | 5.1 |
| F23 | No managed schema migrations (manual SQL, no history/rollback) | 5.2 |
| F24 | Logic duplicated between Board and CRM (Kanban/table components) | 5.3 |
| F25 | No shared data-access layer (per-page Supabase queries, repeated error handling) | 5.4 |
| F26 | Single-client "hack" code in a multi-tenant base (send-contract exemplar) | 5.5 |
| F27 | No skeleton/loading states | (backlog) |
| F28 | No error-message taxonomy (403/404/network) | (backlog) |
| F29 | No breadcrumbs | (backlog) |
| F30 | `updated_at` set client-side, not by DB trigger, on items/clients | (derived, §2.2) |

> The 2026-07-07 performance/UX backlog (code-splitting, memoized contexts, toasts, confirm dialogs, `useTitle`, loading buttons, Modal focus-trap, cached members) is **already delivered** and is not re-planned here; its "intentionally not done" list feeds F8/F16/F17/F18/F22/F24/F25/F27/F28/F29.

---

## 3. Goals

1. **Close the security gaps before onboarding more orgs** — no unsafe features, no injection, no unbounded public endpoints, production error visibility.
2. **Make the daily CRM workflow complete** — invite a teammate (email), see what's happening (dashboard), import without creating duplicates, and work with thousands of records without freezing the browser.
3. **Earn operational trust** — who changed what and when (audit), tell people when work lands on them (notifications), and prove the tenancy boundaries hold (RLS tests).
4. **Extend reach** — find anything fast (search), work from a phone (mobile), be usable by everyone (accessibility).

## 4. Non-Goals (explicit)

- **A rebuilt send-contract feature.** It is deleted, not replaced. If digital signing returns, it is a fresh feature built on the payments-module pattern (per-org provider accounts + edge function), scoped separately.
- **Email notifications / digests.** Notifications are in-app only in v1.
- **Realtime channels.** Notifications and lists poll/refetch; Supabase Realtime is a documented upgrade path.
- **Touch drag-and-drop** in v1 mobile work.
- **React Query / SWR.** The shared data layer (Phase 5) extends the app's own hook family.
- **A charting library.** Dashboard visuals are CSS bars.
- **Merge-on-import.** Import de-dup is skip-only in v1; field-merge is a specced fast-follow.
- **"Done-aware" overdue logic.** Boards have no canonical "done" state; overdue = any past date on a live item in v1.
- **TypeScript** before Phase 5.

## 5. Personas

- **Org admin** (finance-firm manager, e.g. Reich Finance): invites teammates, watches the dashboard and reports, reviews the audit log, manages payments and the pipeline. Primary consumer of Phases 2–3.
- **Member / field consultant**: mobile-first, works assigned tasks, needs notifications and search, rarely at a desk. Primary consumer of Phases 3–4.
- **Super-admin** (operator): cross-org visibility, onboarding, incident response. Cares about Phase 1 and Phase 3 (RLS tests, error monitoring).

---

## 6. Phased Requirements

Priorities: **P0** = security/correctness, ship immediately; **P1** = high user value; **P2** = polish/reach. Each item lists a user story and testable acceptance criteria. Full technical designs are in §7.

### Phase 1 — Security & Hygiene

**Item 1 — Delete send-contract (F1, F26) · P0**
*Story:* As the product owner, I want the unsafe single-client contract feature removed so no org can send legally-ambiguous, unlogged signature requests leaking PII through a personal worker.
*Acceptance:* `/org/:orgId/send-contract` falls through to the catch-all (404); no sidebar entry; no admin toggle; `grep -r send_contract src/` is empty; `organizations.features` no longer carries the `send_contract` key after migration_015.

**Item 2 — CSV injection fix (F4) · P0**
*Story:* As any user exporting a list, I want exported files to be safe to open in Excel even if a client name or note starts with `=`, `+`, `-`, or `@`.
*Acceptance:* a client named `=1+1` exports as a literal string (leading `'`), Excel runs no formula; unit tests cover `=`, `+`, `-`, `@`, tab, CR, and a value that is both formula-leading and comma-containing; benign Hebrew text is unchanged.

**Item 3 — Rate limiting for public RPCs (F3) · P0**
*Story:* As an operator, I want a leaked `lead_sources` token or a token-guessing script to be blunted, not able to flood the org with junk leads or brute-force invitations.
*Acceptance:* the 61st `ingest_lead` call in a minute on one token returns `{ok:false, error:"rate_limited"}` (not a 500); the 21st `get_invitation_by_token` from one IP in a minute returns empty; a legitimate single call is unaffected; all existing migration_006 hardening (20 KB cap, field truncation, dedup) is preserved.

*Phase-1 riders:* **Sentry** (F16) — `@sentry/react` wired in `main.jsx` + `ErrorBoundary`, DSN per env; **upload validation** (F2) — client-side type allowlist + size cap in the file-cell upload path, plus a bucket file-size limit; **localStorage org-scoping** (F15) — `basecrm.${orgId}.*` keys with one-time migration of the existing `clientsView`/`clientsSort`.

### Phase 2 — Core Workflows

**Item 4 — Invite emails (F5) · P1**
*Story:* As an admin, when I invite a teammate I want them to receive a real email with an accept link, not have to copy a link and send it myself.
*Acceptance:* inviting a valid email sends a Hebrew RTL email with a working accept link within seconds; a Resend outage still creates the invitation and shows the copy-link fallback with a warning toast; a non-admin calling the function gets 403; "שלח שוב" is rejected within 60s of the previous send; a duplicate pending invite returns a clear "already invited" error.

**Item 5 — Dashboard + Reports (F6) · P1**
*Story:* As an admin, I want one screen that shows leads this month, pipeline, pending-payment value, and overdue tasks, and a reports screen I can date-filter and export.
*Acceptance:* the dashboard renders from a single RPC call in <1s on dev data; KPI numbers match manual SQL spot-checks; the pipeline shows per-stage counts colored by status; the overdue-tasks card links to a pre-filtered report; reports export opens cleanly in Excel; a member of another org calling the RPC gets an error.

**Item 6 — Import de-duplication (F7) · P1**
*Story:* As an admin importing a CSV, I want rows that match an existing client (same name **and** same email-or-phone) skipped, so re-importing a file doesn't double my client list.
*Acceptance:* importing the same file twice yields zero new clients the second time; `+972-52…` and `052…` are treated as the same phone; same name + different email + different phone is **not** a duplicate; the modal previews "N new / M skipped" with an expandable list of what matched before inserting.

**Item 7 — Pagination + page size (F8) · P1**
*Story:* As a user of an org with thousands of records, I want lists to load a page at a time and to choose how many rows to show, without the browser freezing.
*Acceptance:* an org with 1,000 clients loads only one page initially; server-side search "כהן" returns a filtered page with a correct total; page-size choice (25/50/100) survives reload and does not leak across orgs; payments KPI totals reflect the whole org, not the current page; a board group with 250 items shows 100 with a working "load more."

*Phase-2 riders:* **form validation** (F19) — IL phone format + email format + a soft per-org duplicate warning on client create (reuses the dedup RPC with one row); **skeleton states** (F27) on the new dashboard and paginated tables; **process: adopt Supabase CLI managed migrations** (F23) at the start of this phase (baseline 001–015, then `supabase db push`).

### Phase 3 — Trust & Visibility

**Item 8 — Audit log (F10, F30) · P1**
*Story:* As an admin in a regulated (finance) context, I want a chronological record of who changed what and when, on clients, items, payments, memberships, and invitations.
*Acceptance:* editing a client name writes one audit row with `{name:{old,new}}` and the actor; archiving records `action='archive'`; a no-op save writes nothing; a member cannot select from `audit_log` (SQL-verified); the client "היסטוריה" tab shows that client's timeline for admins.

**Item 9 — Notifications (F11) · P1**
*Story:* As a member, I want to be told in-app when someone assigns a task to me, without checking every board manually.
*Acceptance:* when A assigns an item to B, B's bell shows an unread count within 45s or on window focus; clicking navigates to the board and clears the badge; A assigning to themself creates nothing; B cannot read A's notifications (SQL-verified); a user can only modify their own notification's `read_at`.

*Phase-3 riders:* **RLS regression tests + CI** (F17) — a Vitest suite hitting dev with two seeded users/orgs, asserting the migration-007 self-promotion, migration-012 admin-deletion, cross-org reads, and member access to `audit_log`/foreign `notifications` are all blocked; GitHub Actions runs lint + unit + RLS suite; **undo-after-archive** (F12) — a toast with a "בטל" action re-flipping `is_archived`; **error taxonomy** (F28) — `src/lib/errors.js` mapping Postgres/PostgREST/edge codes to Hebrew messages.

### Phase 4 — Reach & Polish

**Item 10 — Global search (F14) · P2**
*Story:* As any user, I want Cmd/Ctrl+K anywhere to search clients, boards, and items in my current org and jump to a result.
*Acceptance:* Ctrl/Cmd+K opens the palette on any authed page; typing 2+ chars returns grouped org-scoped results in <500ms on dev data; Enter navigates; results from org A never include org B (SQL-verified); Escape restores focus to the previously-focused element.

**Item 11 — Mobile support (F18) · P2**
*Story:* As a field consultant on a phone, I want to reach navigation, read lists as cards, and complete core flows by touch.
*Acceptance:* at 375×812 there is no horizontal body scroll on Dashboard/Clients/Payments/Settings; the sidebar is reachable via a hamburger drawer; clients and payments render as cards on small screens; creating a client, changing a status, and viewing a payment are all completable by touch.

**Item 12 — Accessibility (F21) · P2**
*Story:* As a keyboard or screen-reader user, I want labeled controls, structured tables, and full keyboard operability.
*Acceptance:* zero serious/critical axe violations on the six key pages (Dashboard, Clients, Client, Board, Payments, Settings) in both themes; a keyboard-only walkthrough (open palette → navigate sidebar → edit a cell → archive+confirm) completes without a mouse; every icon-only button has an `aria-label`; the two data tables have captions and column scopes.

*Phase-4 riders:* **breadcrumbs** (F29); **bulk actions v1** (F9) — ClientsPage checkbox column → bulk status-change / bulk archive, building on server pagination + audit + undo.

### Phase 5 — Platform (deliberate, last)

Shared data-fetching hook family extending `usePagedQuery` (F25, **not** React Query); generic Kanban merge (F24) before full drag-and-drop (F13, dnd-kit, touch-capable); recurring-payments UI (F20, `payment_subscriptions`); orphaned-storage cleanup cron (F2 completion, report-only first run); TypeScript migration (F22) last, starting with `src/lib/` and `supabase gen types`.

---

## 7. Technical Specification (per item)

### Conventions

Migrations continue the flat-file pattern `migration_015+` (run dev then prod) until CLI adoption in Phase 2. Every new SQL function is `security definer set search_path = public` with an explicit `is_org_member`/`is_org_admin` guard as its first statement. New tables carry `org_id` + RLS, no DELETE policy. New edge functions reuse `supabase/functions/_shared/db.ts` (`serviceClient`, `requireOrgMember`, `json`, `corsPreflight`) and add one helper, `requireOrgAdmin(req, orgId)` (same shape, checks `memberships.role='admin'` or super-admin). New pure logic goes in `src/lib/` with a Vitest file mirroring `payments.test.js`. All UI is Hebrew, RTL-safe, `data-testid` on interactive elements.

### Item 1 — Delete send-contract

Pure removal — nothing server-side exists to migrate.

- Delete `src/pages/SendContractPage.jsx`.
- `src/App.jsx`: remove the lazy import (L23) and the `send-contract` route (L58).
- `src/components/Sidebar.jsx`: remove the NavLink block gated by `org?.features?.send_contract` (L157-170).
- `src/pages/AdminPage.jsx`: remove the toggle button (L228-236) and the now-dead generic `handleToggleFeature` (L113-126) — it has no other caller. The `features` jsonb column and its read path stay (generic infra; reintroduce a handler when a second flag exists).
- `migration_015` (shared with Item 3): `update public.organizations set features = features - 'send_contract';` for data hygiene.

*Decision:* hard delete, no deprecation. The feature is unsafe as shipped; git history preserves the code if a proper rebuild is ever wanted.

### Item 2 — CSV injection fix

Fix at the single choke point: `escape()` in `src/lib/csv.js` (used by both `exportRowsToCSV` L153-160 and `buildClientTemplate` L147). After the existing null-coalesce, if the string — with leading whitespace trimmed for the test — begins with any of `= + - @ \t \r`, prefix a single apostrophe `'`, then apply the existing quote/comma/newline escaping (the two compose: a value that is both formula-leading and comma-containing gets the apostrophe *inside* the quotes).

*Decision:* prefix-apostrophe (OWASP), not stripping — preserves data. Accepted caveat: `+972…` phone values gain a leading `'`; documented; the dataset is mostly `05X` local format. No call-site changes (BoardPage L360-374, ClientsPage L135-139, PaymentsPage L39-41 all flow through `escape()`).

New `src/lib/csv.test.js`: the six injection prefixes, benign Hebrew, the compose case, and a round-trip through `buildClientTemplate`.

### Item 3 — Rate limiting

*Decision:* DB-level fixed-window counter inside the RPCs. Rationale: `ingest_lead`'s token+endpoint contract is already deployed on external customer lead forms — moving it behind an edge function breaks live integrations; Supabase project rate limits cover only Auth endpoints, not PostgREST RPCs.

`migration_015`:

```sql
create table if not exists public.rate_limits (
  bucket_key   text not null,
  window_start timestamptz not null,
  hits         int not null default 1,
  primary key (bucket_key, window_start)
);
alter table public.rate_limits enable row level security;  -- no policies => locked to definer fns only

create or replace function public.check_rate_limit(p_key text, p_max int, p_window interval)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_start timestamptz := date_bin(p_window, now(), 'epoch'); v_hits int;
begin
  insert into public.rate_limits(bucket_key, window_start, hits) values (p_key, v_start, 1)
  on conflict (bucket_key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  delete from public.rate_limits where bucket_key = p_key and window_start < v_start - p_window; -- opportunistic cleanup
  return v_hits <= p_max;
end $$;
```

- Redefine `ingest_lead` (base = the migration_006 version; keep every existing guard). At the top, derive IP from `coalesce(split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1), '?')`; check `check_rate_limit('ingest:'||p_token, 60, '1 minute')` and `check_rate_limit('ingest_ip:'||ip, 120, '1 minute')`; on failure `return jsonb_build_object('ok', false, 'error', 'rate_limited')` (jsonb result, no exception → no 500 noise).
- Convert `get_invitation_by_token` (schema.sql L263) from `sql` to `plpgsql`; add per-IP `check_rate_limit('invite_ip:'||ip, 20, '1 minute')`; on failure `return` an empty set.

*Decision:* fixed window, opportunistic cleanup, no pg_cron — this is abuse-blunting, not billing precision. Verification: a documented SQL smoke loop in the dev editor (25 calls, assert the 21st fails).

### Item 4 — Invite emails (Resend)

*Decision:* new edge function `send-invite`; the invitations INSERT moves server-side into it. Moving the insert lets one atomic operation create the row (with a server-generated token) and send the email, and keeps the raw token off the extra client hop. The existing admin-insert RLS policy stays (harmless), but the UI stops using it.

`supabase/functions/send-invite/index.ts`:
- `corsPreflight`, then `requireOrgAdmin(req, orgId)` (new `_shared/db.ts` helper).
- Action `create`: `{ orgId, email, role }` → serviceClient inserts an invitation (token = 16 random bytes hex, matching current format; relies on the existing `uq_invitations_pending` index → duplicate pending returns a 409 mapped to a Hebrew message) → sends email.
- Action `resend`: `{ orgId, invitationId }` → load pending invite → reject if `last_sent_at > now() - 60s` → send → update `last_sent_at`.
- Email: `POST https://api.resend.com/emails` with `RESEND_API_KEY`. From `BaseCRM <invites@<verified-domain>>`. Minimal inline-styled RTL Hebrew HTML: org name, inviter, CTA to `${APP_URL}/accept-invite?token=…`. *Decision:* link base is the `APP_URL` secret, not the request Origin — prevents host-header-shaped link injection.
- Failure story: the invitation row is created even if Resend fails. Response `{ ok, emailSent, inviteUrl }`; on `emailSent:false` the UI shows the existing copy-link input plus a warning toast ("המייל לא נשלח — העתיקו את הקישור ידנית"). Never roll back the invite for an email failure.

`migration_016`: `alter table public.invitations add column if not exists last_sent_at timestamptz;`

Frontend: `InviteMemberModal.jsx` calls `supabase.functions.invoke('send-invite', …)` (same pattern as the payments callers), keeps the copy-link block as fallback; OrgSettings members list gets a "שלח שוב" button per pending invite (disabled 60s after use). No `config.toml` change (default `verify_jwt=true` is correct).

Rollout prerequisite: verify the sending domain in Resend and set `RESEND_API_KEY` + `APP_URL` secrets on both projects.

### Item 5 — Dashboard + Reports

*Decision:* two pages, SQL aggregation via RPCs, no chart library.

`migration_017`:
- `get_org_dashboard(p_org_id uuid) returns jsonb` — first line `if not public.is_org_member(p_org_id) then raise exception 'forbidden'; end if;`. One jsonb payload: `leads_this_month`, `leads_prev_month` (from `leads.created_at`); `new_clients_this_month`; `pipeline` = array of `{status_id, label, color, count}` (clients joined to `client_statuses`, non-archived); `payments` = `{pending_count, pending_sum, paid_this_month_sum, overdue_count}` (uses `idx_payments_org_status`); `overdue_tasks` count via:

```sql
select count(distinct i.id)
from public.items i
join public.columns c on c.board_id = i.board_id and c.type = 'date' and not c.is_archived
where i.org_id = p_org_id and not i.is_archived
  and (i.values->>(c.id::text)) ~ '^\d{4}-\d{2}-\d{2}'
  and (i.values->>(c.id::text))::date < current_date;
```

- `get_org_report(p_org_id uuid, p_report text, p_from date, p_to date) returns jsonb` — same guard; v1 reports: `leads_by_source_by_month`, `payments_by_status`, `clients_by_status`, `overdue_items` (detail rows: item name, board, group, due date — same join, for drill-down).
- Supporting indexes (also serve Item 7): `create index if not exists on public.clients (org_id, lower(name))`, `(org_id, status_id)`, `public.payments (org_id, due_date)`.

*Decisions:* pipeline v1 = client **counts**, not money (clients have no monetary column; the money KPI is the payments block). Overdue tasks computed in SQL over the jsonb (per-org item counts are in the thousands; a scan inside one RPC is fine; no new index). v1 limitation stated: no "done" exclusion (boards lack canonical done semantics).

UI: `src/pages/OrgDashboardPage.jsx` at `/org/:orgId/dashboard` — KPI cards (leads this month + delta vs last, new clients, pending payments ₪ + count, overdue tasks), pipeline as Tailwind-width horizontal bars colored by `client_statuses.color`, payments-this-month strip; hook `src/hooks/useDashboard.js` wraps the RPC; reuse `sumByStatus`/`filterPayments` label/format helpers from `src/lib/payments.js`. `src/pages/ReportsPage.jsx` at `/org/:orgId/reports` — report selector + date range → table → "ייצוא CSV" via the now-safe `exportRowsToCSV`. Two Sidebar NavLinks (דשבורד, דוחות) above workspaces. `OrgHomePage` redirect behavior unchanged. Overdue KPI click → ReportsPage preloaded with `overdue_items`.

### Item 6 — Import de-duplication

Rule (as specified, deliberately different from `ingest_lead`): a row is a duplicate iff `norm(name)` matches an existing non-archived client **AND** (`norm(email)` matches **OR** `norm(phone)` matches). Normalization: name = `lower(trim())` with internal whitespace collapsed; email = `lower(trim())`; phone = digits only, compared on the last 9 digits (equates `+9725X…` and `05X…`).

*Decision:* server-side check, because Item 7 removes the "all clients already in the browser" assumption.

`migration_018`:
- `normalize_phone(text) returns text` (immutable) — digits only, last 9.
- `find_import_duplicates(p_org_id uuid, p_rows jsonb) returns jsonb` — security definer + `is_org_member` guard; input `[{i, name, email, phone}]` (row index + three keys only); returns `[{i, client_id, matched_on}]`; reuses the 20 KB-style payload cap from `ingest_lead`.

`ImportClientsModal.jsx` flow: parse → intra-file dedup (same keys → keep first, count rest) → call RPC → preview step "N שורות חדשות ייווספו, M כפילויות ידולגו" with an expandable skipped-list (name + matched key) → insert only non-duplicates via the existing chunks-of-100 pattern.

*Decision:* v1 is **skip-only**. Merge is specced as an explicit fast-follow checkbox in the same modal (which field wins, custom fields, audit noise deserve their own pass). New `src/lib/importDedup.js` holds the JS normalizers mirroring the SQL, with `importDedup.test.js` — both specced side-by-side to prevent drift.

### Item 7 — Pagination

*Decision:* server-side `.range()` + `count:'exact'` on ClientsPage and PaymentsPage; per-group load-more on BoardPage. Client-side chunking is pointless — the transfer/memory cost is the problem.

Shared infra: `src/hooks/usePagedQuery.js` (takes a query-builder fn, page, pageSize; returns `{rows, total, page, setPage, pageSize, setPageSize, loading, refetch}`) and `src/components/Pagination.jsx` (RTL controls + page-size `<select>` [25, 50, 100], default 50, Hebrew labels, `data-testid`). Page size persists at `basecrm.${orgId}.pageSize` — **org-scoped from day one**, setting the precedent to fix F15's existing keys (migrate `clientsView`/`clientsSort` in the same PR).

- **ClientsPage**: search, status filter, and sort move server-side — `.or('name.ilike.%q%,email.ilike.%q%,phone.ilike.%q%')`, `.eq('status_id', …)`, `.order(col)` including custom-field jsonb ordering (`order=values->>fieldId`). `src/lib/clientTable.js` shrinks to per-page formatting (keep `localeCompare('he')` for residual tiebreaks). Debounce search 300ms; archive/status changes stay optimistic against the current page then `refetch()`.
- **PaymentsPage**: `.range()` + server-side status filter + `.order('due_date')`. KPI totals must come from the whole-org aggregate (reuse `get_org_dashboard`'s payment block or a small summary query), **not** the current page.
- **BoardPage**: *decision — do not paginate the board; load-more per group.* Initial load fetches up to 100 items/group (`.eq('group_id', g).order('position').range(0, 99)`) plus per-group counts; over-100 groups render "טען עוד (N נוספים)" appending the next 100. Optimistic add/move/archive operate on the loaded window unchanged.

### Item 8 — Audit log

*Decision:* one generic table, trigger-based capture. App-level inserts would need touching ~15 scattered call sites and every future one; triggers capture everything (including edge-function writes) and can't be forgotten. `auth.uid()` is available in triggers for PostgREST writes; service-role writes record `actor_id = null` (rendered "מערכת").

`migration_019`:

```sql
create table public.audit_log (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references public.organizations(id),
  actor_id     uuid,
  entity_type  text not null,   -- client | contact | item | payment | membership | invitation
  entity_id    uuid not null,
  entity_label text,
  action       text not null,   -- insert | update | archive | restore
  diff         jsonb,           -- changed keys only: {field:{old,new}}
  created_at   timestamptz not null default now()
);
create index on public.audit_log (org_id, created_at desc);
create index on public.audit_log (org_id, entity_type, entity_id, created_at desc);
alter table public.audit_log enable row level security;
create policy audit_select on public.audit_log for select using (public.is_org_admin(org_id));
-- no insert/update/delete policies: append-only via definer trigger
```

- `tg_audit()` — one generic `plpgsql` `security definer` function; diffs `to_jsonb(old)` vs `to_jsonb(new)` to changed keys only; skips no-op updates; classifies `is_archived` flips as `archive`/`restore`; takes `entity_label` from `name` when present. Attached `AFTER INSERT OR UPDATE` on `clients, contacts, items, payments, memberships, invitations` (phase-1 set; boards/groups/columns/statuses phase later — low dispute value, high noise).
- Same migration fixes F30: extend the existing `tg_set_updated_at` (migration_014) trigger to `clients`, `items`, `contacts` so `updated_at` is DB-authoritative (leave client code as-is; the trigger overwrites it).

*Decisions:* admin-only SELECT in v1 (finance-compliance framing; member-visible client timelines can be widened later with a scoped policy). 12-month retention documented in the migration header; enforcement deferred (rows are tiny) until pg_cron is warranted.

UI: `src/pages/AuditLogPage.jsx` at `/org/:orgId/settings/audit` (admin-gated; reuses `usePagedQuery`/`Pagination`), filters by entity type, actor (from cached `useOrg().members`), date range, with humanized Hebrew diffs (`שדה "טלפון": 050… → 052…`). ClientPage gains a "היסטוריה" tab (admin-only, matching RLS) querying `audit_log` for that client + its contacts.

### Item 9 — Notifications

*Decision:* DB trigger creates notifications; polling delivers them. The trigger reuses the old/new jsonb comparison, guarantees capture from any surface (import, edge function, future bulk actions), and can't be defeated by the optimistic-rollback path. Polling over Realtime: no realtime exists in the app yet; a 45s interval + refetch-on-focus is indistinguishable for task assignment and avoids channel-lifecycle management. Realtime is the documented upgrade path.

`migration_020`:

```sql
create table public.notifications (
  id          bigint generated always as identity primary key,
  org_id      uuid not null,
  user_id     uuid not null,   -- recipient
  actor_id    uuid,
  type        text not null default 'task_assigned',
  entity_type text not null, entity_id uuid not null,
  payload     jsonb not null default '{}'::jsonb,  -- {item_name, board_id, board_name, group_id}
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc) where read_at is null;
alter table public.notifications enable row level security;
create policy notif_select on public.notifications for select using (user_id = auth.uid());
create policy notif_update on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- no insert (definer trigger only), no delete
```

- A `before update` guard trigger rejects changes to any column other than `read_at` — honoring the migration-007 "what about the fields I don't check" lesson.
- `tg_notify_assignment()` on `items after update`: for each `person`-type column on the board, if `new.values->>col` differs from `old.values->>col`, is a valid user id, and `!= auth.uid()` (no self-notify), insert a notification with item/board names in `payload`.

Frontend: `src/hooks/useNotifications.js` (unread count + latest 20 on mount, 45s interval, `visibilitychange` refetch, `markRead`/`markAllRead`); `src/components/NotificationsBell.jsx` in the Navbar right cluster (bell `aria-label="התראות"`, unread badge, RTL dropdown reusing Modal focus conventions, "X הקצה לך את המשימה Y בבורד Z" + relative time, click → navigate + markRead, "סמן הכל כנקרא"). Non-goals v1: toast-on-new, email digests.

### Item 10 — Global search

*Decision:* one RPC, plain ILIKE, no pg_trgm in v1 (per-org data is in the thousands; `%q%` scans are fine; pg_trgm is the documented follow-up if p95 degrades).

`migration_021`: `search_org(p_org_id uuid, p_q text, p_limit int default 15) returns table(kind text, id uuid, title text, subtitle text, board_id uuid, workspace_id uuid)` — security definer + `is_org_member` guard; `p_q` length-capped 2..100; UNION ALL of clients (name/email/phone ILIKE, phone via `normalize_phone`, subtitle = status label), non-archived items (name ILIKE, join groups→boards for `board_id`+`workspace_id`, subtitle "בורד · קבוצה"), non-archived boards (name ILIKE, subtitle = workspace name). Ordering: exact-prefix first, then kind priority clients→boards→items, capped per kind (~5/5/10).

Frontend: `src/components/CommandPalette.jsx` mounted once in `Layout.jsx`; global `keydown` for Ctrl/Cmd+K plus a Navbar search button (`aria-label="חיפוש"`) for discoverability/mobile; built on `Modal.jsx` (focus trap, Escape, aria-modal already solved); debounce 250ms; grouped Hebrew results (לקוחות / בורדים / פריטים); ArrowUp/Down + Enter (vertical only, RTL-safe); `role="listbox"` + `aria-activedescendant`. Navigation: client → `/org/:orgId/clients/:id`; board → `/org/:orgId/board/:id`; item → its board route with `?item=:id` (BoardPage reads the param and scrolls/flashes the row).

### Item 11 — Mobile

*Decisions:*
1. Sidebar → off-canvas drawer under `md`; Navbar hamburger (right side in RTL), `aria-expanded`, overlay backdrop, closes on NavLink click and Escape. ≥`md` keeps the current fixed sidebar. Implemented in `Sidebar.jsx` + `Layout.jsx` state; no new library.
2. Resizer hidden below `md` — no touch-resize (effort with no payoff; drawer width is fixed on mobile).
3. Tables → cards on small screens: ClientsPage defaults to its existing cards view under `sm` (user toggle still wins); PaymentsPage gets a stacked card list under `md`; board table keeps `overflow-x-auto` (arbitrary column sets aren't worth a card layout yet).
4. Kanban columns get `snap-x snap-mandatory` (one-line feel improvement).
5. Icon buttons ≥44px hit area (padding, not icon size) — done with Item 12's pass.
6. Modals full-height/width under `sm`.

Non-goals v1: touch drag-and-drop, responsive board-table cards, PWA. Acceptance measured at 375×812 in Chrome devtools.

### Item 12 — Accessibility

One bounded pass, verified by axe DevTools:
1. Hebrew `aria-label`s on icon-only controls: Navbar theme toggle (L39), ClientsTable archive × (L172), ClientsPage filter-remove × (L510), sort-direction toggle (L438), view toggles (L373/380), BoardCell edit ✎ (L410), plus the new bell/hamburger/search. Convention going forward: no icon-only button without `aria-label`.
2. Tables: sr-only `<caption>` + `scope="col"` on ClientsTable (L141), PaymentsPage (L70), and the new Reports/Audit tables (correct from day one).
3. Form labels: ClientsPage search (L363), status/filter selects, date inputs, and new Reports date-range inputs → `<label htmlFor>` or `aria-label`.
4. Sidebar resizer: `role="separator"`, `aria-orientation="vertical"`, `tabIndex=0`, ArrowLeft/Right resize (±16px), `aria-valuenow/min/max` (desktop only).
5. Contrast: axe pass on the six key pages in both themes; fix flagged pairs; ensure focus rings aren't suppressed.

*Verification decision:* manual axe audits with recorded results, not an automated axe CI gate (no component-test infra yet; that's Phase 5 with tests+CI). Acceptance stays objective: zero serious/critical violations on the six pages, both themes, plus the keyboard-only walkthrough.

---

## 8. Cross-Cutting Technical Decisions

- **Rate-limit pattern:** a single `rate_limits` table + `check_rate_limit(key, max, window)` definer function, called at the top of any public/abuse-prone RPC. Fixed window, opportunistic cleanup, no scheduler.
- **Audit/notification capture:** database triggers, not app-level inserts — capture is complete and unforgettable, survives new write paths, and centralizes the changed-keys diff logic.
- **Security-definer guard convention:** every function touching org data starts with an `is_org_member`/`is_org_admin` guard (raise or empty-return); every UPDATE policy on a privileged table pairs `USING` with a `WITH CHECK` and, where a column must be immutable, a `before update` guard trigger (the migration-007 lesson, applied to `notifications.read_at` and reused from `protect_provider_payment_fields`).
- **Pagination infra:** `usePagedQuery` + `Pagination` are the shared primitives; every new list (audit, reports drill-down) uses them; org-scoped localStorage keys are the standard from here on.
- **Managed migrations adoption point:** start of Phase 2. Baseline the existing 001–015 once, then everything rides `supabase db push` across both projects — cheap now (this plan adds 7 migrations × 2 environments), expensive later.

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Resend domain verification blocks Item 4 | The copy-link fallback ships regardless; email is additive, not a hard dependency. |
| Audit trigger overhead on hot item updates | Diff is changed-keys-only and no-op updates are skipped; measure on dev before prod. |
| Overdue-tasks jsonb scan cost at scale | Bounded per-org (thousands of items); pg_trgm/materialized follow-up noted if p95 degrades. |
| Manual two-env migration drift before CLI adoption | Per-release run-status checklist in §10; CLI adoption in Phase 2 closes it. |
| Server-side sort/search regressions on ClientsPage | Custom-field jsonb ordering is the riskiest change; covered by acceptance tests and kept behind the same page during rollout. |
| Rate-limit false positives for shared-NAT clients | Per-token limits are the primary guard; per-IP limits are generous (120/min) and only a secondary bound. |

---

## 10. Rollout & Migration Order

| Migration | Phase | Contents | Depends on |
|-----------|-------|----------|-----------|
| 015 | 1 | `rate_limits` + `check_rate_limit`; redefine `ingest_lead` & `get_invitation_by_token`; clear `send_contract` flag | — |
| 016 | 2 | `invitations.last_sent_at` | — |
| 017 | 2 | `get_org_dashboard`, `get_org_report`; pagination indexes | — |
| 018 | 2 | `normalize_phone`, `find_import_duplicates` | — |
| 019 | 3 | `audit_log` + `tg_audit` triggers; extend `tg_set_updated_at` | — |
| 020 | 3 | `notifications` + assignment/guard triggers | — |
| 021 | 4 | `search_org` | 018 (`normalize_phone`) |

Run order per migration: **dev (`atgoyroj…`) first, verify, then prod (`iezgyetf…`)**. Edge function secrets checklist (both projects): `RESEND_API_KEY`, `APP_URL`. Netlify: deploy DB objects before the UI that consumes them within each phase. Deploy `send-invite` with default `verify_jwt=true`.

---

## 11. Verification Strategy

- **Pure logic (Vitest):** `csv.test.js` (injection), `importDedup.test.js` (normalizer twins), `errors.js` mapping (Phase 3). Run: `npx vitest run`.
- **SQL smoke scripts (dev SQL editor):** rate-limit loops (assert Nth call fails), each new RPC's `is_org_member`/`is_org_admin` guard (call as a non-member, expect error/empty).
- **RLS regression suite (Phase 3, the highest-security-ROI item):** two seeded users/orgs on dev; named cases — self-promotion to `super_admin` blocked (migration-007), admin-deletion path blocked (migration-012), cross-org reads empty, member cannot read `audit_log`, member cannot read another user's `notifications`, member cannot write another user's `read_at`. Wired into GitHub Actions with lint + unit.
- **Manual QA scripts (Hebrew, per page):** invite→accept, dashboard number spot-check vs SQL, double-import yields zero new, 1,000-client pagination + search, assign→bell, Cmd+K navigate.
- **Accessibility:** axe DevTools protocol on the six pages both themes + keyboard-only walkthrough script.
- **Build/lint gate (existing):** `npm run lint` (oxlint) + `npm run build` must pass for every UI change.

---

## 12. Appendix — Traceability Matrix

Every analysis finding maps to an item + phase, or to an explicit non-goal.

| Finding | Item | Phase | Notes |
|---------|------|-------|-------|
| F1 send-contract unsafe | 1 | 1 | Deleted (not rebuilt — see Non-Goals) |
| F2 upload validation / orphan files | rider + P5 | 1 / 5 | Validation P1; orphan-cleanup cron P5 |
| F3 no rate limiting | 3 | 1 | |
| F4 CSV injection | 2 | 1 | |
| F5 no invite email | 4 | 2 | |
| F6 no dashboard/reports | 5 | 2 | |
| F7 no import dedup | 6 | 2 | |
| F8 no pagination | 7 | 2 | |
| F9 no bulk actions | rider | 4 | Bulk actions v1 |
| F10 no audit log | 8 | 3 | |
| F11 no notifications | 9 | 3 | In-app only (email = Non-Goal) |
| F12 no undo after archive | rider | 3 | Undo-toast |
| F13 partial drag-and-drop | P5 | 5 | Touch DnD = Non-Goal v1 |
| F14 no global search | 10 | 4 | |
| F15 localStorage not org-scoped | rider | 1 | Fixed with pagination keys |
| F16 no error monitoring | rider | 1 | Sentry |
| F17 no tests / RLS tests / CI | rider | 3 | RLS regression suite + CI |
| F18 weak mobile | 11 | 4 | |
| F19 inconsistent form validation | rider | 2 | IL phone + unique warning |
| F20 no recurring-payments UI | P5 | 5 | Product-priority dependent |
| F21 accessibility gaps | 12 | 4 | |
| F22 no TypeScript | P5 | 5 | Last |
| F23 no managed migrations | rider | 2 | CLI adoption |
| F24 Board/CRM duplication | P5 | 5 | Generic Kanban before DnD |
| F25 no shared data layer | P5 | 5 | Own hook family (not React Query) |
| F26 single-client hack pattern | 1 | 1 | Send-contract is the exemplar |
| F27 no skeleton states | rider | 2 | With dashboard/tables |
| F28 no error taxonomy | rider | 3 | `src/lib/errors.js` |
| F29 no breadcrumbs | rider | 4 | |
| F30 client-side updated_at | 8 | 3 | Fixed via `tg_set_updated_at` extension |
