import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { useAuth } from '../context/AuthContext'
import { useConfirm } from '../context/ConfirmContext'
import { useToast } from '../context/ToastContext'
import { useTitle } from '../lib/useTitle'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Button from '../components/ui/Button'
import Avatar from '../components/ui/Avatar'
import InviteMemberModal from '../components/InviteMemberModal'
import OrgLogoUpload from '../components/OrgLogoUpload'
import ClientStatusManager from '../components/ClientStatusManager'
import LeadSourcesManager from '../components/crm/LeadSourcesManager'
import PaymentProviderManager from '../components/crm/PaymentProviderManager'

export default function OrgSettingsPage() {
  const { orgId, org, isAdmin, loading: orgLoading, refreshOrg, refreshMembers } = useOrg()
  const { user, isSuperAdmin } = useAuth()
  const confirm = useConfirm()
  const { toast } = useToast()
  useTitle('הגדרות ארגון')
  const [members, setMembers] = useState([])
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [mRes, iRes] = await Promise.all([
        supabase
          .from('memberships')
          .select('id, role, user_id, profiles(full_name, email, is_super_admin)')
          .eq('org_id', orgId),
        supabase
          .from('invitations')
          .select('*')
          .eq('org_id', orgId)
          .eq('status', 'pending'),
      ])
      if (mRes.error) throw mRes.error
      // סופר-אדמין (ספק המערכת) שקוף לארגונים — לא מוצג ברשימת המשתמשים
      setMembers((mRes.data || []).filter((m) => !m.profiles?.is_super_admin))
      setInvites(iRes.data || [])
    } catch {
      setError('טעינת המשתמשים נכשלה.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  if (orgLoading) return <LoadingSpinner label="טוען..." />
  if (!isAdmin) return <Navigate to={`/org/${orgId}`} replace />

  async function changeRole(member, role) {
    try {
      const { error } = await supabase.from('memberships').update({ role }).eq('id', member.id)
      if (error) throw error
      await load()
      refreshMembers()
      toast('התפקיד עודכן בהצלחה')
    } catch {
      setError('עדכון התפקיד נכשל.')
      toast('עדכון התפקיד נכשל', 'error')
    }
  }

  async function deleteUser(member) {
    const label = member.profiles?.full_name || member.profiles?.email
    const ok = await confirm({
      title: 'מחיקת משתמש',
      message: `למחוק את ${label}? אם זה הארגון היחיד של המשתמש — החשבון יימחק לצמיתות. אחרת המשתמש יוסר מהארגון הזה בלבד.`,
      confirmText: 'מחיקה',
      danger: true,
    })
    if (!ok) return
    try {
      const { data, error } = await supabase.rpc('delete_user', {
        p_user_id: member.user_id,
        p_org_id: orgId,
      })
      if (error) throw error
      // data === 'account_deleted' | 'removed_from_org'
      await load()
      refreshMembers()
      toast(data === 'account_deleted' ? 'החשבון נמחק בהצלחה' : 'המשתמש הוסר מהארגון בהצלחה')
    } catch (e) {
      const messages = {
        'only super admin can delete an admin': 'רק סופר-אדמין יכול למחוק מנהל/ת.',
        'cannot delete yourself': 'לא ניתן למחוק את החשבון שלך.',
        'cannot delete a super admin': 'לא ניתן למחוק סופר-אדמין.',
        'user is not a member of this org': 'המשתמש כבר אינו חבר בארגון זה.',
      }
      const msg = messages[e.message] || 'מחיקת המשתמש נכשלה.'
      setError(msg)
      toast(msg, 'error')
    }
  }

  async function cancelInvite(inv) {
    try {
      const { error } = await supabase.from('invitations').delete().eq('id', inv.id)
      if (error) throw error
      await load()
      toast('ההזמנה בוטלה בהצלחה')
    } catch {
      setError('ביטול ההזמנה נכשל.')
      toast('ביטול ההזמנה נכשל', 'error')
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="text-sm text-text-dim">{org?.name}</div>
          <h1 className="text-2xl font-bold text-text">הגדרות ומשתמשים</h1>
        </div>
        <Button onClick={() => setInviteOpen(true)} data-testid="settings-invite-btn">
          + הזמנת משתמש
        </Button>
      </div>

      {error && <p className="mb-4 text-status-red">{error}</p>}

      {loading ? (
        <LoadingSpinner label="טוען..." />
      ) : (
        <>
          <section className="mb-8">
            <h2 className="mb-3 text-lg font-semibold text-text">לוגו הארגון</h2>
            <div className="rounded-lg border border-border bg-surface p-4">
              <OrgLogoUpload org={org} onUploaded={refreshOrg} />
            </div>
          </section>

          <ClientStatusManager orgId={orgId} />

          <LeadSourcesManager orgId={orgId} />

          <div className="mb-8">
            <PaymentProviderManager orgId={orgId} />
          </div>

          <section className="mb-8">
            <h2 className="mb-3 text-lg font-semibold text-text">
              משתמשים ({members.length})
            </h2>
            <div className="overflow-hidden rounded-lg border border-border">
              {members.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 last:border-b-0"
                  data-testid={`member-row-${m.user_id}`}
                >
                  <div className="flex items-center gap-3">
                    <Avatar name={m.profiles?.full_name} email={m.profiles?.email} />
                    <div>
                      <div className="text-text">
                        {m.profiles?.full_name || m.profiles?.email}
                        {m.user_id === user.id && (
                          <span className="mr-2 text-xs text-text-dim">(אתה)</span>
                        )}
                      </div>
                      <div className="text-xs text-text-dim">{m.profiles?.email}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m, e.target.value)}
                      disabled={m.user_id === user.id || (m.role === 'admin' && !isSuperAdmin)}
                      title={
                        m.role === 'admin' && !isSuperAdmin
                          ? 'רק סופר-אדמין יכול לשנות תפקיד של מנהל/ת'
                          : undefined
                      }
                      className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text outline-none focus:border-accent disabled:opacity-50"
                      data-testid={`member-role-${m.user_id}`}
                    >
                      <option value="member">עובד/ת</option>
                      <option value="admin">מנהל/ת</option>
                    </select>
                    {m.user_id !== user.id && (m.role === 'member' || isSuperAdmin) && (
                      <button
                        onClick={() => deleteUser(m)}
                        className="text-sm text-text-dim hover:text-status-red"
                        data-testid={`member-delete-${m.user_id}`}
                      >
                        מחק
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {invites.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-text">
                הזמנות ממתינות ({invites.length})
              </h2>
              <div className="overflow-hidden rounded-lg border border-border">
                {invites.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 last:border-b-0"
                  >
                    <div>
                      <div className="text-text">{inv.email}</div>
                      <div className="text-xs text-text-dim">
                        {inv.role === 'admin' ? 'מנהל/ת' : 'עובד/ת'} · ממתין להצטרפות
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(
                            `${window.location.origin}/accept-invite?token=${inv.token}`
                          )
                          toast('הקישור הועתק')
                        }}
                        className="text-sm text-accent hover:underline"
                      >
                        העתק קישור
                      </button>
                      <button
                        onClick={() => cancelInvite(inv)}
                        className="text-sm text-text-dim hover:text-status-red"
                      >
                        בטל
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <InviteMemberModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        orgId={orgId}
        defaultRole="member"
        onInvited={load}
      />
    </div>
  )
}
