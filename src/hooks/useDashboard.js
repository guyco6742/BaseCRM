import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// טוען את נתוני דשבורד הארגון דרך ה-RPC get_org_dashboard (§7 Item 5)
export function useDashboard(orgId) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data: result, error: rpcError } = await supabase.rpc('get_org_dashboard', { p_org_id: orgId })
      if (rpcError) throw rpcError
      setData(result)
    } catch (err) {
      setError(err)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    load()
  }, [load])

  return { data, loading, error, refetch: load }
}
