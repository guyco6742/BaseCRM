import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const OrgContext = createContext(null)

export function OrgProvider({ children }) {
  const { orgId } = useParams()
  const { user, isSuperAdmin } = useAuth()

  const [org, setOrg] = useState(null)
  const [role, setRole] = useState(null) // 'admin' | 'member' | null
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  // מונה שמאלץ רענון של מבנה הארגון (וורקספייסים/בורדים) בסרגל הצד ובדפים
  const [structureVersion, setStructureVersion] = useState(0)
  // חברי הארגון — נטען פעם אחת ומשותף בין הדפים (במקום שכל דף ישלוף בנפרד)
  const [members, setMembers] = useState([])

  const refreshStructure = useCallback(() => setStructureVersion((v) => v + 1), [])

  // טעינה מחדש של שורת הארגון בלבד (למשל אחרי עדכון לוגו)
  const refreshOrg = useCallback(async () => {
    const { data } = await supabase.from('organizations').select('*').eq('id', orgId).maybeSingle()
    if (data) setOrg(data)
  }, [orgId])

  const loadMembers = useCallback(async () => {
    const { data } = await supabase
      .from('memberships')
      .select('user_id, role, profiles(full_name, email, is_super_admin)')
      .eq('org_id', orgId)
    setMembers(data || [])
  }, [orgId])

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setNotFound(false)
      try {
        const { data: orgData, error } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', orgId)
          .maybeSingle()
        if (error || !orgData) {
          if (active) setNotFound(true)
          return
        }
        // ארגון מושבת — נגיש רק לסופר-אדמין (לצורך שחזור)
        if (orgData.is_archived && !isSuperAdmin) {
          if (active) setNotFound(true)
          return
        }
        const { data: membership } = await supabase
          .from('memberships')
          .select('role')
          .eq('org_id', orgId)
          .eq('user_id', user.id)
          .maybeSingle()

        if (!active) return
        setOrg(orgData)
        setRole(membership?.role ?? (isSuperAdmin ? 'admin' : null))
        loadMembers()
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [orgId, user.id, isSuperAdmin, loadMembers])

  const value = useMemo(() => ({
    orgId,
    org,
    role,
    isAdmin: role === 'admin' || isSuperAdmin,
    loading,
    notFound,
    structureVersion,
    refreshStructure,
    refreshOrg,
    members,
    refreshMembers: loadMembers,
  }), [
    orgId,
    org,
    role,
    isSuperAdmin,
    loading,
    notFound,
    structureVersion,
    refreshStructure,
    refreshOrg,
    members,
    loadMembers,
  ])

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOrg() {
  const ctx = useContext(OrgContext)
  if (!ctx) throw new Error('useOrg must be used within OrgProvider')
  return ctx
}
