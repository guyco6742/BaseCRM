import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import SetupNotice from '../components/SetupNotice'
import { handleEnterAsTab } from '../lib/formNav'
import { useTitle } from '../lib/useTitle'

export default function ForgotPasswordPage() {
  useTitle('שחזור סיסמה')
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
              work-<span className="text-accent">it</span>
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

            <Button type="submit" className="w-full" loading={loading} data-testid="forgot-password-submit">
              שליחת קישור לאיפוס
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
