import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// בורר שנפתח דרך portal עם מיקום fixed — לא נחתך ע"י מיכלי overflow של הטבלה
export default function Popover({ children, panel, panelWidth = 180, label }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const triggerRef = useRef(null)

  // סגירה שמחזירה את המיקוד לכפתור המפעיל (mirror של prevFocusRef ב-Modal)
  function closePopover() {
    setOpen(false)
    triggerRef.current?.focus?.()
  }

  function toggle() {
    if (open) {
      closePopover()
      return
    }
    const r = triggerRef.current.getBoundingClientRect()
    const openUp = r.bottom + 260 > window.innerHeight && r.top > 260
    setPos({
      right: window.innerWidth - r.right,
      top: openUp ? undefined : r.bottom + 4,
      bottom: openUp ? window.innerHeight - r.top + 4 : undefined,
    })
    setOpen(true)
  }

  // מקש Escape סוגר ומחזיר מיקוד לכפתור המפעיל
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closePopover()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className="h-full w-full cursor-pointer"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={closePopover} />
            <div
              className="fixed z-50 max-h-72 overflow-auto rounded-md border border-border bg-surface p-2 shadow-xl"
              style={{ right: pos.right, top: pos.top, bottom: pos.bottom, minWidth: panelWidth }}
            >
              {panel(closePopover)}
            </div>
          </>,
          document.body
        )}
    </>
  )
}
