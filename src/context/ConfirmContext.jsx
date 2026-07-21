import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import Modal from '../components/ui/Modal'
import Button from '../components/ui/Button'

const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null) // { title, message, confirmText, cancelText, danger }
  const resolveRef = useRef(null)
  // מיקוד ראשוני על "ביטול" באישור מסוכן — כדי שברירת המחדל לא תהיה הפעולה ההרסנית
  const cancelRef = useRef(null)

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

  useEffect(() => {
    return () => {
      resolveRef.current?.(false)
      resolveRef.current = null
    }
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
        initialFocusRef={state?.danger ? cancelRef : undefined}
        footer={
          <>
            <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)} data-testid="confirm-ok">
              {state?.confirmText}
            </Button>
            <Button ref={cancelRef} variant="ghost" onClick={() => close(false)}>{state?.cancelText}</Button>
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
