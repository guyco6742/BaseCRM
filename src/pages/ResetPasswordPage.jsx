import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import SetupNotice from '../components/SetupNotice'
import { handleEnterAsTab } from '../lib/formNav'
import { useTitle } from '../lib/useTitle'

export default function ResetPasswordPage() {
  useTitle('איפוס סיסמה')
  const navigate = useNavigate()
  const [checkingSession, setCheckingSession] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let active = true
    // כשלוחצים על הקישור מהמייל, ה-client של supabase קורא את ה-URL
    // ומקים session זמני מסוג recovery באופן אוטומטי
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setHasSession(Boolean(data.session))
      setCheckingSession(false)
    })
    return () => {
      active = false
    }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password.length < 6) {
      setError('הסיסמה חייבת להכיל לפחות 6 תווים.')
      return
    }
    if (password !== confirmPassword) {
      setError('הסיסמאות אינן תואמות.')
      return
    }
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      // מתנתקים כדי לא להשאיר session פעיל על עמוד ההתחברות
      await supabase.auth.signOut()
      navigate('/login', { state: { resetSuccess: true }, replace: true })
    } catch {
      setError('משהו השתבש. נסו שוב.')
    } finally {
      setLoading(false)
    }
  }

  let content
  if (checkingSession) {
    content = <p className="text-sm text-text-muted" data-testid="reset-password-loading">בודקים את הקישור...</p>
  } else if (!hasSession) {
    content = (
      <div data-testid="reset-password-expired">
        <p className="text-sm text-status-red">הקישור פג תוקף או שגוי. בקשו קישור חדש.</p>
        <Link to="/forgot-password" className="mt-2 inline-block text-sm text-accent hover:underline">
          בקשת קישור חדש
        </Link>
      </div>
    )
  } else {
    content = (
      <form
        onSubmit={handleSubmit}
        onKeyDown={handleEnterAsTab}
        className="space-y-4"
        data-testid="reset-password-form"
      >
        <Input
          label="סיסמה חדשה"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="לפחות 6 תווים"
          required
          autoComplete="new-password"
          data-testid="reset-password-password"
        />
        <Input
          label="אימות סיסמה"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="הזינו שוב את הסיסמה"
          required
          autoComplete="new-password"
          data-testid="reset-password-confirm"
        />

        {error && <p className="text-sm text-status-red" data-testid="reset-password-error">{error}</p>}

        <Button type="submit" className="w-full" loading={loading} data-testid="reset-password-submit">
          עדכון סיסמה
        </Button>
      </form>
    )
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

          <div className="space-y-4 rounded-lg border border-border bg-surface p-6">
            <h2 className="text-xl font-semibold text-text">איפוס סיסמה</h2>
            {content}
          </div>
        </div>
      </div>
    </div>
  )
}
