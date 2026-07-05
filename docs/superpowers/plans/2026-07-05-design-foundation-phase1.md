# Design Foundation Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin BaseCRM's color palette and typography to the "Refined workspace" (1A) redesign direction, add a working dark/light theme toggle, and introduce a minimal reusable Icon component — without changing any existing component's Tailwind class names or any page's layout.

**Architecture:** Update the *values* of the existing Tailwind v4 `@theme` color tokens in `src/index.css` (every existing utility class like `bg-bg`/`bg-surface`/`text-text-muted` keeps working unchanged since it references `var(--color-x)`, not a literal color), add a light-mode override block keyed on `html[data-theme="light"]`, and add a small `ThemeContext` (mirroring the existing `AuthContext` pattern) that toggles that attribute and persists the choice. A new `Icon` component supplies the two SVG icons (sun/moon) the toggle button needs.

**Tech Stack:** React 19 (plain JSX), Tailwind CSS v4 (`@theme` token system, already in use), Vite. No test framework configured (`package.json` has only `dev`/`build`/`lint`/`preview`) — verification is build + lint + (for the first time in this project) an actual browser check, since this feature is visible on the public login page and needs no authentication.

## Global Constraints

- Full spec: `docs/superpowers/specs/2026-07-05-design-foundation-phase1.md`.
- Preserve every existing Tailwind token **name** (`--color-bg`, `--color-surface`, `--color-surface-2`, `--color-border`, `--color-border-light`, `--color-text`, `--color-text-muted`, `--color-text-dim`, `--color-accent`, `--color-accent-hover`, status colors) — only values change, and only for the tokens the spec lists. Do not rename any token or touch any status-color value.
- New dark values: `--color-bg:#14172b`, `--color-surface:#1b1f38`, `--color-surface-2:#262b48`, `--color-border:#2f3556`, `--color-text:#f3f4fa`, `--color-text-muted:#a7abc6`, `--color-text-dim:#72779a`, `--color-accent:#4f5bd5`.
- New light values (applied only under `html[data-theme="light"]`): `--color-bg:#f5f6fb`, `--color-surface:#ffffff`, `--color-surface-2:#f1f3f9`, `--color-border:#e6e8f1`, `--color-text:#191c2e`, `--color-text-muted:#565c78`, `--color-text-dim:#8b90ab`. Accent (`#4f5bd5`) is identical in both modes, so it is not repeated in the light override block.
- New tokens (both modes need them; define once in `@theme`, not per-mode, since they derive from `--color-accent` and `--color-surface` via `color-mix()` which already resolves per-mode): `--color-accent-soft: color-mix(in srgb, var(--color-accent) 15%, transparent)`, `--color-accent-weak: color-mix(in srgb, var(--color-accent) 48%, var(--color-surface))`.
- Default theme is **dark** — no `data-theme` attribute present = dark (today's only look). Nothing changes for a user who never touches the toggle, beyond the token value refresh itself.
- `localStorage` key: `basecrm.theme` (matches this project's existing `basecrm.*` key convention, e.g. `basecrm.clientsView`, `basecrm.sidebarWidth`).
- Out of scope, do not touch: any status/label color (`client_statuses.color`, `LABEL_COLORS` in `src/lib/columnTypes.js`), any page/component other than `Navbar.jsx`, any emoji icon anywhere in the app except by adding the two new SVG icons alongside them (nothing existing is removed).
- This project is a real git repo (`git@github.com:guyco6742/BaseCRM.git`, branch `main`). Commit after each task; do not push (pushing is a separate step the human controls).

---

### Task 1: Color tokens + Assistant font

**Files:**
- Modify: `src/index.css` (the `@theme` block and the block right after it)
- Modify: `index.html:1-8` (the `<head>`)

**Interfaces:**
- Produces: updated values for every `--color-*` token listed in Global Constraints, plus the two new tokens `--color-accent-soft` and `--color-accent-weak`, all available to any component via existing Tailwind utility classes (`bg-accent-soft`, etc., once Tailwind picks up the new `@theme` entries) or via `var(--color-accent-soft)` in inline styles. Produces a light-mode override active whenever `document.documentElement.dataset.theme === 'light'`. Task 2's `ThemeContext` is the only thing that sets that attribute — Task 1 does not add any toggle UI itself.

- [ ] **Step 1: Replace the `@theme` block in `src/index.css`**

Read the current file first (`src/index.css`) to confirm it still matches this exactly — if Tailwind or another change has touched it, stop and report NEEDS_CONTEXT rather than guessing:

```css
@import "tailwindcss";

/* ===== BaseCRM — פלטת צבעים כהה בסגנון Monday ===== */
@theme {
  --color-bg: #1c1f3b;          /* רקע ראשי */
  --color-sidebar: #181b34;     /* סרגל צד */
  --color-surface: #292f4c;     /* משטחים / כרטיסים */
  --color-surface-2: #30365a;   /* משטח משני / hover */
  --color-border: #3b4064;      /* גבולות */
  --color-border-light: #4a4f77;

  --color-text: #ffffff;        /* טקסט ראשי */
  --color-text-muted: #c3c6d4;  /* טקסט משני */
  --color-text-dim: #8b8fad;    /* טקסט עמום */

  --color-accent: #0073ea;      /* כחול Monday */
  --color-accent-hover: #0060c2;

  /* צבעי סטטוס */
  --color-status-green: #00c875;
  --color-status-orange: #fdab3d;
  --color-status-red: #e2445c;
  --color-status-purple: #a25ddc;
  --color-status-blue: #579bfc;
  --color-status-gray: #c4c4c4;

  --font-sans: system-ui, -apple-system, "Segoe UI", "Rubik", Arial, sans-serif;
}
```

Replace it with (status colors, `--color-sidebar`, and `--color-border-light` are untouched — only the tokens the constraints list change value, and two new tokens are added):

```css
@import "tailwindcss";

/* ===== BaseCRM — פלטת צבעים בסגנון "Refined workspace" (רדיזיין 1A) ===== */
@theme {
  --color-bg: #14172b;          /* רקע ראשי */
  --color-sidebar: #181b34;     /* סרגל צד */
  --color-surface: #1b1f38;     /* משטחים / כרטיסים */
  --color-surface-2: #262b48;   /* משטח משני / hover */
  --color-border: #2f3556;      /* גבולות */
  --color-border-light: #4a4f77;

  --color-text: #f3f4fa;        /* טקסט ראשי */
  --color-text-muted: #a7abc6;  /* טקסט משני */
  --color-text-dim: #72779a;    /* טקסט עמום */

  --color-accent: #4f5bd5;      /* accent מלוטש (היה #0073ea) */
  --color-accent-hover: #0060c2;
  --color-accent-soft: color-mix(in srgb, var(--color-accent) 15%, transparent);
  --color-accent-weak: color-mix(in srgb, var(--color-accent) 48%, var(--color-surface));

  /* צבעי סטטוס — ללא שינוי */
  --color-status-green: #00c875;
  --color-status-orange: #fdab3d;
  --color-status-red: #e2445c;
  --color-status-purple: #a25ddc;
  --color-status-blue: #579bfc;
  --color-status-gray: #c4c4c4;

  --font-sans: "Assistant", system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
}

/* מצב בהיר — נדרס רק כש-ThemeContext מגדיר data-theme="light" על <html>.
   ברירת המחדל (בלי ה-attribute) נשארת הפלטה הכהה למעלה. */
html[data-theme="light"] {
  --color-bg: #f5f6fb;
  --color-surface: #ffffff;
  --color-surface-2: #f1f3f9;
  --color-border: #e6e8f1;
  --color-text: #191c2e;
  --color-text-muted: #565c78;
  --color-text-dim: #8b90ab;
}
```

- [ ] **Step 2: Add the Assistant font link to `index.html`**

Replace the `<head>` block (currently lines 3-8):

```html
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>BaseCRM — ניהול משימות ולקוחות</title>
  </head>
```

with:

```html
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700;800&display=swap"
      rel="stylesheet"
    />
    <title>BaseCRM — ניהול משימות ולקוחות</title>
  </head>
```

- [ ] **Step 3: Lint and build**

```bash
cd "C:\Users\USER\Desktop\Caulde\BaseCrm"
npx oxlint src/index.css index.html
npm run build
```

Expected: oxlint prints nothing new (it doesn't lint CSS/HTML, so likely no output at all — that's fine). Build: `✓ built in <time>` with no errors (the pre-existing "chunks larger than 500kB" warning is expected and unrelated).

- [ ] **Step 4: Manual visual check (agent-runnable — no login required)**

This is the first feature in this project the agent CAN verify visually, because the color/font change is visible on the public `/login` page. Use the preview tools:

1. Start the dev server (`preview_start`, using this project's Vite dev config).
2. Navigate to `/login`.
3. Take a screenshot. Expected: the background is now a dark blue-purple (`#14172b`, not the old `#1c1f3b`) — the difference is subtle but real; more obviously, any element using `text-accent` or `bg-accent` (e.g. a link or the primary submit button) should now render the new purple-blue `#4f5bd5` instead of the old Monday blue `#0073ea`.
4. Use `preview_inspect` on the accent-colored element (e.g. the submit button) and confirm its computed `background-color` (or `color`) resolves to `rgb(79, 91, 213)` (`#4f5bd5`).
5. There is no light-mode toggle yet (Task 2 adds it) — do not expect `data-theme="light"` to do anything yet; that's fine for this task.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\USER\Desktop\Caulde\BaseCrm"
git add src/index.css index.html
git commit -m "feat: refresh color tokens and add Assistant font (redesign 1A)"
```

---

### Task 2: Theme context, Icon component, and Navbar toggle

**Files:**
- Create: `src/context/ThemeContext.jsx`
- Create: `src/components/ui/Icon.jsx`
- Modify: `src/main.jsx`
- Modify: `src/components/Navbar.jsx`

**Interfaces:**
- Consumes: the `html[data-theme="light"]` CSS override added in Task 1 (this task is the only place that ever sets `document.documentElement.dataset.theme`).
- Produces: `ThemeProvider` (React component, wraps children, no props) and `useTheme()` hook returning `{ theme: 'dark' | 'light', toggleTheme: () => void }`, both exported from `src/context/ThemeContext.jsx`. Produces `Icon` (default export from `src/components/ui/Icon.jsx`) with signature `<Icon name="sun" | "moon" size={number} />` (size optional, defaults to `18`).

- [ ] **Step 1: Create `src/context/ThemeContext.jsx`**

```jsx
import { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext(null)

const STORAGE_KEY = 'basecrm.theme'

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem(STORAGE_KEY) || 'dark')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
```

- [ ] **Step 2: Create `src/components/ui/Icon.jsx`**

```jsx
// רכיב אייקונים מינימלי — רק האייקונים שנחוצים בפועל (שמש/ירח לפקד ערכת הנושא).
// שלבים עתידיים יוסיפו אייקונים נוספים כאן ככל שיוחלפו אימוג'ים בעמודים אחרים.

const PATHS = {
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </>
  ),
  moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
}

export default function Icon({ name, size = 18 }) {
  const path = PATHS[name]
  if (!path) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  )
}
```

- [ ] **Step 3: Wrap the app in `ThemeProvider`**

In `src/main.jsx`, the current content is:

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
)
```

Replace it with (import added, `ThemeProvider` wraps `AuthProvider` so theming works before auth resolves — e.g. on `/login`):

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
)
```

- [ ] **Step 4: Add the toggle button to `Navbar.jsx`**

The current file (`src/components/Navbar.jsx`) is:

```jsx
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Avatar from './ui/Avatar'
import Button from './ui/Button'

export default function Navbar() {
  const { profile, user, isSuperAdmin, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <header
      className="flex h-14 items-center justify-between border-b border-border bg-sidebar px-4"
      data-testid="navbar"
    >
      <div className="flex items-center gap-6">
        <Link to="/" className="text-xl font-bold text-text" data-testid="navbar-home-link">
          Base<span className="text-accent">CRM</span>
        </Link>
        {isSuperAdmin && (
          <Link
            to="/admin"
            className="rounded-md px-2 py-1 text-sm text-status-purple hover:bg-surface-2"
            data-testid="navbar-admin-link"
          >
            ניהול ארגונים
          </Link>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2" data-testid="navbar-user">
          <Avatar name={profile?.full_name} email={user?.email} size={30} />
          <span className="hidden text-sm text-text-muted sm:inline">
            {profile?.full_name || user?.email}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={handleSignOut} data-testid="navbar-signout">
          יציאה
        </Button>
      </div>
    </header>
  )
}
```

Replace it in full with (adds the `useTheme`/`Icon` imports, and one toggle button between the user info and the sign-out button):

```jsx
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import Avatar from './ui/Avatar'
import Button from './ui/Button'
import Icon from './ui/Icon'

export default function Navbar() {
  const { profile, user, isSuperAdmin, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <header
      className="flex h-14 items-center justify-between border-b border-border bg-sidebar px-4"
      data-testid="navbar"
    >
      <div className="flex items-center gap-6">
        <Link to="/" className="text-xl font-bold text-text" data-testid="navbar-home-link">
          Base<span className="text-accent">CRM</span>
        </Link>
        {isSuperAdmin && (
          <Link
            to="/admin"
            className="rounded-md px-2 py-1 text-sm text-status-purple hover:bg-surface-2"
            data-testid="navbar-admin-link"
          >
            ניהול ארגונים
          </Link>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={toggleTheme}
          className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
          title={theme === 'dark' ? 'עבור למצב בהיר' : 'עבור למצב כהה'}
          data-testid="theme-toggle"
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
        </button>
        <div className="flex items-center gap-2" data-testid="navbar-user">
          <Avatar name={profile?.full_name} email={user?.email} size={30} />
          <span className="hidden text-sm text-text-muted sm:inline">
            {profile?.full_name || user?.email}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={handleSignOut} data-testid="navbar-signout">
          יציאה
        </Button>
      </div>
    </header>
  )
}
```

Note: `Navbar.jsx` is only rendered inside `Layout.jsx` for authenticated routes (per `App.jsx`'s route tree) — it is not present on `/login`. That's fine; Task 1's token/font change is what's checkable pre-login, and this task's toggle is checkable once logged in (or, since `ThemeProvider` wraps everything including public routes, you can also verify the *mechanism* works by calling `localStorage.setItem('basecrm.theme','light')` and reloading, without needing the button itself to be on-screen yet).

- [ ] **Step 5: Lint and build**

```bash
cd "C:\Users\USER\Desktop\Caulde\BaseCrm"
npx oxlint src/context/ThemeContext.jsx src/components/ui/Icon.jsx src/main.jsx src/components/Navbar.jsx
npm run build
```

Expected: no oxlint output (clean). Build: `✓ built in <time>`, no errors.

- [ ] **Step 6: Manual visual check (agent-runnable)**

1. Reload the app in the preview browser (any page — `ThemeProvider` wraps the whole tree).
2. Run in `preview_eval`: `localStorage.getItem('basecrm.theme')` — expect `null` or `"dark"` (default), and `document.documentElement.dataset.theme` — expect `"dark"` or `undefined` before any toggle.
3. If logged in (or once a super-admin session is available), find the toggle button via `preview_snapshot` (`data-testid="theme-toggle"`) and `preview_click` it.
4. After the click, re-check: `document.documentElement.dataset.theme` should now be `"light"`, `localStorage.getItem('basecrm.theme')` should be `"light"`, and a `preview_screenshot` should show light backgrounds (`#f5f6fb`/`#ffffff`) instead of dark.
5. Reload the page — the light theme should persist (read back from `localStorage`).
6. Click the toggle again — confirm it flips back to dark and the icon swaps from moon back to sun.
7. If no authenticated session is reachable in this environment, at minimum verify the mechanism via `preview_eval` by setting `localStorage.setItem('basecrm.theme','light')` then reloading and confirming the page renders light — and note in the report that the on-screen button itself (which requires auth to reach `Layout`/`Navbar`) is deferred to the human to click through once, alongside noting exactly what was and wasn't checked.

- [ ] **Step 7: Commit**

```bash
cd "C:\Users\USER\Desktop\Caulde\BaseCrm"
git add src/context/ThemeContext.jsx src/components/ui/Icon.jsx src/main.jsx src/components/Navbar.jsx
git commit -m "feat: add dark/light theme toggle and minimal Icon component"
```
