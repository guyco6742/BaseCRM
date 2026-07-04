// Enter למעבר לשדה הבא — כדי שאפשר למלא טופס שלם בלי עכבר.
// שימוש: <form onKeyDown={handleEnterAsTab} ...> — בשדה האחרון Enter שולח את הטופס.
// עובד גם על מיכל שאינו <form> (למשל בכרטיס לקוח, ששדותיו נשמרים בנפרד
// בעזיבת כל שדה) — במקרה הזה Enter בשדה האחרון פשוט לא עושה כלום.
// ב-textarea, Enter נשאר שורה חדשה כרגיל.

const FOCUSABLE_SELECTOR =
  'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)'

export function handleEnterAsTab(e) {
  if (e.key !== 'Enter' || e.shiftKey) return

  const target = e.target
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'BUTTON') return // שורה חדשה / התנהגות כפתור רגילה

  const container = e.currentTarget
  const focusables = [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
    (el) => el.offsetParent !== null // רק שדות גלויים בפועל
  )
  const idx = focusables.indexOf(target)
  if (idx === -1) return

  e.preventDefault()

  const next = focusables[idx + 1]
  if (next) {
    next.focus()
    if (tagAcceptsSelect(next)) next.select()
  } else if (container.tagName === 'FORM') {
    container.requestSubmit()
  }
}

function tagAcceptsSelect(el) {
  return el.tagName === 'INPUT' && typeof el.select === 'function'
}
