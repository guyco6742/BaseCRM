import { createContext, useContext, useEffect, useState, useCallback } from 'react'
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
  const [favorite, setFavoriteState] = useState(null)

  const refreshStructure = useCallback(() => setStructureVersion((v) => v + 1), [])

  // טעינה מחדש של שורת הארגון בלבד (למשל אחרי עדכון לוגו)
  const refreshOrg = useCallback(async () => {
    const { data } = await supabase.from('organizations').select('*').eq('id', orgId).maybeSingle()
    if (data) setOrg(data)
  }, [orgId])

  // טוען את המועדף האישי של המשתמש לארגון הזה (בורד או עמוד לקוחות), אם קיים ותקף
  const loadFavorite = useCallback(async (isActive) => {
    const { data } = await supabase
      .from('user_favorites')
      .select('favorite_type, board_id, boards(is_archived)')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!isActive()) return
    if (!data) {
      setFavoriteState(null)
      return
    }
    if (data.favorite_type === 'clients') {
      setFavoriteState({ type: 'clients' })
      return
    }
    if (data.favorite_type === 'board' && data.boards && !data.boards.is_archived) {
      setFavoriteState({ type: 'board', boardId: data.board_id })
      return
    }
    setFavoriteState(null)
  }, [orgId, user.id])

  // next = null (מבטל), { type: 'clients' }, או { type: 'board', boardId }
  const setFavorite = useCallback(
    async (next) => {
      if (next === null) {
        await supabase.from('user_favorites').delete().eq('org_id', orgId).eq('user_id', user.id)
        setFavoriteState(null)
        return
      }
      const row = {
        user_id: user.id,
        org_id: orgId,
        favorite_type: next.type,
        board_id: next.type === 'board' ? next.boardId : null,
      }
      const { error } = await supabase.from('user_favorites').upsert(row, { onConflict: 'user_id,org_id' })
      if (!error) setFavoriteState(next)
    },
    [orgId, user.id]
  )

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
        await loadFavorite(() => active)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [orgId, user.id, isSuperAdmin, loadFavorite])

  const value = {
    orgId,
    org,
    role,
    isAdmin: role === 'admin' || isSuperAdmin,
    loading,
    notFound,
    structureVersion,
    refreshStructure,
    refreshOrg,
    favorite,
    setFavorite,
  }

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOrg() {
  const ctx = useContext(OrgContext)
  if (!ctx) throw new Error('useOrg must be used within OrgProvider')
  return ctx
}
