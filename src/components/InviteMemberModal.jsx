import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import Modal from './ui/Modal'
import Button from './ui/Button'
import Input from './ui/Input'
import { handleEnterAsTab } from '../lib/formNav'

// מנסה לחלץ את גוף השגיאה שהוחזר מפונקציית ה-edge (FunctionsHttpError.context
// הוא Response גולמי) — כדי להבחין בין already_invited לשגיאה כללית.
async function parseInvokeError(err) {
  try {
    const ctx = err?.context
    if (ctx && typeof ctx.json === 'function') return await ctx.json()
  } catch {
    // גוף לא ניתן לפענוח — נופלים למסר גנרי
  }
  return null
}

// מודל להזמנת משתמש לארגון. שולח בקשה ל-send-invite (edge function) שיוצרת
// את שורת ה-invitation בצד שרת ומנסה לשלוח מייל הזמנה דרך Resend.
export default function InviteMemberModal({ open, onClose, orgId, defaultRole = 'member', onInvited }) {
  const { toast } = useToast()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState(defaultRole)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [copied, setCopied] = useState(false)

  function reset() {
    setEmail('')
    setRole(defaultRole)
    setError('')
    setInviteLink('')
    setCopied(false)
  }

  async function handleInvite(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('send-invite', {
        body: { action: 'create', orgId, email: email.trim().toLowerCase(), role },
      })
      if (invokeError) {
        const body = await parseInvokeError(invokeError)
        setError(
          body?.error === 'already_invited'
            ? 'כבר קיימת הזמנה ממתינה לכתובת הזו'
            : 'יצירת ההזמנה נכשלה. נסו שוב.'
        )
        return
      }
      setInviteLink(data.inviteUrl)
      if (data.emailSent) {
        toast('ההזמנה נשלחה במייל')
      } else {
        toast('המייל לא נשלח — העתיקו את הקישור ידנית', 'error')
      }
      onInvited?.()
    } catch {
      setError('יצירת ההזמנה נכשלה. נסו שוב.')
    } finally {
      setLoading(false)
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleClose() {
    reset()
    onClose?.()
  }

  return (
    <Modal open={open} onClose={handleClose} title="הזמנת משתמש" testid="invite-member-modal">
      {inviteLink ? (
        <div className="space-y-4">
          <p className="text-sm text-status-green">ההזמנה נוצרה! שתפו את הקישור עם המשתמש:</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={inviteLink}
              className="flex-1 rounded-md border border-border bg-bg px-3 py-2 text-sm text-text-muted"
              onFocus={(e) => e.target.select()}
              data-testid="invite-link"
            />
            <Button onClick={copyLink} variant="secondary" data-testid="invite-copy-link">
              {copied ? 'הועתק!' : 'העתק'}
            </Button>
          </div>
          <div className="flex justify-start gap-2 pt-2">
            <Button variant="secondary" onClick={reset}>
              הזמנה נוספת
            </Button>
            <Button onClick={handleClose}>סיום</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleInvite} onKeyDown={handleEnterAsTab} className="space-y-4">
          <Input
            label="אימייל המוזמן"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@company.com"
            required
            autoFocus
            data-testid="invite-email-input"
          />
          <label className="block">
            <span className="mb-1 block text-sm text-text-muted">תפקיד</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text outline-none focus:border-accent"
              data-testid="invite-role-select"
            >
              <option value="member">עובד/ת</option>
              <option value="admin">מנהל/ת</option>
            </select>
          </label>

          {error && <p className="text-sm text-status-red">{error}</p>}

          <div className="flex justify-start gap-2 pt-2">
            <Button type="submit" loading={loading} data-testid="invite-submit">
              צור הזמנה
            </Button>
            <Button type="button" variant="ghost" onClick={handleClose}>
              ביטול
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
