import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import InviteMemberModal from '../components/InviteMemberModal'
import OrgLogo from '../components/OrgLogo'
import Avatar from '../components/ui/Avatar'
import { handleEnterAsTab } from '../lib/formNav'

function slugify(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '') || `org-${Date.now()}`
}

export default function AdminPage() {
  const { user, isSuperAdmin, loading: authLoading } = useAuth()
  const [orgs, setOrgs] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  const [inviteOrg, setInviteOrg] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, slug, logo_url, is_archived, features, created_at, memberships(count)')
        .order('created_at', { ascending: false })
      if (error) throw error
      setOrgs(data || [])
    } catch {
      setError('טעינת הארגונים נכשלה.')
    } finally {
      setLoading(false)
    }

    try {
      const { data: uData, error: uErr } = await supabase
        .from('profiles')
        .select('id, full_name, email, is_super_admin, memberships(count)')
        .order('created_at', { ascending: false })
      if (uErr) throw uErr
      setUsers((uData || []).filter((u) => !u.is_super_admin))
    } catch {
      setError('טעינת המשתמשים נכשלה.')
    }
  }

  useEffect(() => {
    if (isSuperAdmin) load()
  }, [isSuperAdmin])

  if (authLoading) return <LoadingSpinner label="טוען..." />
  if (!isSuperAdmin) return <Navigate to="/" replace />

  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const { error } = await supabase.from('organizations').insert({
        name: newName.trim(),
        slug: slugify(newName),
        created_by: user.id,
      })
      if (error) throw error
      setCreateOpen(false)
      setNewName('')
      await load()
    } catch {
      setError('יצירת הארגון נכשלה.')
    } finally {
      setSaving(false)
    }
  }

  // השבתת ארגון — כל הנתונים נשמרים, החברים מאבדים גישה עד שחזור
  async function handleArchive(org) {
    if (!window.confirm(`להשבית את הארגון "${org.name}"? הנתונים יישמרו וניתן לשחזר בכל עת.`)) return
    try {
      const { error } = await supabase.from('organizations').update({ is_archived: true }).eq('id', org.id)
      if (error) throw error
      await load()
    } catch {
      setError('השבתת הארגון נכשלה.')
    }
  }

  // הפעלה/כיבוי של עמוד אופציונלי (feature flag) לארגון ספציפי
  async function handleToggleFeature(org, key) {
    const nextValue = !org.features?.[key]
    try {
      const { error } = await supabase
        .from('organizations')
        .update({ features: { ...org.features, [key]: nextValue } })
        .eq('id', org.id)
      if (error) throw error
      await load()
    } catch {
      setError('עדכון התכונה נכשל.')
    }
  }

  async function handleRestore(org) {
    try {
      const { error } = await supabase.from('organizations').update({ is_archived: false }).eq('id', org.id)
      if (error) throw error
      await load()
    } catch {
      setError('שחזור הארגון נכשל.')
    }
  }

  // מחיקה לצמיתות — רק מארגון שכבר הושבת, עם אישור כפול
  async function handleHardDelete(org) {
    if (!window.confirm(`למחוק לצמיתות את "${org.name}" וכל הנתונים שלו? פעולה זו בלתי הפיכה!`)) return
    if (!window.confirm('אישור אחרון: כל הוורקספייסים, הבורדים והפריטים יימחקו לתמיד. להמשיך?')) return
    try {
      const { error } = await supabase.from('organizations').delete().eq('id', org.id)
      if (error) throw error
      await load()
    } catch {
      setError('מחיקת הארגון נכשלה.')
    }
  }

  async function handleDeleteAccount(u) {
    const label = u.full_name || u.email
    if (!window.confirm(`למחוק לצמיתות את החשבון של ${label}? פעולה בלתי הפיכה!`)) return
    if (!window.confirm('אישור אחרון: החשבון וכל החברויות שלו יימחקו לתמיד. להמשיך?')) return
    try {
      const { error } = await supabase.rpc('delete_user_account', { p_user_id: u.id })
      if (error) throw error
      await load()
    } catch (e) {
      const messages = {
        'not authorized': 'אין הרשאה למחוק משתמש זה.',
        'cannot delete yourself': 'לא ניתן למחוק את החשבון שלך.',
        'cannot delete a super admin': 'לא ניתן למחוק סופר-אדמין.',
      }
      setError(messages[e.message] || 'מחיקת החשבון נכשלה.')
    }
  }

  const activeOrgs = orgs.filter((o) => !o.is_archived)
  const archivedOrgs = orgs.filter((o) => o.is_archived)

  return (
    <div className="w-full flex-1 overflow-auto">
      <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">ניהול ארגונים</h1>
          <p className="text-sm text-text-dim">סופר-אדמין — הקמה וניהול של ארגונים במערכת</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="admin-new-org-btn">
          + ארגון חדש
        </Button>
      </div>

      {error && <p className="mb-4 text-status-red">{error}</p>}

      {loading ? (
        <LoadingSpinner label="טוען ארגונים..." />
      ) : activeOrgs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface/50 p-10 text-center text-text-muted">
          עדיין אין ארגונים. צרו את הראשון בלחיצה על "ארגון חדש".
        </div>
      ) : (
        <div className="space-y-3">
          {activeOrgs.map((org) => (
            <div
              key={org.id}
              className="flex items-center justify-between rounded-lg border border-border bg-surface p-4"
              data-testid={`admin-org-row-${org.id}`}
            >
              <div className="flex items-center gap-3">
                <OrgLogo org={org} size={40} />
                <div>
                  <h3 className="font-semibold text-text">{org.name}</h3>
                  <span className="text-xs text-text-dim">
                    {org.memberships?.[0]?.count ?? 0} משתמשים
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant={org.features?.send_contract ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => handleToggleFeature(org, 'send_contract')}
                  title="הצג/הסתר את עמוד 'שליחת חוזה' לארגון הזה"
                  data-testid={`admin-toggle-send-contract-${org.id}`}
                >
                  ✍️ עמוד חוזה: {org.features?.send_contract ? 'פעיל' : 'כבוי'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setInviteOrg(org)}
                  data-testid={`admin-invite-admin-${org.id}`}
                >
                  הזמן מנהל
                </Button>
                <Link to={`/org/${org.id}`} data-testid={`admin-enter-org-${org.id}`}>
                  <Button variant="ghost" size="sm">
                    כניסה
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleArchive(org)}
                  data-testid={`admin-archive-org-${org.id}`}
                >
                  <span className="text-status-orange">השבת</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ארגונים מושבתים — שחזור או מחיקה לצמיתות */}
      {archivedOrgs.length > 0 && (
        <section className="mt-8" data-testid="admin-archived-orgs">
          <h2 className="mb-2 text-sm font-semibold text-text-muted">
            ארגונים מושבתים ({archivedOrgs.length})
          </h2>
          <div className="space-y-1">
            {archivedOrgs.map((org) => (
              <div
                key={org.id}
                className="flex items-center justify-between rounded-md border border-dashed border-border bg-surface/50 px-3 py-2"
              >
                <span className="flex items-center gap-2 text-sm text-text-dim">
                  <OrgLogo org={org} size={24} />
                  {org.name}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleRestore(org)}
                    className="text-sm text-accent hover:underline"
                    data-testid={`admin-restore-org-${org.id}`}
                  >
                    שחזר
                  </button>
                  <button
                    onClick={() => handleHardDelete(org)}
                    className="text-sm text-text-dim hover:text-status-red"
                    data-testid={`admin-harddelete-org-${org.id}`}
                  >
                    מחק לצמיתות
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8" data-testid="admin-users-section">
        <h2 className="mb-2 text-sm font-semibold text-text-muted">
          משתמשים ({users.length})
        </h2>
        <div className="overflow-hidden rounded-lg border border-border">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 last:border-b-0"
              data-testid={`admin-user-row-${u.id}`}
            >
              <div className="flex items-center gap-3">
                <Avatar name={u.full_name} email={u.email} />
                <div>
                  <div className="text-text">{u.full_name || u.email}</div>
                  <div className="text-xs text-text-dim">{u.email}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-text-dim">
                  {u.memberships?.[0]?.count ?? 0} ארגונים
                </span>
                <button
                  onClick={() => handleDeleteAccount(u)}
                  className="text-sm text-text-dim hover:text-status-red"
                  data-testid={`admin-user-delete-${u.id}`}
                >
                  מחק חשבון
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* יצירת ארגון */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="ארגון חדש"
        testid="admin-create-org-modal"
      >
        <form onSubmit={handleCreate} onKeyDown={handleEnterAsTab} className="space-y-4">
          <Input
            label="שם הארגון"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="לדוגמה: חברת אלפא בע״מ"
            required
            autoFocus
            data-testid="admin-org-name-input"
          />
          <div className="flex justify-start gap-2">
            <Button type="submit" disabled={saving || !newName.trim()} data-testid="admin-create-org-submit">
              {saving ? 'יוצר...' : 'צור ארגון'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
              ביטול
            </Button>
          </div>
        </form>
      </Modal>

      {/* הזמנת מנהל ראשון */}
      <InviteMemberModal
        open={Boolean(inviteOrg)}
        onClose={() => setInviteOrg(null)}
        orgId={inviteOrg?.id}
        defaultRole="admin"
      />
      </div>
    </div>
  )
}
