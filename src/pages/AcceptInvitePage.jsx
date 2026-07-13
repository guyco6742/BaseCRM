import { useEffect, useRef, useState } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Button from '../components/ui/Button'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import SetupNotice from '../components/SetupNotice'
import { useTitle } from '../lib/useTitle'

// דף קבלת הזמנה: /accept-invite?token=...
export default function AcceptInvitePage() {
  useTitle('הצטרפות לארגון')
  const [params] = useSearchParams()
  const token = params.get('token')
  const { user, profile, loading: authLoading, refreshProfile } = useAuth()
  const navigate = useNavigate()

  const [state, setState] = useState('loading') // loading | invalid | mismatch | ready | joining | done | error
  const [invite, setInvite] = useState(null)
  const [orgName, setOrgName] = useState('')
  const joinedRef = useRef(false)

  useEffect(() => {
    if (authLoading) return
    let active = true

    async function check() {
      if (!token) {
        setState('invalid')
        return
      }
      // קריאה דרך RPC מאובטח — מאפשר למוזמן לא-מחובר לקרוא את ההזמנה לפי הטוקן בלבד
      const { data, error } = await supabase.rpc('get_invitation_by_token', { p_token: token })
      const inv = Array.isArray(data) ? data[0] : data

      if (!active) return
      if (error || !inv) {
        setState('invalid')
        return
      }
      setInvite(inv)
      setOrgName(inv.org_name || '')

      if (inv.status === 'accepted') {
        setState('done')
        return
      }
      // המשתמש חייב להתחבר עם אותו אימייל של ההזמנה
      if (profile && profile.email?.toLowerCase() !== inv.email.toLowerCase()) {
        setState('mismatch')
        return
      }
      setState('ready')
    }
    check()
    return () => {
      active = false
    }
  }, [token, authLoading, profile])

  async function handleJoin() {
    setState('joining')
    try {
      // יצירת חברות (RLS מתיר למוזמן ליצור לעצמו חברות תואמת)
      const { error: mErr } = await supabase.from('memberships').insert({
        org_id: invite.org_id,
        user_id: user.id,
        role: invite.role,
      })
      if (mErr && mErr.code !== '23505') throw mErr // 23505 = כבר חבר

      await supabase.from('invitations').update({ status: 'accepted' }).eq('id', invite.id)
      await refreshProfile()
      setState('done')
      setTimeout(() => navigate(`/org/${invite.org_id}`, { replace: true }), 1200)
    } catch {
      setState('error')
    }
  }

  // הצטרפות אוטומטית ברגע שהמשתמש מחובר עם האימייל הנכון וההזמנה תקפה
  useEffect(() => {
    if (state === 'ready' && user && invite && !joinedRef.current) {
      joinedRef.current = true
      handleJoin()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, user, invite])

  if (authLoading || state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner label="בודק הזמנה..." />
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <SetupNotice />
      <div className="flex min-h-[calc(100vh-40px)] items-center justify-center p-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 text-center">
          <h1 className="mb-4 text-2xl font-bold text-text">
            work-<span className="text-accent">it</span>
          </h1>

          {state === 'invalid' && (
            <>
              <p className="mb-4 text-status-red">ההזמנה אינה תקפה או שפג תוקפה.</p>
              <Link to="/">
                <Button variant="secondary">לדף הבית</Button>
              </Link>
            </>
          )}

          {state === 'done' && (
            <p className="text-status-green">הצטרפת לארגון {orgName}! מעביר אותך...</p>
          )}

          {state === 'mismatch' && (
            <>
              <p className="mb-2 text-text">
                ההזמנה מיועדת לכתובת <b className="text-accent">{invite.email}</b>.
              </p>
              <p className="mb-4 text-sm text-text-muted">
                כרגע אתה מחובר כ-<b>{profile?.email}</b>. כדי להצטרף יש להתחבר עם הכתובת שהוזמנה.
              </p>
              <div className="flex flex-col gap-2">
                <Button
                  onClick={async () => {
                    await supabase.auth.signOut()
                    navigate(`/signup`, {
                      state: { from: `/accept-invite?token=${token}`, inviteEmail: invite.email },
                    })
                  }}
                >
                  התנתק והירשם ככתובת המוזמנת
                </Button>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    await supabase.auth.signOut()
                    navigate(`/login`, {
                      state: { from: `/accept-invite?token=${token}`, inviteEmail: invite.email },
                    })
                  }}
                >
                  כבר יש לי חשבון בכתובת הזו — כניסה
                </Button>
              </div>
            </>
          )}

          {state === 'ready' && !user && (
            <>
              <p className="mb-4 text-text">
                הוזמנת להצטרף לארגון <b className="text-accent">{orgName}</b>.
                <br />
                התחבר או הירשם עם הכתובת {invite.email} כדי להצטרף.
              </p>
              <div className="flex justify-center gap-2">
                <Link
                  to="/login"
                  state={{ from: `/accept-invite?token=${token}`, inviteEmail: invite.email }}
                  data-testid="invite-login-link"
                >
                  <Button>כניסה</Button>
                </Link>
                <Link
                  to="/signup"
                  state={{ from: `/accept-invite?token=${token}`, inviteEmail: invite.email }}
                  data-testid="invite-signup-link"
                >
                  <Button variant="secondary">הרשמה</Button>
                </Link>
              </div>
            </>
          )}

          {state === 'ready' && user && (
            <>
              <p className="mb-4 text-text">
                הוזמנת להצטרף לארגון <b className="text-accent">{orgName}</b> בתפקיד{' '}
                {invite.role === 'admin' ? 'מנהל/ת' : 'עובד/ת'}.
              </p>
              <Button onClick={handleJoin} data-testid="invite-join-btn">הצטרפות לארגון</Button>
            </>
          )}

          {state === 'joining' && <LoadingSpinner label="מצטרף..." />}

          {state === 'error' && (
            <p className="text-status-red">ההצטרפות נכשלה. נסו שוב מאוחר יותר.</p>
          )}
        </div>
      </div>
    </div>
  )
}
