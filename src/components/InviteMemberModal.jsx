import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Modal from './ui/Modal'
import Button from './ui/Button'
import Input from './ui/Input'
import { handleEnterAsTab } from '../lib/formNav'

// מודל להזמנת משתמש לארגון. יוצר שורת invitation ומחזיר קישור הצטרפות.
export default function InviteMemberModal({ open, onClose, orgId, defaultRole = 'member', onInvited }) {
  const { user } = useAuth()
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
      const { data, error } = await supabase
        .from('invitations')
        .insert({
          org_id: orgId,
          email: email.trim().toLowerCase(),
          role,
          invited_by: user.id,
        })
        .select('token')
        .single()
      if (error) throw error
      const link = `${window.location.origin}/accept-invite?token=${data.token}`
      setInviteLink(link)
      onInvited?.()
    } catch {
      setError('יצירת ההזמנה נכשלה. ייתכן שהמשתמש כבר הוזמן.')
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
