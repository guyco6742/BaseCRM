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
