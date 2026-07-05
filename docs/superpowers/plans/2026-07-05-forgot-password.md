# Forgot Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user who forgot their password request a reset email and set a new password, using Supabase Auth's built-in recovery flow.

**Architecture:** Two new public pages (`ForgotPasswordPage`, `ResetPasswordPage`) added as routes alongside the existing `LoginPage`/`SignupPage`. `ForgotPasswordPage` calls `supabase.auth.resetPasswordForEmail`; `ResetPasswordPage` reads the recovery session Supabase's client auto-establishes from the URL, then calls `supabase.auth.updateUser({ password })`. A "שכחתי סיסמה?" link is added to `LoginPage`.

**Tech Stack:** React 19, React Router v7, `@supabase/supabase-js` v2, Tailwind (via existing `Input`/`Button` UI components).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-05-forgot-password-design.md`
- Supabase redirect URLs (prod + local) already configured by the user — no dashboard changes needed in this plan.
- Password minimum length: 6 characters (matches `SignupPage.jsx:27`).
- All UI copy is Hebrew, RTL, matching existing tone in `LoginPage.jsx`/`SignupPage.jsx`.
- No test framework (no Cypress/Vitest/Jest config) exists in this repo — verification is manual via the dev server, not automated tests. Do not add a test framework as part of this plan.
- Reuse existing `Input`/`Button` components from `src/components/ui/` and the `handleEnterAsTab` helper from `src/lib/formNav`. Do not create new UI primitives.

---

### Task 1: Forgot-password request page

**Files:**
- Create: `src/pages/ForgotPasswordPage.jsx`
- Modify: `src/App.jsx` (add route)

**Interfaces:**
- Consumes: `supabase` from `src/lib/supabase.js` (`supabase.auth.resetPasswordForEmail(email, { redirectTo })`); `Button`, `Input` from `src/components/ui`; `handleEnterAsTab` from `src/lib/formNav`.
- Produces: route `/forgot-password` rendering `ForgotPasswordPage`, linked to from `LoginPage` in Task 3.

- [ ] **Step 1: Create `ForgotPasswordPage.jsx`**

```jsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import SetupNotice from '../components/SetupNotice'
import { handleEnterAsTab } from '../lib/formNav'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)
    try {
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      // מציגים תמיד את אותה הודעה, בין אם המייל קיים ובין אם לא —
      // כדי לא לחשוף אילו כתובות מייל רשומות במערכת
      setMessage('אם קיים חשבון עם כתובת המייל הזו, נשלח אליו קישור לאיפוס סיסמה.')
    } catch {
      setError('משהו השתבש. נסו שוב.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen">
      <SetupNotice />
      <div className="flex min-h-[calc(100vh-40px)] items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold text-text">
              Base<span className="text-accent">CRM</span>
            </h1>
            <p className="mt-2 text-text-muted">ניהול משימות ולקוחות</p>
          </div>

          <form
            onSubmit={handleSubmit}
            onKeyDown={handleEnterAsTab}
            className="space-y-4 rounded-lg border border-border bg-surface p-6"
            data-testid="forgot-password-form"
          >
            <h2 className="text-xl font-semibold text-text">שכחתי סיסמה</h2>
            <p className="text-sm text-text-muted">
              הזינו את כתובת המייל שלכם ונשלח אליכם קישור לאיפוס הסיסמה.
            </p>

            <Input
              label="אימייל"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoComplete="email"
              data-testid="forgot-password-email"
            />

            {error && <p className="text-sm text-status-red" data-testid="forgot-password-error">{error}</p>}
            {message && <p className="text-sm text-status-green" data-testid="forgot-password-message">{message}</p>}

            <Button type="submit" className="w-full" disabled={loading} data-testid="forgot-password-submit">
              {loading ? 'שולח...' : 'שליחת קישור לאיפוס'}
            </Button>

            <p className="text-center text-sm text-text-muted">
              נזכרתם בסיסמה?{' '}
              <Link to="/login" className="text-accent hover:underline" data-testid="forgot-password-login-link">
                כניסה
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Register the route in `App.jsx`**

In `src/App.jsx`, add the import near the other page imports:

```jsx
import ForgotPasswordPage from './pages/ForgotPasswordPage'
```

Add the route next to `/signup` in the public routes block:

```jsx
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
```

- [ ] **Step 3: Manual verification**

Run the dev server (`npm run dev`), navigate to `http://localhost:5173/forgot-password`, submit a real or fake email, and confirm the success message renders (`forgot-password-message`) and no console errors appear. Confirm the "כניסה" link navigates to `/login`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/ForgotPasswordPage.jsx src/App.jsx
git commit -m "feat: add forgot-password request page"
```

---

### Task 2: Reset-password page

**Files:**
- Create: `src/pages/ResetPasswordPage.jsx`
- Modify: `src/App.jsx` (add route)

**Interfaces:**
- Consumes: `supabase.auth.getSession()`, `supabase.auth.updateUser({ password })`, `supabase.auth.signOut()` from `src/lib/supabase.js`; `Button`, `Input` from `src/components/ui`; `handleEnterAsTab` from `src/lib/formNav`.
- Produces: route `/reset-password` rendering `ResetPasswordPage`, the target of the `redirectTo` URL set in Task 1.

- [ ] **Step 1: Create `ResetPasswordPage.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import SetupNotice from '../components/SetupNotice'
import { handleEnterAsTab } from '../lib/formNav'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [checkingSession, setCheckingSession] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let active = true
    // כשלוחצים על הקישור מהמייל, ה-client של supabase קורא את ה-URL
    // ומקים session זמני מסוג recovery באופן אוטומטי
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setHasSession(Boolean(data.session))
      setCheckingSession(false)
    })
    return () => {
      active = false
    }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password.length < 6) {
      setError('הסיסמה חייבת להכיל לפחות 6 תווים.')
      return
    }
    if (password !== confirmPassword) {
      setError('הסיסמאות אינן תואמות.')
      return
    }
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      // מתנתקים כדי לא להשאיר session פעיל על עמוד ההתחברות
      await supabase.auth.signOut()
      navigate('/login', { state: { resetSuccess: true }, replace: true })
    } catch {
      setError('משהו השתבש. נסו שוב.')
    } finally {
      setLoading(false)
    }
  }

  let content
  if (checkingSession) {
    content = <p className="text-sm text-text-muted" data-testid="reset-password-loading">בודקים את הקישור...</p>
  } else if (!hasSession) {
    content = (
      <div data-testid="reset-password-expired">
        <p className="text-sm text-status-red">הקישור פג תוקף או שגוי. בקשו קישור חדש.</p>
        <Link to="/forgot-password" className="mt-2 inline-block text-sm text-accent hover:underline">
          בקשת קישור חדש
        </Link>
      </div>
    )
  } else {
    content = (
      <form
        onSubmit={handleSubmit}
        onKeyDown={handleEnterAsTab}
        className="space-y-4"
        data-testid="reset-password-form"
      >
        <Input
          label="סיסמה חדשה"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="לפחות 6 תווים"
          required
          autoComplete="new-password"
          data-testid="reset-password-password"
        />
        <Input
          label="אימות סיסמה"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="הזינו שוב את הסיסמה"
          required
          autoComplete="new-password"
          data-testid="reset-password-confirm"
        />

        {error && <p className="text-sm text-status-red" data-testid="reset-password-error">{error}</p>}

        <Button type="submit" className="w-full" disabled={loading} data-testid="reset-password-submit">
          {loading ? 'מעדכן...' : 'עדכון סיסמה'}
        </Button>
      </form>
    )
  }

  return (
    <div className="min-h-screen">
      <SetupNotice />
      <div className="flex min-h-[calc(100vh-40px)] items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold text-text">
              Base<span className="text-accent">CRM</span>
            </h1>
            <p className="mt-2 text-text-muted">ניהול משימות ולקוחות</p>
          </div>

          <div className="space-y-4 rounded-lg border border-border bg-surface p-6">
            <h2 className="text-xl font-semibold text-text">איפוס סיסמה</h2>
            {content}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Register the route in `App.jsx`**

Add the import:

```jsx
import ResetPasswordPage from './pages/ResetPasswordPage'
```

Add the route:

```jsx
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
```

- [ ] **Step 3: Manual verification — expired/invalid link state**

Run the dev server, navigate directly to `http://localhost:5173/reset-password` (no session), and confirm the `reset-password-expired` block renders with a working link to `/forgot-password`.

- [ ] **Step 4: Manual verification — full recovery flow**

Trigger a real reset email via `/forgot-password` for a test account (or use the Supabase dashboard's "reset password" email preview / a real inbox), click the link, confirm it lands on `/reset-password` with the form visible (not the expired state), submit a new password (≥ 6 chars, matching confirm field), and confirm redirect to `/login`. Then log in with the new password to confirm it was actually changed.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ResetPasswordPage.jsx src/App.jsx
git commit -m "feat: add reset-password page"
```

---

### Task 3: Link from LoginPage + post-reset success message

**Files:**
- Modify: `src/pages/LoginPage.jsx`

**Interfaces:**
- Consumes: `useLocation` (already imported in `LoginPage.jsx`); `location.state.resetSuccess` set by `ResetPasswordPage` (Task 2, Step 1).
- Produces: none consumed elsewhere.

- [ ] **Step 1: Add "שכחתי סיסמה?" link and success message to `LoginPage.jsx`**

Modify `src/pages/LoginPage.jsx`: add a `message` state initialized from `location.state?.resetSuccess`, render it above the error, and add the forgot-password link under the password `Input`.

```jsx
import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import SetupNotice from '../components/SetupNotice'
import { handleEnterAsTab } from '../lib/formNav'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState(location.state?.inviteEmail || '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message] = useState(
    location.state?.resetSuccess ? 'הסיסמה עודכנה בהצלחה. התחברו עם הסיסמה החדשה.' : ''
  )
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      navigate(location.state?.from || '/', { replace: true })
    } catch {
      setError('אימייל או סיסמה שגויים. נסו שוב.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen">
      <SetupNotice />
      <div className="flex min-h-[calc(100vh-40px)] items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold text-text">
              Base<span className="text-accent">CRM</span>
            </h1>
            <p className="mt-2 text-text-muted">ניהול משימות ולקוחות</p>
          </div>

          <form
            onSubmit={handleSubmit}
            onKeyDown={handleEnterAsTab}
            className="space-y-4 rounded-lg border border-border bg-surface p-6"
            data-testid="login-form"
          >
            <h2 className="text-xl font-semibold text-text">כניסה למערכת</h2>

            <Input
              label="אימייל"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoComplete="email"
              data-testid="login-email"
            />
            <div>
              <Input
                label="סיסמה"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                data-testid="login-password"
              />
              <Link
                to="/forgot-password"
                className="mt-1 inline-block text-sm text-accent hover:underline"
                data-testid="login-forgot-password-link"
              >
                שכחתי סיסמה?
              </Link>
            </div>

            {message && <p className="text-sm text-status-green" data-testid="login-reset-message">{message}</p>}
            {error && <p className="text-sm text-status-red" data-testid="login-error">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading} data-testid="login-submit">
              {loading ? 'מתחבר...' : 'כניסה'}
            </Button>

            <p className="text-center text-sm text-text-muted">
              אין לך חשבון?{' '}
              <Link to="/signup" className="text-accent hover:underline" data-testid="login-signup-link">
                הרשמה
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Manual verification**

Run the dev server, visit `/login`, confirm the "שכחתי סיסמה?" link appears under the password field and navigates to `/forgot-password`. Then re-run the full flow from Task 2 Step 4 end-to-end and confirm that after the password update, `/login` shows the green "הסיסמה עודכנה בהצלחה" message.

- [ ] **Step 3: Commit**

```bash
git add src/pages/LoginPage.jsx
git commit -m "feat: link forgot-password from login and show reset-success message"
```
