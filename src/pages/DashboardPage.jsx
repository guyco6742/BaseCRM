import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useTitle } from '../lib/useTitle'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Button from '../components/ui/Button'
import OrgLogo from '../components/OrgLogo'

export default function DashboardPage() {
  const { user, isSuperAdmin } = useAuth()
  useTitle('הארגונים שלי')
  const [orgs, setOrgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      try {
        // סופר-אדמין רואה את כל הארגונים — ללא צורך בחברות (הוא שקוף לארגונים)
        if (isSuperAdmin) {
          const { data, error } = await supabase
            .from('organizations')
            .select('id, name, slug, logo_url, is_archived')
            .eq('is_archived', false)
            .order('name')
          if (error) throw error
          if (active) setOrgs((data || []).map((o) => ({ role: 'super_admin', organizations: o })))
          return
        }
        const { data, error } = await supabase
          .from('memberships')
          .select('role, organizations(id, name, slug, logo_url, is_archived)')
          .eq('user_id', user.id)
        if (error) throw error
        // ארגונים מושבתים לא מוצגים למשתמשים
        if (active) setOrgs((data || []).filter((m) => m.organizations && !m.organizations.is_archived))
      } catch {
        if (active) setError('טעינת הארגונים נכשלה.')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [user.id, isSuperAdmin])

  if (loading)
    return (
      <div className="flex-1 overflow-auto">
        <LoadingSpinner label="טוען ארגונים..." />
      </div>
    )

  return (
    <div className="w-full flex-1 overflow-auto" data-testid="dashboard-page">
      <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text">הארגונים שלי</h1>
        {isSuperAdmin && (
          <Link to="/admin" data-testid="dashboard-admin-link">
            <Button variant="secondary">ניהול ארגונים</Button>
          </Link>
        )}
      </div>

      {error && <p className="mb-4 text-status-red" data-testid="dashboard-error">{error}</p>}

      {orgs.length === 0 ? (
        <div
          className="rounded-lg border border-dashed border-border bg-surface/50 p-10 text-center"
          data-testid="dashboard-empty"
        >
          <p className="text-text-muted">עדיין אינך חבר באף ארגון.</p>
          <p className="mt-2 text-sm text-text-dim">
            {isSuperAdmin
              ? 'אפשר ליצור ארגון חדש דרך "ניהול ארגונים".'
              : 'בקשו ממנהל הארגון הזמנה, או פנו למנהל המערכת.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="dashboard-org-list">
          {orgs.map((m) => (
            <Link
              key={m.organizations.id}
              to={`/org/${m.organizations.id}`}
              className="group rounded-lg border border-border bg-surface p-5 transition-colors hover:border-accent"
              data-testid={`dashboard-org-card-${m.organizations.id}`}
            >
              <div className="mb-3">
                <OrgLogo org={m.organizations} size={48} />
              </div>
              <h3 className="text-lg font-semibold text-text group-hover:text-accent">
                {m.organizations.name}
              </h3>
              <span className="text-sm text-text-dim">
                {m.role === 'super_admin' ? 'סופר-אדמין' : m.role === 'admin' ? 'מנהל/ת' : 'עובד/ת'}
              </span>
            </Link>
          ))}
        </div>
      )}
      </div>
    </div>
  )
}
