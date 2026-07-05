# Forgot Password — Design

## Problem

`LoginPage` has no way for a user who forgot their password to recover their account. There is no password-reset code anywhere in the codebase. The app uses Supabase Auth (`supabase.auth.signInWithPassword` / `signUp`), which has built-in password recovery via `resetPasswordForEmail` + `updateUser`, currently unused.

## Goal

Add a standard "forgot password" flow using Supabase Auth's built-in recovery mechanism:
1. User requests a reset link from a new `/forgot-password` page.
2. User clicks the emailed link, lands on a new `/reset-password` page with a temporary recovery session already established by the Supabase client.
3. User sets a new password and is redirected to `/login`.

Supabase dashboard redirect URLs (prod + local) have already been configured by the user — no further manual Supabase config is needed for this spec.

## Non-goals

- No custom email service/template — uses Supabase's default recovery email.
- No change to session/login logic beyond what's needed for the recovery flow.
- No rate-limiting or abuse-prevention UI beyond what Supabase Auth already enforces server-side.

## Routes

Two new public routes added to [App.jsx](../../../src/App.jsx), alongside `/login`, `/signup`, `/accept-invite`:

```jsx
<Route path="/forgot-password" element={<ForgotPasswordPage />} />
<Route path="/reset-password" element={<ResetPasswordPage />} />
```

## Components

### `src/pages/ForgotPasswordPage.jsx`

Visual/structural clone of `LoginPage`'s card layout (logo header, `border border-border bg-surface` card, `Input`/`Button` from `components/ui`, `handleEnterAsTab` on the form).

State: `email`, `error`, `message` (success), `loading`.

On submit:
```js
const { error } = await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: `${window.location.origin}/reset-password`,
})
```

- Regardless of whether `error` is set or the email exists, show the **same** success message: "אם קיים חשבון עם כתובת המייל הזו, נשלח אליו קישור לאיפוס סיסמה." This avoids leaking which emails are registered (Supabase itself does not distinguish "user not found" in this call by default, but we treat it uniformly regardless).
- Only show an error state for genuine failures unrelated to whether the account exists (e.g. malformed email is already caught by the `type="email"` input; network errors get a generic "משהו השתבש. נסו שוב." message).
- Include a link back to `/login`.

`data-testid`s: `forgot-password-form`, `forgot-password-email`, `forgot-password-submit`, `forgot-password-message`, `forgot-password-error`, `forgot-password-login-link`.

### `src/pages/ResetPasswordPage.jsx`

Same visual pattern. State: `password`, `confirmPassword`, `error`, `loading`, plus a `sessionReady` check.

On mount, check for a valid recovery session (Supabase's client parses the URL fragment and establishes the session automatically via `detectSessionInUrl`, default-on). Use `supabase.auth.getSession()` on mount:
- If there's no session, show an inline error state instead of the form: "הקישור פג תוקף או שגוי. בקשו קישור חדש." with a link to `/forgot-password`.
- If there is a session, render the form.

On submit:
- Validate `password.length >= 6` (matches `SignupPage`'s rule) and `password === confirmPassword` before calling Supabase; show inline errors matching `SignupPage`'s style.
- Call `supabase.auth.updateUser({ password })`.
- On success: show a brief success message and redirect to `/login` (e.g. after a short delay, or immediately with a message passed via `navigate` state, consistent with how `SignupPage` handles post-signup messaging).
- On failure: generic Hebrew error message, same `catch` pattern as other auth pages.

`data-testid`s: `reset-password-form`, `reset-password-password`, `reset-password-confirm`, `reset-password-submit`, `reset-password-error`, `reset-password-expired`.

## LoginPage change

Add a "שכחתי סיסמה?" link in [LoginPage.jsx](../../../src/pages/LoginPage.jsx), placed under the password `Input` (before the submit button), linking to `/forgot-password`. Styled like the existing `signup` link (`text-accent hover:underline`), `data-testid="login-forgot-password-link"`.

## Error handling summary

| Case | Handling |
|---|---|
| Reset requested for non-existent email | Same success message as valid email (no leak) |
| Reset requested, network/unexpected error | Generic error message |
| Reset link expired/invalid/already used | Inline "expired" state on `/reset-password` with link to request a new one |
| New password too short | Inline validation error, no Supabase call made |
| New password / confirm mismatch | Inline validation error, no Supabase call made |
| `updateUser` fails unexpectedly | Generic error message |

## Testing

Given the codebase's existing `data-testid` conventions (used across `LoginPage`/`SignupPage`), this is presumably exercised by Cypress specs. New specs should cover:
- Requesting a reset link (mocking `resetPasswordForEmail`) shows the success message.
- Visiting `/reset-password` without a session shows the expired-link state.
- Visiting `/reset-password` with a mocked valid session, submitting a new password, redirects to `/login`.
- Password validation errors (too short / mismatch) block submission.
