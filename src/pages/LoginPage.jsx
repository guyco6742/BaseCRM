import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import SetupNotice from '../components/SetupNotice'
import { handleEnterAsTab } from '../lib/formNav'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState(location.state?.inviteEmail || '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message] = useState(
    location.state?.resetSuccess ? 'הסיסמה עודכנה בהצלחה. התחברו עם הסיסמה החדשה.' : ''
  )
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      navigate(location.state?.from || '/', { replace: true })
    } catch {
      setError('אימייל או סיסמה שגויים. נסו שוב.')
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
              Base<span className="text-accent">CRM</span>
            </h1>
            <p className="mt-2 text-text-muted">ניהול משימות ולקוחות</p>
          </div>

          <form
            onSubmit={handleSubmit}
            onKeyDown={handleEnterAsTab}
            className="space-y-4 rounded-lg border border-border bg-surface p-6"
            data-testid="login-form"
          >
            <h2 className="text-xl font-semibold text-text">כניסה למערכת</h2>

            <Input
              label="אימייל"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoComplete="email"
              data-testid="login-email"
            />
            <div>
              <Input
                label="סיסמה"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                data-testid="login-password"
              />
              <Link
                to="/forgot-password"
                className="mt-1 inline-block text-sm text-accent hover:underline"
                data-testid="login-forgot-password-link"
              >
                שכחתי סיסמה?
              </Link>
            </div>

            {message && <p className="text-sm text-status-green" data-testid="login-reset-message">{message}</p>}
            {error && <p className="text-sm text-status-red" data-testid="login-error">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading} data-testid="login-submit">
              {loading ? 'מתחבר...' : 'כניסה'}
            </Button>

            <p className="text-center text-sm text-text-muted">
              אין לך חשבון?{' '}
              <Link to="/signup" className="text-accent hover:underline" data-testid="login-signup-link">
                הרשמה
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
