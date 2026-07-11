// src/hooks/usePagedQuery.js
// תשתית עימוד גנרית לרשימות בצד שרת (Item 7 — F8). כל צרכן מספק buildQuery(from, to)
// שמחזיר שאילתת supabase שכבר בנויה (select/eq/order) עם { count: 'exact' } — האחריות
// על הרכב השאילתה (סינון/חיפוש/מיון) נשארת אצל הצרכן; ה-hook רק אחראי על range()
// (העימוד עצמו), על ה-state (rows/total/page/pageSize) ועל עקביות תחת תחלופת בקשות.
//
// גודל עמוד: נשמר פר-ארגון תחת basecrm.${orgId}.pageSize (readOrgPref/writeOrgPref,
// אותה מוסכמה כמו clientsView/clientsSort — F15).
import { useCallback, useEffect, useRef, useState } from 'react'
import { readOrgPref, writeOrgPref } from '../lib/orgStorage'

export const PAGE_SIZE_OPTIONS = [25, 50, 100]
const DEFAULT_PAGE_SIZE = 50
const PAGE_SIZE_PREF = 'pageSize'

function initialPageSize(orgId) {
  const raw = Number(readOrgPref(orgId, PAGE_SIZE_PREF))
  return PAGE_SIZE_OPTIONS.includes(raw) ? raw : DEFAULT_PAGE_SIZE
}

/**
 * usePagedQuery({ orgId, buildQuery, deps })
 * - buildQuery(from, to): (from, to) => supabase query, already .range(from, to)-ed,
 *   with { count: 'exact' } set on the .select() call by the caller.
 * - deps: array of primitive values (search text, filter id, sort key/dir, ...) that
 *   should reset the page back to 0 when they change (a new search shouldn't stay on
 *   page 7 of the old result set).
 *
 * Returns { rows, total, page, setPage, pageSize, setPageSize, loading, error, refetch }.
 */
export function usePagedQuery({ orgId, buildQuery, deps = [] }) {
  const [pageSize, setPageSizeState] = useState(() => initialPageSize(orgId))
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadCount, setReloadCount] = useState(0)

  const depsKey = JSON.stringify(deps)
  const prevDepsKey = useRef(depsKey)
  // עדכון גודל עמוד יכול להגיע מארגון קודם (למשל בזמן החלפת ארגון לפני שה-effect
  // הריצה מחדש רץ) — נסנכרן מחדש בכל שינוי orgId, כמו readOrgPref בשאר הדף.
  const prevOrgId = useRef(orgId)

  const refetch = useCallback(() => setReloadCount((n) => n + 1), [])

  const setPageSize = useCallback(
    (size) => {
      if (!PAGE_SIZE_OPTIONS.includes(size)) return
      setPageSizeState(size)
      writeOrgPref(orgId, PAGE_SIZE_PREF, String(size))
      setPage(0)
    },
    [orgId]
  )

  useEffect(() => {
    if (prevOrgId.current === orgId) return
    prevOrgId.current = orgId
    setPageSizeState(initialPageSize(orgId))
    setPage(0)
  }, [orgId])

  useEffect(() => {
    let active = true
    if (!orgId) return undefined

    // deps (חיפוש/סינון/מיון) השתנו — קופצים חזרה לעמוד 0 במקום להישאר על עמוד
    // ישן שאולי כבר לא קיים תחת הקריטריונים החדשים. ה-setPage(0) מפעיל שוב את
    // ה-effect (page בתלויות), אז לא שולפים כאן פעמיים.
    const depsChanged = prevDepsKey.current !== depsKey
    prevDepsKey.current = depsKey
    if (depsChanged && page !== 0) {
      setPage(0)
      return undefined
    }

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const from = page * pageSize
        const to = from + pageSize - 1
        const { data, error: qError, count } = await buildQuery(from, to)
        if (qError) throw qError
        if (!active) return
        setRows(data || [])
        setTotal(count ?? 0)
      } catch (err) {
        if (!active) return
        setError(err)
        setRows([])
        setTotal(0)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
    // buildQuery is expected to be memoized by the caller (useCallback) so it can
    // safely be a dependency without causing a refetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, page, pageSize, reloadCount, depsKey, buildQuery])

  // מכווצים את total: אם archive/refetch הקטינו את הכמות מתחת לעמוד הנוכחי (למשל
  // השבתת הרשומה האחרונה בעמוד האחרון) — קופצים לעמוד האחרון התקף.
  useEffect(() => {
    if (loading) return
    const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1)
    if (page > maxPage) setPage(maxPage)
  }, [total, pageSize, page, loading])

  return { rows, total, page, setPage, pageSize, setPageSize, loading, error, refetch }
}
