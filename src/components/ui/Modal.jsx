import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function Modal({ open, onClose, title, children, footer, size = 'md', testid, initialFocusRef }) {
  const panelRef = useRef(null)
  const prevFocusRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    prevFocusRef.current = document.activeElement

    // מיקוד ראשוני: אלמנט מפורש (initialFocusRef) אם ניתן, אחרת שדה הקלט
    // הראשון, ואם אין — הפאנל עצמו
    const panel = panelRef.current
    if (initialFocusRef?.current) {
      initialFocusRef.current.focus()
    } else {
      const focusables = panel ? [...panel.querySelectorAll(FOCUSABLE)] : []
      const firstInput = focusables.find((el) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName))
      ;(firstInput || focusables[0] || panel)?.focus()
    }

    const onKey = (e) => {
      if (e.key === 'Escape') {
        onCloseRef.current?.()
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
  }, [open, initialFocusRef])

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
        className={`flex max-h-[90vh] w-full ${maxW} flex-col rounded-lg border border-border bg-surface shadow-xl`}
        onClick={(e) => e.stopPropagation()}
        data-testid={testid}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
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
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex shrink-0 justify-start gap-2 border-t border-border px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
