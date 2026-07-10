import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// טוען את נתוני דשבורד הארגון דרך ה-RPC get_org_dashboard (§7 Item 5)
export function useDashboard(orgId) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadCount, setReloadCount] = useState(0)

  const refetch = useCallback(() => {
    setReloadCount((n) => n + 1)
  }, [])

  useEffect(() => {
    let active = true
    if (!orgId) return undefined
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data: result, error: rpcError } = await supabase.rpc('get_org_dashboard', { p_org_id: orgId })
        if (rpcError) throw rpcError
        if (!active) return
        setData(result)
      } catch (err) {
        if (!active) return
        setError(err)
        setData(null)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [orgId, reloadCount])

  return { data, loading, error, refetch }
}
