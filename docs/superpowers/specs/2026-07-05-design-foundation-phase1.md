# עיצוב: Phase 1 — יסודות עיצוב (tokens, פונט, החלפת ערכת נושא, רכיב אייקונים)

## רקע
המשתמש שיתף מוקאפ עיצוב מחדש ל-BaseCRM (זיפ עם `.dc.html` + screenshots) עם שני כיוונים: **1A "Refined workspace"** (מבנה זהה להיום — סרגל עליון + סרגל צד — רק מלוטש) ו-**1B "Focus rail"** (סרגל אייקונים + פאנל תצוגות, שינוי מבנה ניווט). הוחלט:
- כיוון **1A** — סיכון נמוך, אותה ארכיטקטורת ניווט, ניתן ליישום כ"מעבר טוקנים" על גבי הקוד הקיים.
- לפרק את הרדיזיין לשלבים ולפרט ספק מלא רק ל**שלב 1** (יסודות: טוקנים, פונט, ערכת נושא בהירה/כהה, רכיב אייקונים). שלבים הבאים (Auth/org-picker, sidebar/navbar מלאים, עמודים בודדים) ייבנו בנפרד בהמשך.

בדיקת [src/index.css](../../../src/index.css) גילתה שהאפליקציה כבר משתמשת במערכת טוקנים של Tailwind v4 (`@theme` עם `--color-*`) — כלומר שלב 1 הוא בעיקרו **החלפת ערכים** לטוקנים קיימים, לא ארגון מחדש.

## טוקני צבע
מקור: `BaseCRM Redesign.dc.html` (בלוק `themes()` בקוד ה-JS המוטבע), כיוון 1A.

**משמרים את כל שמות הטוקנים הקיימים** (כדי שאף מחלקת Tailwind בקוד הקיים לא תשתנה) — רק הערכים מתעדכנים:

| טוקן קיים | ערך dark חדש | ערך light חדש (מצב אופציונלי) |
|---|---|---|
| `--color-bg` | `#14172b` | `#f5f6fb` |
| `--color-surface` | `#1b1f38` | `#ffffff` |
| `--color-surface-2` | `#262b48` | `#f1f3f9` |
| `--color-border` | `#2f3556` | `#e6e8f1` |
| `--color-text` | `#f3f4fa` | `#191c2e` |
| `--color-text-muted` | `#a7abc6` | `#565c78` |
| `--color-text-dim` | `#72779a` | `#8b90ab` |
| `--color-accent` | `#4f5bd5` (חדש, סגול-כחול) | `#4f5bd5` (זהה בשני המצבים) |

**טוקנים חדשים** (לא קיימים היום, נחוצים ל-active-state של ניווט עם הרקע הרך):
- `--color-accent-soft`: `color-mix(in srgb, var(--color-accent) 15%, transparent)`
- `--color-accent-weak`: `color-mix(in srgb, var(--color-accent) 48%, var(--color-surface))`

`--color-border-light` (קיים) נשאר ללא שינוי ערך.

**מנגנון מעבר ערכת נושא** — Tailwind v4 מייצר עבור כל טוקן ב-`@theme` משתנה CSS אמיתי תחת `:root`, ומחלקות ה-utility (למשל `.bg-bg`) מפנות ל-`var(--color-bg)` ולא לערך קבוע. לכן ניתן לשנות את הערך בזמן ריצה בלי לגעת בשום קומפוננטה: בלוק CSS רגיל (מחוץ ל-`@theme`) `html[data-theme="light"] { --color-bg: #f5f6fb; ... }` דורס את הערכים כשה-attribute מוגדר. ברירת המחדל (ללא attribute) נשארת dark — משתמשים קיימים לא רואים שינוי עד שיבחרו.

**לא בתחום שלב זה:** צבעי סטטוס/תגיות (`client_statuses.color` בכל ארגון, `LABEL_COLORS` ב-`columnTypes.js`) — אלה חיים בדאטה קיימת ובקובץ נפרד, ושינוים הוא החלטת דאטה נפרדת, לא טוקן עיצוב.

## פונט
הוספת Google Fonts "Assistant" (משקלים 400/500/600/700/800) — `<link rel="preconnect">` + `<link href="...family=Assistant...">` ב-`index.html`, ועדכון `--font-sans` ב-`index.css` כך ש-`'Assistant'` יהיה הראשון ברשימת ה-fallback (לפני `system-ui`). פונט Hebrew-native, תואם RTL, ללא סיכון פונקציונלי.

## תשתית ערכת נושא (Theme Context)
קובץ חדש `src/context/ThemeContext.jsx`, באותה צורה כמו `AuthContext.jsx` הקיים:
- `ThemeProvider` — מחזיק state `theme` (`'dark'` | `'light'`), טוען ערך התחלתי מ-`localStorage['basecrm.theme']` (ברירת מחדל `'dark'` אם אין ערך שמור — תואם למוסכמת מפתחות `basecrm.*` הקיימת באפליקציה, למשל `basecrm.clientsView`, `basecrm.sidebarWidth`).
- `useEffect` שמעדכן `document.documentElement.dataset.theme = theme` בכל שינוי, ושומר ל-`localStorage`.
- הוק `useTheme()` שמחזיר `{ theme, toggleTheme, setTheme }`.
- עטיפה ב-`main.jsx` **מחוץ** ל-`AuthProvider` (כדי שהעיצוב יעבוד גם במסך ההתחברות, לפני אימות).

## פקד ההחלפה (UI)
ב-`Navbar.jsx`, לצד תפריט המשתמש (לפני כפתור "יציאה"): כפתור טוגל קטן עם אייקון שמש/ירח (תואם למוקאפ), שקורא ל-`toggleTheme()`. משתמש ב-`useTheme()`.

## רכיב אייקונים
קובץ חדש `src/components/ui/Icon.jsx` — **מכוון בכוונה להיות מינימלי בשלב זה**: רק שני האייקונים הדרושים לפקד ההחלפה עצמו (שמש, ירח), בסגנון ה-SVG של המוקאפ (`viewBox 0 0 24 24`, `stroke-width 1.9`, `stroke-linecap/linejoin round`, ללא מילוי). API: `<Icon name="sun" size={17} />`. שלבים עתידיים (שלא בתחום הספק הזה) יוסיפו אייקונים נוספים ל-`Icon.jsx` בהדרגה, ככל שיחליפו אימוג'ים בעמודים שונים — לא בונים ספרייה גדולה בלי שימוש בפועל.

## מה לא משתנה בשלב זה
- שום קובץ עמוד/קומפוננטה קיים לא עובר שינוי עיצובי (מלבד `Navbar.jsx` שמקבל את פקד ההחלפה).
- אימוג'ים קיימים בכל האפליקציה (⚙ ⬆ ▦ ☰ וכו') נשארים כפי שהם.
- צבעי סטטוס/תגיות (ראה לעיל).
- מסכי Auth/org-picker, Sidebar, board/kanban — שלבים נפרדים בעתיד.

## בדיקות
- `npm run build` + `npx oxlint` על הקבצים שהשתנו.
- בדיקה חזותית בדפדפן (preview tools) — ניתנת לביצוע גם ללא התחברות (מסך הלוגין עצמו כבר מציג את הטוקנים/פונט/כפתור ההחלפה), כך שהיא **כן זמינה לסוכן** בשלב זה, בניגוד לפיצ'רים קודמים שדרשו התחברות.
