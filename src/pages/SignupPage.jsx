import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import SetupNotice from '../components/SetupNotice'
import { handleEnterAsTab } from '../lib/formNav'

export default function SignupPage() {
  const navigate = useNavigate()
  const location = useLocation()
  // כשמגיעים מתוך הזמנה — האימייל ננעל לכתובת שהוזמנה
  const invitedEmail = location.state?.inviteEmail || ''
  const redirectTo = location.state?.from || '/'

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState(invitedEmail)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    if (password.length < 6) {
      setError('הסיסמה חייבת להכיל לפחות 6 תווים.')
      return
    }
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      })
      if (error) throw error
      // אם Confirm Email כבוי — נכנסים ישר; אחרת מציגים הודעה
      if (data.session) {
        navigate(redirectTo, { replace: true })
      } else {
        setMessage('נרשמת בהצלחה! בדקו את תיבת המייל לאישור, ואז התחברו.')
      }
    } catch (err) {
      if (String(err.message).includes('already registered')) {
        setError('כתובת המייל כבר רשומה. נסו להתחבר.')
      } else {
        setError('ההרשמה נכשלה. נסו שוב.')
      }
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
            data-testid="signup-form"
          >
            <h2 className="text-xl font-semibold text-text">יצירת חשבון</h2>

            <Input
              label="שם מלא"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="ישראל ישראלי"
              required
              data-testid="signup-fullname"
            />
            <Input
              label={invitedEmail ? 'אימייל (מתוך ההזמנה)' : 'אימייל'}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoComplete="email"
              readOnly={Boolean(invitedEmail)}
              className={invitedEmail ? 'cursor-not-allowed opacity-70' : ''}
              data-testid="signup-email"
            />
            <Input
              label="סיסמה"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="לפחות 6 תווים"
              required
              autoComplete="new-password"
              data-testid="signup-password"
            />

            {error && <p className="text-sm text-status-red" data-testid="signup-error">{error}</p>}
            {message && <p className="text-sm text-status-green" data-testid="signup-message">{message}</p>}

            <Button type="submit" className="w-full" disabled={loading} data-testid="signup-submit">
              {loading ? 'נרשם...' : 'הרשמה'}
            </Button>

            <p className="text-center text-sm text-text-muted">
              כבר יש לך חשבון?{' '}
              <Link to="/login" className="text-accent hover:underline" data-testid="signup-login-link">
                כניסה
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
