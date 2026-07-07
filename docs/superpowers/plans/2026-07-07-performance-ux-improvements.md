# BaseCRM Performance & UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the highest-impact performance and UX problems found in the 2026-07-07 full-app analysis: bundle size, app-wide re-renders, N+1 queries, `window.confirm` dialogs, missing toast feedback, missing error boundary, missing focus management, missing page titles, and redundant refetching.

**Architecture:** Wave 1 builds shared infrastructure (code splitting, memoized contexts, ErrorBoundary, Toast + Confirm providers, Button loading state, useTitle hook, Modal focus trap). Wave 2 applies that infrastructure across every page, grouped by domain so tasks touch disjoint files and can run in parallel. Wave 3 does data-layer performance work (members cache in OrgContext, board render memoization).

**Tech Stack:** React 19, Vite 8, react-router-dom 7, @supabase/supabase-js 2, Tailwind CSS v4 (design tokens: `bg-surface`, `bg-surface-2`, `border-border`, `text-text`, `text-text-muted`, `text-text-dim`, `bg-accent`, `text-status-red`, `bg-status-red`). App is Hebrew, `dir="rtl"` — all user-facing strings in Hebrew, use logical utilities (`start-*`, `end-*`, `ms-*`, `me-*`) for positioning.

## Global Constraints

- **No test framework exists in this repo.** Verification per task = `npm run lint` passes (oxlint) and `npm run build` passes. Do NOT add a test framework in these tasks (it is in the backlog).
- All user-facing strings in Hebrew, matching the tone of existing strings.
- Do not change Supabase schema or RLS. Client-side only.
- Do not add new npm dependencies.
- Preserve existing behavior except where a task explicitly changes it.
- Each task ends with a git commit (`git add <files> && git commit -m "<type>: <summary>"`), ending the message with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- ALWAYS read a file before editing it. Reported line numbers are approximate — locate by content.

---

## Wave 1 — Infrastructure (Tasks 1–4 are mutually independent, parallel-safe: disjoint files)

### Task 1: Route-level code splitting

**Files:**
- Modify: `src/App.jsx` (whole file, 58 lines)

**Interfaces:**
- Consumes: `src/components/ui/LoadingSpinner.jsx` — `<LoadingSpinner label="טוען..." />`
- Produces: nothing new; same routes.

- [ ] **Step 1: Convert all 15 page imports to `React.lazy`**

Keep `ProtectedRoute`, `Layout`, `OrgLayout` as static imports (they render on every page). Convert every page import:

```jsx
import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import OrgLayout from './components/OrgLayout'
import LoadingSpinner from './components/ui/LoadingSpinner'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const SignupPage = lazy(() => import('./pages/SignupPage'))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const AcceptInvitePage = lazy(() => import('./pages/AcceptInvitePage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const WorkspacesPage = lazy(() => import('./pages/WorkspacesPage'))
const BoardsPage = lazy(() => import('./pages/BoardsPage'))
const BoardPage = lazy(() => import('./pages/BoardPage'))
const ClientsPage = lazy(() => import('./pages/ClientsPage'))
const ClientPage = lazy(() => import('./pages/ClientPage'))
const OrgSettingsPage = lazy(() => import('./pages/OrgSettingsPage'))
const SendContractPage = lazy(() => import('./pages/SendContractPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))
```

- [ ] **Step 2: Wrap `<Routes>` in `<Suspense>`**

```jsx
export default function App() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><LoadingSpinner label="טוען..." /></div>}>
      <Routes>
        {/* ... routes exactly as before ... */}
      </Routes>
    </Suspense>
  )
}
```

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build`
Expected: both pass; build output shows multiple per-page JS chunks instead of one bundle.

- [ ] **Step 4: Commit** — `perf(app): route-level code splitting with React.lazy`

---

### Task 2: Memoize context provider values

**Files:**
- Modify: `src/context/AuthContext.jsx:48-56`
- Modify: `src/context/OrgContext.jsx:67-77`
- Modify: `src/context/ThemeContext.jsx:15-17`

**Interfaces:**
- Produces: identical context shapes — consumers unchanged.

- [ ] **Step 1: AuthContext** — wrap callbacks and value:

```jsx
// add useMemo to the react import
const refreshProfile = useCallback(() => loadProfile(session?.user?.id), [loadProfile, session?.user?.id])
const signOut = useCallback(() => supabase.auth.signOut(), [])

const value = useMemo(() => ({
  session,
  user: session?.user ?? null,
  profile,
  loading,
  isSuperAdmin: Boolean(profile?.is_super_admin),
  refreshProfile,
  signOut,
}), [session, profile, loading, refreshProfile, signOut])
```

- [ ] **Step 2: OrgContext** — wrap value:

```jsx
const value = useMemo(() => ({
  orgId,
  org,
  role,
  isAdmin: role === 'admin' || isSuperAdmin,
  loading,
  notFound,
  structureVersion,
  refreshStructure,
  refreshOrg,
}), [orgId, org, role, isSuperAdmin, loading, notFound, structureVersion, refreshStructure, refreshOrg])
```

- [ ] **Step 3: ThemeContext** — wrap toggle + value:

```jsx
const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])
const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme])
return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
```

- [ ] **Step 4: Verify** — `npm run lint && npm run build` → pass.
- [ ] **Step 5: Commit** — `perf(context): memoize context provider values`

---

### Task 3: UX infrastructure — ErrorBoundary, Toast system, Confirm dialog, useTitle, Button loading

**Files:**
- Create: `src/components/ErrorBoundary.jsx`
- Create: `src/context/ToastContext.jsx`
- Create: `src/context/ConfirmContext.jsx`
- Create: `src/lib/useTitle.js`
- Modify: `src/components/ui/Button.jsx`
- Modify: `src/main.jsx`

**Interfaces (produced — Wave 2/3 tasks depend on these EXACT signatures):**
- `useToast()` → `{ toast }` where `toast(message: string, type?: 'success' | 'error' | 'info')` (default `'success'`)
- `useConfirm()` → `confirm(opts: { title: string, message?: string, confirmText?: string, cancelText?: string, danger?: boolean }): Promise<boolean>`
- `useTitle(title?: string)` — sets `document.title` to `` `${title} · BaseCRM` ``, restores default on unmount.
- `<Button loading={bool}>` — disables the button and shows a spinner while keeping the label.

- [ ] **Step 1: Create `src/components/ErrorBoundary.jsx`** (class component — the only supported way to catch render errors):

```jsx
import { Component } from 'react'

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div dir="rtl" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
          <h1 className="text-2xl font-bold text-text">משהו השתבש</h1>
          <p className="max-w-md text-text-muted">
            אירעה שגיאה בלתי צפויה. אפשר לנסות לרענן את הדף — אם הבעיה חוזרת, צרו קשר עם התמיכה.
          </p>
          <button
            onClick={() => { window.location.href = '/' }}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover cursor-pointer"
          >
            חזרה לדף הבית
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
```

Note: check `src/index.css` for the background token (`bg-bg` vs another name) and use the app's actual page-background token.

- [ ] **Step 2: Create `src/context/ToastContext.jsx`**:

```jsx
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

const ToastContext = createContext(null)

const TYPE_STYLES = {
  success: 'border-status-green/40 bg-surface text-text',
  error: 'border-status-red/40 bg-surface text-text',
  info: 'border-border bg-surface text-text',
}

const TYPE_ICON = { success: '✓', error: '✕', info: 'ℹ' }
const TYPE_ICON_COLOR = {
  success: 'text-status-green',
  error: 'text-status-red',
  info: 'text-text-muted',
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)

  const dismiss = useCallback((id) => {
    setToasts((cur) => cur.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((message, type = 'success') => {
    const id = ++idRef.current
    setToasts((cur) => [...cur, { id, message, type }])
    setTimeout(() => dismiss(id), 4000)
  }, [dismiss])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 start-4 z-[100] flex flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm shadow-lg ${TYPE_STYLES[t.type] || TYPE_STYLES.info}`}
          >
            <span className={`font-bold ${TYPE_ICON_COLOR[t.type] || ''}`}>{TYPE_ICON[t.type] || ''}</span>
            <span>{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="ms-2 text-text-dim hover:text-text cursor-pointer" aria-label="סגירה">×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
```

Note: check `src/index.css` for the actual green status token name (`status-green` or similar); if none exists, use `text-emerald-500`-equivalent from existing tokens or fall back to `text-accent` for success.

- [ ] **Step 3: Create `src/context/ConfirmContext.jsx`** (promise-based confirm built on the existing Modal + Button):

```jsx
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import Modal from '../components/ui/Modal'
import Button from '../components/ui/Button'

const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null) // { title, message, confirmText, cancelText, danger }
  const resolveRef = useRef(null)

  const confirm = useCallback((opts) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve
      setState({
        title: opts.title,
        message: opts.message || '',
        confirmText: opts.confirmText || 'אישור',
        cancelText: opts.cancelText || 'ביטול',
        danger: Boolean(opts.danger),
      })
    })
  }, [])

  const close = useCallback((result) => {
    resolveRef.current?.(result)
    resolveRef.current = null
    setState(null)
  }, [])

  const value = useMemo(() => ({ confirm }), [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Modal
        open={Boolean(state)}
        onClose={() => close(false)}
        title={state?.title || ''}
        size="sm"
        testid="confirm-dialog"
        footer={
          <>
            <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)} data-testid="confirm-ok">
              {state?.confirmText}
            </Button>
            <Button variant="ghost" onClick={() => close(false)}>{state?.cancelText}</Button>
          </>
        }
      >
        {state?.message && <p className="text-sm text-text-muted">{state.message}</p>}
      </Modal>
    </ConfirmContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx.confirm
}
```

- [ ] **Step 4: Create `src/lib/useTitle.js`**:

```js
import { useEffect } from 'react'

const DEFAULT_TITLE = 'BaseCRM — ניהול משימות ולקוחות'

export function useTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · BaseCRM` : DEFAULT_TITLE
    return () => { document.title = DEFAULT_TITLE }
  }, [title])
}
```

- [ ] **Step 5: Add `loading` prop to `src/components/ui/Button.jsx`**:

```jsx
export default function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  disabled,
  loading = false,
  children,
  ...props
}) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {loading && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
      )}
      {children}
    </button>
  )
}
```

- [ ] **Step 6: Wire providers + boundary in `src/main.jsx`**:

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import { ConfirmProvider } from './context/ConfirmContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              <ConfirmProvider>
                <App />
              </ConfirmProvider>
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
)
```

- [ ] **Step 7: Verify** — `npm run lint && npm run build` → pass.
- [ ] **Step 8: Commit** — `feat(ux): error boundary, toast system, confirm dialog, useTitle, button loading state`

---

### Task 4: Modal focus trap + initial focus

**Files:**
- Modify: `src/components/ui/Modal.jsx` (whole file, 45 lines)

**Interfaces:**
- Produces: same Modal props (`open, onClose, title, children, footer, size, testid`) — no consumer changes.

- [ ] **Step 1: Rewrite Modal with focus management**

```jsx
import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

export default function Modal({ open, onClose, title, children, footer, size = 'md', testid }) {
  const panelRef = useRef(null)
  const prevFocusRef = useRef(null)

  useEffect(() => {
    if (!open) return
    prevFocusRef.current = document.activeElement

    // מיקוד ראשוני: שדה הקלט הראשון, ואם אין — הפאנל עצמו
    const panel = panelRef.current
    const focusables = panel ? [...panel.querySelectorAll(FOCUSABLE)] : []
    const firstInput = focusables.find((el) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName))
    ;(firstInput || focusables[0] || panel)?.focus()

    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose?.()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const els = [...panelRef.current.querySelectorAll(FOCUSABLE)]
      if (els.length === 0) return
      const first = els[0]
      const last = els[els.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prevFocusRef.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  const maxW = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl' }[size]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={`w-full ${maxW} rounded-lg border border-border bg-surface shadow-xl`}
        onClick={(e) => e.stopPropagation()}
        data-testid={testid}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-lg font-semibold text-text">{title}</h3>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text text-xl leading-none cursor-pointer"
            aria-label="סגירה"
            data-testid="modal-close"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-start gap-2 border-t border-border px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify** — `npm run lint && npm run build` → pass.
- [ ] **Step 3: Commit** — `feat(a11y): modal focus trap, initial focus, dialog semantics`

---

## Wave 2 — Apply infrastructure across pages (Tasks 5–8 are mutually independent, parallel-safe: disjoint files). Requires Tasks 3–4 merged.

**Shared conversion patterns for all Wave 2 tasks** (each task repeats these; enclosing functions are already `async` in almost all sites — make them async if not):

Pattern A — replace `window.confirm`:
```jsx
// before
if (!window.confirm(`להשבית את הלקוח "${client.name}"? הנתונים יישמרו וניתן לשחזר.`)) return
// after (import { useConfirm } from '../context/ConfirmContext'; const confirm = useConfirm() at component top)
const ok = await confirm({
  title: 'השבתת לקוח',
  message: `להשבית את הלקוח "${client.name}"? הנתונים יישמרו וניתן לשחזר.`,
  confirmText: 'השבתה',
  danger: true,
})
if (!ok) return
```
IMPORTANT: `useConfirm()` is a hook — call it at the top level of the component, not inside handlers. If the confirm call is inside a helper component (not the page), wire the hook there.

Pattern B — success/error toasts (import `{ useToast }` from `../context/ToastContext`, `const { toast } = useToast()`):
```jsx
// after a successful mutation:
toast('הלקוח נוצר בהצלחה')
// in catch blocks that currently only setError(...), ALSO or INSTEAD (for non-form actions) show:
toast('שמירת השינוי נכשלה', 'error')
```
Rule of thumb: form-in-modal errors keep inline `setError`; row-level/inline actions (archive, restore, drag, quick-edit) get an error toast. Successful create/archive/restore/save gets a success toast.

Pattern C — page title (import `{ useTitle }` from `../lib/useTitle` — adjust relative path):
```jsx
useTitle('לקוחות')            // static pages
useTitle(client?.name)        // detail pages (undefined while loading is fine)
```

Pattern D — button loading state on async submit buttons:
```jsx
<Button type="submit" loading={saving}>צור לקוח</Button>
```
Use the existing `saving`/`busy` state var of each form; add one (`const [saving, setSaving] = useState(false)`) only where missing around the async submit.

Pattern E — empty state with CTA:
```jsx
<div className="rounded-lg border border-dashed border-border bg-surface/50 p-10 text-center">
  <p className="mb-4 text-text-muted">אין עדיין לקוחות.</p>
  <Button onClick={() => setAddOpen(true)}>+ לקוח חדש</Button>
</div>
```
Only add the CTA button when the current user is allowed to perform it (respect existing `isAdmin`/`canEdit` conditions in the file).

### Task 5: CRM list domain — ClientsPage + CRM components

**Files:**
- Modify: `src/pages/ClientsPage.jsx` (~628 lines; `window.confirm` at ~line 239; refetch-after-mutation sites at ~lines 228–290; empty state ~line 494)
- Modify: `src/components/crm/LeadSourcesManager.jsx` (confirm at ~line 115)
- Modify: `src/components/ClientStatusManager.jsx`
- Modify: `src/components/crm/ImportClientsModal.jsx`

**Interfaces:**
- Consumes: `useConfirm`, `useToast`, `useTitle`, `<Button loading>` from Task 3 (exact signatures in Task 3 header).

- [ ] **Step 1: Read all four files fully.**
- [ ] **Step 2: ClientsPage** — apply Pattern A to the archive-client confirm; Pattern B to create/archive/restore/status-change/import mutations; Pattern C `useTitle('לקוחות')`; Pattern D on the create-client modal submit and other async buttons; Pattern E on the "no clients" empty state (there is a filtered-empty state too — for it, keep text-only but add a "נקו סינון" button clearing the search/filter state).
- [ ] **Step 3: ClientsPage — stop full reloads where the mutation returns the row.** For `handleCreate`: if the insert uses `.select().single()` (or can be changed to), replace `await load()` with `setClients((cur) => [...cur, data])`. For archive: `setClients((cur) => cur.filter((c) => c.id !== client.id))`. For restore-from-archive and multi-entity changes (statuses/fields manager saves), KEEP `await load()` — correctness over micro-optimization. Only convert sites where the local patch is obviously equivalent.
- [ ] **Step 4: LeadSourcesManager, ClientStatusManager, ImportClientsModal** — Patterns A/B/D as applicable (confirm → useConfirm, success/error toasts, loading buttons). ImportClientsModal: toast with imported count on success (`toast(\`יובאו ${n} לקוחות\`)`).
- [ ] **Step 5: Verify** — `npm run lint && npm run build` → pass. Confirm zero remaining `window.confirm` in the four files: `grep -n "window.confirm" src/pages/ClientsPage.jsx src/components/crm/LeadSourcesManager.jsx src/components/ClientStatusManager.jsx src/components/crm/ImportClientsModal.jsx` → no matches.
- [ ] **Step 6: Commit** — `feat(crm): confirm dialogs, toasts, titles, loading states, local-state mutations in clients pages`

### Task 6: Client detail page — ClientPage (+ N+1 fix)

**Files:**
- Modify: `src/pages/ClientPage.jsx` (~554 lines; confirms at ~lines 194, 200; N+1 linked-items fetch at ~lines 101–120; back-link arrow at ~line 226)

**Interfaces:**
- Consumes: `useConfirm`, `useToast`, `useTitle`, `<Button loading>` from Task 3.

- [ ] **Step 1: Read the file fully.**
- [ ] **Step 2: Apply Patterns A/B/C/D** — confirms for archive-contact and archive-client; toasts for save/archive/restore/contact mutations; `useTitle(client?.name)`; loading buttons on async submits.
- [ ] **Step 3: Fix the N+1 linked-items query.** Current code fetches client-type columns then issues one `items` query per column via `Promise.all`. Replace the per-column queries with ONE `.or()` query; keep the old path as a fallback if `.or()` errors:

```js
const { data: clientCols } = await supabase
  .from('columns')
  .select('id')
  .eq('org_id', orgId)
  .eq('type', 'client')

let linkedItems = []
if (clientCols?.length) {
  const orExpr = clientCols.map((c) => `values->>${c.id}.eq.${clientId}`).join(',')
  const { data, error } = await supabase
    .from('items')
    .select(/* keep the EXACT same select list the current code uses */)
    .or(orExpr)
  if (!error) {
    linkedItems = data || []
  } else {
    // fallback: התנהגות קודמת (שאילתה לכל עמודה) אם ה-or נכשל
    const results = await Promise.all(
      clientCols.map((col) =>
        supabase.from('items').select(/* same select */).contains('values', { [col.id]: clientId })
      )
    )
    linkedItems = results.flatMap((r) => r.data || [])
  }
}
```
Preserve any de-duplication/sorting the current code applies afterward. Keep the downstream state shape identical.
- [ ] **Step 4: RTL arrow** — if the back-link uses a hardcoded `→`/`←` pointing the wrong way in RTL, fix the direction (in RTL, "back to list" points right: `→` renders as pointing right... verify visually against surrounding code; the convention elsewhere in the app wins).
- [ ] **Step 5: Verify** — `npm run lint && npm run build` → pass; `grep -n "window.confirm" src/pages/ClientPage.jsx` → no matches.
- [ ] **Step 6: Commit** — `feat(crm): client detail UX + single-query linked items lookup`

### Task 7: Boards domain — BoardPage, BoardsPage, WorkspacesPage

**Files:**
- Modify: `src/pages/BoardPage.jsx` (~437 lines; confirm at ~line 186)
- Modify: `src/pages/BoardsPage.jsx` (~208 lines; confirm at ~line 92; empty state ~line 135)
- Modify: `src/pages/WorkspacesPage.jsx` (~242 lines; confirm at ~line 92; empty state ~line 132)

**Interfaces:**
- Consumes: `useConfirm`, `useToast`, `useTitle`, `<Button loading>` from Task 3.

- [ ] **Step 1: Read all three files fully.**
- [ ] **Step 2: Apply Patterns A/B/C/D/E to all three pages.** Titles: `useTitle(board?.name)` on BoardPage, `useTitle(workspaceName)` (or `useTitle('בורדים')` if the ws name isn't loaded) on BoardsPage, `useTitle('וורקספייסים')` on WorkspacesPage. Empty states get CTA buttons wired to the existing "create" modal openers, respecting `isAdmin`/`canEdit`.
- [ ] **Step 3: BoardPage — DB-side archived-columns filter.** The page loads all columns then filters archived client-side. First check `src/components/board/ArchivedModal.jsx`: if it fetches archived entities itself, add `.eq('is_archived', false)` to BoardPage's columns query and remove the redundant client-side filter; if BoardPage's loaded columns feed the archived modal, leave as is.
- [ ] **Step 4: Verify** — `npm run lint && npm run build` → pass; `grep -n "window.confirm" src/pages/BoardPage.jsx src/pages/BoardsPage.jsx src/pages/WorkspacesPage.jsx` → no matches.
- [ ] **Step 5: Commit** — `feat(boards): confirm dialogs, toasts, titles, empty-state CTAs`

### Task 8: Admin/settings/auth domain — AdminPage, OrgSettingsPage, DashboardPage, auth pages

**Files:**
- Modify: `src/pages/AdminPage.jsx` (~320 lines; confirms at ~lines 87, 124–125, 137–138)
- Modify: `src/pages/OrgSettingsPage.jsx` (confirm at ~line 69)
- Modify: `src/pages/DashboardPage.jsx` (~102 lines; empty state at ~lines 71–82)
- Modify: `src/pages/LoginPage.jsx`, `src/pages/SignupPage.jsx`, `src/pages/ForgotPasswordPage.jsx`, `src/pages/ResetPasswordPage.jsx`, `src/pages/AcceptInvitePage.jsx` (titles + button loading only)

**Interfaces:**
- Consumes: `useConfirm`, `useToast`, `useTitle`, `<Button loading>` from Task 3.

- [ ] **Step 1: Read the files fully.**
- [ ] **Step 2: AdminPage** — Pattern A on archive-org; the two double-confirm flows (hard-delete org, delete account) become ONE danger dialog each with the full warning in `message` (merge both existing texts), e.g.:

```jsx
const ok = await confirm({
  title: 'מחיקה לצמיתות',
  message: `למחוק לצמיתות את "${org.name}" וכל הנתונים שלו? כל הוורקספייסים, הבורדים והפריטים יימחקו לתמיד. פעולה זו בלתי הפיכה!`,
  confirmText: 'מחיקה לצמיתות',
  danger: true,
})
if (!ok) return
```
Add toasts on success/failure; `useTitle('ניהול-על')`.
- [ ] **Step 3: OrgSettingsPage** — Pattern A on remove-member confirm, toasts on invite/role-change/remove results (keep the existing detailed Hebrew RPC error mapping — surface it via inline error AND/OR toast as fits the current UI), `useTitle('הגדרות ארגון')`, button loading on invite/save.
- [ ] **Step 4: DashboardPage** — `useTitle('הארגונים שלי')`; empty state: keep the "not a member of any org" message but add guidance text (e.g. "בקשו ממנהל הארגון הזמנה, או פנו למנהל המערכת"). Do NOT add a create-org CTA unless the page already exposes org creation for the current user.
- [ ] **Step 5: Auth pages** — `useTitle('התחברות')`, `useTitle('הרשמה')`, `useTitle('שחזור סיסמה')`, `useTitle('איפוס סיסמה')`, `useTitle('הצטרפות לארגון')`; `loading` prop on submit buttons (they already track a busy/loading state — reuse it).
- [ ] **Step 6: Verify** — `npm run lint && npm run build` → pass; `grep -rn "window.confirm" src/` → NO matches anywhere in the repo.
- [ ] **Step 7: Commit** — `feat(admin,auth): confirm dialogs, toasts, page titles, loading states`

---

## Wave 3 — Data-layer & render performance (run after Wave 2; Tasks 9 and 10 are parallel-safe with each other ONLY if Task 10 doesn't touch BoardPage.jsx — it does, and so does Task 9 → run 9 then 10 sequentially)

### Task 9: Cache org members in OrgContext; drop per-page membership queries

**Files:**
- Modify: `src/context/OrgContext.jsx`
- Modify: `src/pages/BoardPage.jsx` (members query ~lines 60–77)
- Modify: `src/pages/ClientsPage.jsx` (members query ~lines 65–92)
- Modify: `src/pages/ClientPage.jsx` (members query ~lines 78–99)

**Interfaces:**
- Produces: `useOrg()` additionally returns `members` (array of `{ user_id, role, profiles: { full_name, email, is_super_admin } }`) and `refreshMembers()`.

- [ ] **Step 1: Read all four files; note the exact select shape each page uses for memberships.**
- [ ] **Step 2: OrgContext** — add members state loaded in the existing `load()` after the org row resolves:

```js
const [members, setMembers] = useState([])

const loadMembers = useCallback(async () => {
  const { data } = await supabase
    .from('memberships')
    .select('user_id, role, profiles(full_name, email, is_super_admin)')
    .eq('org_id', orgId)
  setMembers(data || [])
}, [orgId])

// inside load(), after setOrg/setRole (non-blocking is fine):
loadMembers()
```
Add `members`, `refreshMembers: loadMembers` to the memoized context value (include in the deps array).
- [ ] **Step 3: Consumers** — in BoardPage, ClientsPage, ClientPage: remove the local memberships query from their `Promise.all`, take `members` from `useOrg()`, and map it to whatever local shape the page uses (keep variable names). If a page needs a field not in the shared select (check first!), extend the OrgContext select instead of keeping the page query.
- [ ] **Step 4: OrgSettingsPage is NOT converted** (it manages memberships and needs its own richer query — leave untouched).
- [ ] **Step 5: Verify** — `npm run lint && npm run build` → pass.
- [ ] **Step 6: Commit** — `perf(org): cache members in OrgContext, drop duplicate membership queries`

### Task 10: Board render memoization

**Files:**
- Modify: `src/components/board/GroupSection.jsx`
- Modify: `src/components/board/BoardCell.jsx` (~393 lines)
- Possibly modify: `src/pages/BoardPage.jsx` (handler hoisting with `useCallback`)

**Interfaces:**
- Consumes/produces: no API changes — pure memoization.

- [ ] **Step 1: Read GroupSection.jsx, BoardCell.jsx, and BoardPage.jsx handler wiring fully.**
- [ ] **Step 2: Memoize the leaf components.** Wrap the per-item row component (inside GroupSection) and `BoardCell` in `React.memo`. Hoist inline lambdas that cross the memo boundary: in BoardPage wrap `onItemName`/`onItemValue`/archive/open handlers in `useCallback` with correct deps; in GroupSection, if `(v) => onValue(item, col.id, v)` style lambdas defeat the memo, restructure so the row/cell receives stable handlers plus `item`/`col` and composes the call internally.
- [ ] **Step 3: Behavior check** — memoized cells must still re-render when their value changes (they receive `item.values` data by prop). Do not memo anything whose props include a fresh object created inline per render unless you also stabilize that object with `useMemo`.
- [ ] **Step 4: Verify** — `npm run lint && npm run build` → pass.
- [ ] **Step 5: Commit** — `perf(board): memoize row/cell components and stabilize handlers`

---

## Final verification (orchestrator, after all tasks)

- [ ] `grep -rn "window.confirm" src/` → zero matches.
- [ ] `npm run lint && npm run build` → pass.
- [ ] Dev-server smoke test (`.env` present in worktree): login page renders, no console errors on load, lazy chunks load per route.

## Backlog (documented, intentionally NOT in this plan)

- List virtualization / pagination for 500+ clients (`react-window`), mobile card view for tables — high effort, needs product decisions.
- Test framework (Vitest + Testing Library) and GitHub Actions CI gate.
- Skeleton loading states; undo-toast pattern for archives; shared `useFetch`/React Query data layer; generic Kanban component to merge ClientsKanban/BoardKanban; error-message taxonomy (403/404/network); Sentry; breadcrumbs; TypeScript migration; server-side upload validation via RPC hardening.
