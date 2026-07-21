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

// אתחול Sentry נדחה אחרי הרינדור הראשון כדי לא לחסום את המסלול המהיר (happy
// path) עם טעינת חבילת הניטור. ErrorBoundary מייבא את Sentry באופן סטטי בעצמו,
// אז דיווח שגיאות-רינדור ממשיך לעבוד גם לפני שהאתחול הזה רץ.
const dsn = import.meta.env.VITE_SENTRY_DSN
if (dsn) {
  const initSentry = () =>
    import('@sentry/react')
      .then((Sentry) => {
        Sentry.init({
          dsn,
          environment: import.meta.env.MODE,
          tracesSampleRate: 0,
        })
      })
      .catch(() => {
        // כשל בטעינת/אתחול Sentry לא אמור להפיל את האפליקציה — בולעים בשקט.
      })
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(initSentry)
  } else {
    setTimeout(initSentry, 0)
  }
}
