import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { useConfirm } from '../context/ConfirmContext'
import { useToast } from '../context/ToastContext'
import { useTitle } from '../lib/useTitle'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import AddColumnModal from '../components/board/AddColumnModal'
import ColumnManagerModal from '../components/board/ColumnManagerModal'
import EditColumnModal from '../components/board/EditColumnModal'
import ImportClientsModal from '../components/crm/ImportClientsModal'
import ClientsKanban from '../components/crm/ClientsKanban'
import ClientsTable from '../components/crm/ClientsTable'
import BoardCell from '../components/board/BoardCell'
import Pagination from '../components/Pagination'
import { usePagedQuery } from '../hooks/usePagedQuery'
import { handleEnterAsTab } from '../lib/formNav'
import {
  buildColumns,
  sortClients,
  matchesFilters,
  filterOptionsFor,
  describeFilter,
  getCellText,
} from '../lib/clientTable'
import { exportRowsToCSV, downloadCSV } from '../lib/csv'
import { readOrgPref, writeOrgPref } from '../lib/orgStorage'
import FavoriteStarButton from '../components/FavoriteStarButton'

// עמודות "בסיס" הניתנות למיון בצד שרת (עמודת clients אמיתית). status/contacts
// לא ברשימה: status דורש תווית מטבלת client_statuses (לא נבחרת בשאילתת
// הלקוחות), ו-contacts הוא ספירה מחושבת (join count) — Postgres לא יכול
// לבצע .order על שדה שכזה. שני אלה ממוינים בעמוד הנוכחי בלבד (ר' isServerSortable).
const REAL_COLUMN = { name: 'name', phone: 'phone', email: 'email' }

function isServerSortable(col) {
  if (!col) return false
  return col.kind === 'custom' || Boolean(REAL_COLUMN[col.kind])
}

// מנקה קלט חיפוש לפני שילוב במחרוזת .or() של PostgREST: פסיק/סוגריים שוברים
// את תחביר ה-or (מפרידים/מקבצים תנאים), ואחוז הוא תו הכל (wildcard) של ilike —
// בלי הניקוי משתמש יכול "להזריק" תנאי OR נוסף או wildcard לא מבוקר.
function sanitizeSearchQuery(q) {
  return (q || '').replace(/[,()%]/g, ' ').trim()
}

// שלד טעינה (animate-pulse) לטבלת הרשימה — ClientsTable עצמו לא מקבל מצב
// טעינה (רכיב משותף עם קנבן/פרטי-לקוח), אז השלד מוצג כאן במקומו כשהעמוד נטען.
function ClientsTableSkeleton({ columns }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border" data-testid="clients-table-skeleton">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-sidebar text-xs font-medium text-text-muted">
            {columns.map((col) => (
              <th key={col.key} className="whitespace-nowrap px-4 py-2 text-start">
                {col.label}
              </th>
            ))}
            <th className="w-10 px-2" />
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <tr key={i} className="border-b border-border last:border-b-0">
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-3">
                  <div className="h-4 w-full max-w-[10rem] animate-pulse rounded bg-surface-2" />
                </td>
              ))}
              <td className="px-2" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ClientsPage() {
  const { orgId, isAdmin, members: orgMembers } = useOrg()
  const confirm = useConfirm()
  const { toast } = useToast()
  useTitle('לקוחות')

  // ---- מטא: סטטוסים + שדות מותאמים (לא מעומדים — קבוצות קטנות) ----
  const [statuses, setStatuses] = useState([])
  const [fields, setFields] = useState([])
  const [metaLoading, setMetaLoading] = useState(true)
  const [error, setError] = useState('')

  // תצוגה: רשימה / קנבן — נשמרת בין ביקורים, מבודדת פר-ארגון (F15)
  // הערה: orgId מגיע מ-useParams() דרך useOrg() (למעלה) ותמיד קיים בשלב זה,
  // כי ClientsPage מרונדר תחת /org/:orgId/clients — לכן בטוח לקרוא אותו כבר
  // באתחול ה-state (אין race על הרינדור הראשון).
  const [view, setView] = useState(() => readOrgPref(orgId, 'clientsView', 'basecrm.clientsView') || 'list')
  // סינון לפי שלב בפייפליין (null = הכל)
  const [statusFilter, setStatusFilter] = useState(null)
  // מיון: { key, dir } — נשמר בין ביקורים, מבודד פר-ארגון (F15)
  const [sort, setSort] = useState(() => {
    try {
      const raw = readOrgPref(orgId, 'clientsSort', 'basecrm.clientsSort')
      return (raw && JSON.parse(raw)) || { key: 'name', dir: 'asc' }
    } catch {
      return { key: 'name', dir: 'asc' }
    }
  })
  // חיפוש: הקלט הגולמי מוצג מיד; debouncedSearch (300ms) הוא מה שפוגע ב-DB
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // סינונים לפי עמודה: [{ key, value }] — מצטברים ב"וגם"; בתצוגת הרשימה
  // פועלים על העמוד הנוכחי בלבד (ר' הערה למשתמש), בקנבן על כל הרשימה.
  const [filters, setFilters] = useState([])
  // טיוטת בונה הסינון
  const [draftKey, setDraftKey] = useState('')
  const [draftVal, setDraftVal] = useState('')

  // מודלים
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [newClient, setNewClient] = useState({ name: '', phone: '', email: '', status_id: null, custom_values: {} })
  const [saving, setSaving] = useState(false)
  const [fieldsManagerOpen, setFieldsManagerOpen] = useState(false)
  const [addFieldOpen, setAddFieldOpen] = useState(false)
  const [editingField, setEditingField] = useState(null)
  const [exporting, setExporting] = useState(false)

  // ---- טעינת מטא-דאטה: סטטוסים + שדות מותאמים ----
  async function loadMeta() {
    setMetaLoading(true)
    try {
      const [sRes, fRes] = await Promise.all([
        supabase.from('client_statuses').select('*').eq('org_id', orgId).order('position'),
        supabase.from('client_fields').select('*').eq('org_id', orgId).order('position'),
      ])
      if (sRes.error) throw sRes.error
      if (fRes.error) throw fRes.error
      setStatuses((sRes.data || []).filter((s) => !s.is_archived))
      setFields(fRes.data || [])
    } catch {
      setError('טעינת הלקוחות נכשלה.')
    } finally {
      setMetaLoading(false)
    }
  }

  useEffect(() => {
    loadMeta()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  // ClientsPage לא נטען מחדש כשעוברים מארגון לארגון באותו נתיב (/org/:orgId/clients) —
  // רק ה-orgId ב-context משתנה. לכן צריך לסנכרן מחדש את העדפות התצוגה/מיון
  // מה-localStorage המבודד של הארגון החדש, אחרת הן "יידבקו" מהארגון הקודם (F15).
  useEffect(() => {
    setView(readOrgPref(orgId, 'clientsView', 'basecrm.clientsView') || 'list')
    setSort(() => {
      try {
        const raw = readOrgPref(orgId, 'clientsSort', 'basecrm.clientsSort')
        return (raw && JSON.parse(raw)) || { key: 'name', dir: 'asc' }
      } catch {
        return { key: 'name', dir: 'asc' }
      }
    })
    setStatusFilter(null)
    setFilters([])
    setSearch('')
  }, [orgId])

  // סופר-אדמין שקוף לארגון — לא רלוונטי כאחראי
  const members = useMemo(
    () =>
      orgMembers
        .filter((m) => !m.profiles?.is_super_admin)
        .map((m) => ({
          user_id: m.user_id,
          full_name: m.profiles?.full_name,
          email: m.profiles?.email,
        })),
    [orgMembers]
  )

  // שדות פעילים (לא בארכיון) וגלויים (לא מוסתרים) → עמודות הטבלה
  const activeFields = useMemo(
    () => fields.filter((f) => !f.is_archived).sort((a, b) => a.position - b.position),
    [fields]
  )
  const visibleFields = useMemo(() => activeFields.filter((f) => !f.settings?.hidden), [activeFields])
  const columns = useMemo(() => buildColumns(visibleFields), [visibleFields])
  const ctx = useMemo(() => ({ columns, statuses, members }), [columns, statuses, members])

  const sortCol = columns.find((c) => c.key === sort.key)
  const sortIsPageLocal = Boolean(sortCol) && !isServerSortable(sortCol)

  // ---- שאילתת הרשימה (list view) — סינון/חיפוש/מיון בצד שרת ----
  // מוחזרת פונקציה טהורה (לא ה-Promise עצמו) כדי שאפשר יהיה להשתמש בה גם
  // מ-usePagedQuery (עם range) וגם מלולאת ייצוא ה-CSV (עם range אחר, בלי state).
  const baseListQuery = useCallback(() => {
    let q = supabase
      .from('clients')
      .select('*, contacts(count)', { count: 'exact' })
      .eq('org_id', orgId)
      .eq('is_archived', false)
      .eq('contacts.is_archived', false)

    if (statusFilter) q = q.eq('status_id', statusFilter)

    const cleaned = sanitizeSearchQuery(debouncedSearch)
    if (cleaned) {
      q = q.or(
        `name.ilike.%${cleaned}%,email.ilike.%${cleaned}%,phone.ilike.%${cleaned}%,company_number.ilike.%${cleaned}%`
      )
    }

    if (sortCol && isServerSortable(sortCol)) {
      const ascending = sort.dir !== 'desc'
      if (sortCol.kind === 'custom') {
        // מיון JSON path: PostgREST תומך ב-order=custom_values->>fieldId.asc.
        // supabase-js מעביר את שם ה"עמודה" כמחרוזת גולמית ל-querystring, אז
        // מחרוזת עם ->> בתוכה מגיעה כמו שהיא — לא נמצאה תמיכה מתועדת ב-API
        // ל-JSON path דרך אובייקט/helper נפרד ב-supabase-js v2, זו הצורה
        // המתועדת (foreignTable-free) לפי PostgREST.
        // nullsFirst:false שומר על ההתנהגות ההיסטורית (sortClients בצד לקוח) של
        // ערכים ריקים תמיד בסוף, בשני הכיוונים — ברירת המחדל של Postgres ל-DESC
        // היא NULLS FIRST, מה שהיה מציף טלפונים/אימיילים ריקים לראש עמוד 1.
        // הערה: זה חל על NULL ב-SQL בלבד, לא על מחרוזת ריקה '' — פער שיורי מול
        // ההתנהגות הישנה שמקובל להשאיר כך.
        q = q.order(`custom_values->>${sortCol.field.id}`, { ascending, nullsFirst: false })
      } else {
        q = q.order(REAL_COLUMN[sortCol.kind], { ascending, nullsFirst: false })
      }
    } else {
      // מיון לא-שרתי (status/contacts) — סדר בסיס יציב לעימוד; המיון בפועל
      // מופעל בצד לקוח על 50/25/100 השורות של העמוד הנוכחי בלבד (ר' pageRows).
      q = q.order('position', { ascending: true })
    }

    return q
  }, [orgId, statusFilter, debouncedSearch, sortCol, sort.dir])

  const buildQuery = useCallback((from, to) => baseListQuery().range(from, to), [baseListQuery])

  const paged = usePagedQuery({
    orgId,
    buildQuery,
    deps: [debouncedSearch, statusFilter, sort.key, sort.dir],
  })

  // עותק מקומי-ניתן-לעריכה של עמוד הרשימה הנוכחי — מסונכרן מ-paged.rows, אבל
  // מאפשר עדכון אופטימי (ארכוב/שינוי שלב/עריכת תא) לפני שהתשובה מהשרת חוזרת.
  const [localRows, setLocalRows] = useState([])
  useEffect(() => {
    setLocalRows(paged.rows)
  }, [paged.rows])

  // ---- קנבן: טוען את *כל* לקוחות הארגון (לא מעומד) רק כשתצוגת קנבן פעילה ----
  const [kanbanClients, setKanbanClients] = useState([])
  const [kanbanLoading, setKanbanLoading] = useState(false)
  const [kanbanReload, setKanbanReload] = useState(0)

  useEffect(() => {
    if (view !== 'kanban' || !orgId) return undefined
    let active = true
    async function loadKanban() {
      setKanbanLoading(true)
      try {
        const { data, error: qError } = await supabase
          .from('clients')
          .select('*, contacts(count)')
          .eq('org_id', orgId)
          .eq('is_archived', false)
          .eq('contacts.is_archived', false)
          .order('position')
        if (qError) throw qError
        if (!active) return
        setKanbanClients(data || [])
      } catch {
        if (active) setError('טעינת הלקוחות נכשלה.')
      } finally {
        if (active) setKanbanLoading(false)
      }
    }
    loadKanban()
    return () => {
      active = false
    }
  }, [view, orgId, kanbanReload])

  // ---- לקוחות מושבתים (מנהל בלבד) — רשימה נפרדת, לא מעומדת (בד"כ קטנה) ----
  const [archivedClients, setArchivedClients] = useState([])
  async function loadArchived() {
    if (!isAdmin || !orgId) return
    const { data } = await supabase
      .from('clients')
      .select('id, name')
      .eq('org_id', orgId)
      .eq('is_archived', true)
      .order('name')
      .limit(500)
    setArchivedClients(data || [])
  }
  useEffect(() => {
    loadArchived()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, isAdmin])

  // ---- ספירות לצ'יפים של סינון-שלב ----
  // שאילתה קלה אחת (עמודת status_id בלבד, לא כל השורה) — לא כרוכה ב-N+1
  // ולא סוחבת contacts(count)/custom_values הכבדים; מספיק להצגת מונים.
  const [statusCounts, setStatusCounts] = useState({ total: 0, byStatus: {}, grandTotal: 0 })
  async function loadStatusCounts() {
    if (!orgId) return
    const { data } = await supabase
      .from('clients')
      .select('status_id')
      .eq('org_id', orgId)
      .eq('is_archived', false)
    const byStatus = {}
    let total = 0
    for (const c of data || []) {
      total++
      if (c.status_id) byStatus[c.status_id] = (byStatus[c.status_id] || 0) + 1
    }
    // grandTotal כולל גם לקוחות מושבתים — כדי לתאום עם בסיס המיקום (position)
    // שמשמש ביצירת לקוח (handleCreate סופר את כל הלקוחות, כולל מושבתים), כך
    // שהייבוא מה-CSV יוסיף אחרי אותו בסיס בדיוק ולא ידרוס position קיים.
    const { count: grandTotal } = await supabase
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
    setStatusCounts({ total, byStatus, grandTotal: grandTotal ?? total })
  }
  useEffect(() => {
    loadStatusCounts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  // ---- עדכון אופטימי משותף לשני המקורות (עמוד הרשימה + קנבן) ----
  function findClient(clientId) {
    return localRows.find((c) => c.id === clientId) || kanbanClients.find((c) => c.id === clientId)
  }
  function applyLocalUpdate(clientId, updater) {
    setLocalRows((cur) => cur.map((c) => (c.id === clientId ? updater(c) : c)))
    setKanbanClients((cur) => cur.map((c) => (c.id === clientId ? updater(c) : c)))
  }

  // עמוד הרשימה המוצג בפועל: מיון-עמוד-מקומי (אם צריך) → סינוני-עמודה (עמוד-מקומי)
  const pageRows = sortIsPageLocal ? sortClients(localRows, sort, ctx) : localRows
  const pageFilteredRows = filters.length ? pageRows.filter((c) => matchesFilters(c, filters, ctx)) : pageRows

  // תצוגת קנבן: כל הלקוחות, סינון+מיון מלאים בצד לקוח (כמו לפני Item 7) —
  // בלי debounce על החיפוש כי אין כאן פנייה לרשת, זו סינון-מערך רגיל.
  const kanbanFiltered = kanbanClients.filter((c) => {
    if (statusFilter && c.status_id !== statusFilter) return false
    if (!matchesFilters(c, filters, ctx)) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return [c.name, c.phone, c.email, c.company_number].filter(Boolean).some((v) => v.toLowerCase().includes(q))
  })
  const kanbanSorted = sortClients(kanbanFiltered, sort, ctx)

  // ייצוא ה-CSV חייב לכלול את *כל* השורות התואמות (לא רק העמוד המוצג) —
  // שולף בלולאה עמודי-1000 עם אותה שאילתת בסיס (חיפוש/סינון-שלב/מיון-שרת),
  // ואז מפעיל את סינוני-העמודה (matchesFilters) והמיון-המקומי (אם צריך) על
  // הסט המלא — כך שהייצוא מדויק גם לגבי סינונים שבתצוגה החיה נשארים "עמוד-מקומי בלבד".
  async function exportCSV() {
    setExporting(true)
    try {
      const allRows = []
      const EXPORT_PAGE = 1000
      let from = 0
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const to = from + EXPORT_PAGE - 1
        const { data, error: qError, count } = await baseListQuery().range(from, to)
        if (qError) throw qError
        allRows.push(...(data || []))
        if (!data || data.length < EXPORT_PAGE) break
        from += EXPORT_PAGE
        if (typeof count === 'number' && from >= count) break
      }
      let exportRows = filters.length ? allRows.filter((c) => matchesFilters(c, filters, ctx)) : allRows
      if (sortIsPageLocal) exportRows = sortClients(exportRows, sort, ctx)

      const headers = columns.map((c) => c.label)
      const rows = exportRows.map((c) => columns.map((col) => getCellText(c, col, ctx)))
      const csv = exportRowsToCSV(headers, rows)
      downloadCSV(`לקוחות-${new Date().toISOString().slice(0, 10)}.csv`, csv)
    } catch {
      toast('ייצוא ה-CSV נכשל.', 'error')
    } finally {
      setExporting(false)
    }
  }

  // ---- מיון וסינון (פקדי סרגל הכלים) ----
  function applySort(key) {
    setSort((prev) => {
      const next = prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
      writeOrgPref(orgId, 'clientsSort', JSON.stringify(next))
      return next
    })
  }
  function toggleSortDir() {
    setSort((prev) => {
      const next = { key: prev.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      writeOrgPref(orgId, 'clientsSort', JSON.stringify(next))
      return next
    })
  }
  const draftCol = columns.find((c) => c.key === draftKey)
  const draftOptions = draftCol ? filterOptionsFor(draftCol, ctx) : null
  function addFilter() {
    if (!draftKey || draftVal === '') return
    setFilters((prev) => [...prev.filter((f) => f.key !== draftKey), { key: draftKey, value: draftVal }])
    setDraftKey('')
    setDraftVal('')
  }
  function removeFilter(key) {
    setFilters((prev) => prev.filter((f) => f.key !== key))
  }

  function switchView(v) {
    setView(v)
    writeOrgPref(orgId, 'clientsView', v)
  }

  // שינוי שלב מגרירה בקנבן / צ'יפ בטבלה — עדכון אופטימי על שני המקורות
  async function setClientStatus(clientId, statusId) {
    const prevStatus = findClient(clientId)?.status_id ?? null
    applyLocalUpdate(clientId, (c) => ({ ...c, status_id: statusId }))
    const { error: updError } = await supabase
      .from('clients')
      .update({ status_id: statusId, updated_at: new Date().toISOString() })
      .eq('id', clientId)
    if (updError) {
      applyLocalUpdate(clientId, (c) => ({ ...c, status_id: prevStatus }))
      setError('עדכון השלב נכשל.')
      toast('עדכון השלב נכשל.', 'error')
      return
    }
    paged.refetch() // הרשומה עשויה לצאת/להיכנס לעמוד תחת סינון-שלב פעיל
    loadStatusCounts()
  }

  // עדכון טלפון/אימייל מהטבלה — עדכון אופטימי
  async function updateClientField(clientId, field, value) {
    const prevValue = findClient(clientId)?.[field]
    applyLocalUpdate(clientId, (c) => ({ ...c, [field]: value }))
    const { error: updError } = await supabase
      .from('clients')
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq('id', clientId)
    if (updError) {
      applyLocalUpdate(clientId, (c) => ({ ...c, [field]: prevValue }))
      setError('עדכון השדה נכשל.')
      toast('עדכון השדה נכשל.', 'error')
      return
    }
    paged.refetch() // הערך יכול להשפיע על התאמת חיפוש בעמוד
  }

  // עדכון שדה מותאם מהטבלה — עדכון אופטימי (כמו updateItemValue בבורד)
  async function updateClientCustomValue(client, fieldId, value) {
    const prevValues = client.custom_values
    const newValues = { ...(prevValues || {}), [fieldId]: value }
    applyLocalUpdate(client.id, (c) => ({ ...c, custom_values: newValues }))
    const { error: updError } = await supabase
      .from('clients')
      .update({ custom_values: newValues, updated_at: new Date().toISOString() })
      .eq('id', client.id)
    if (updError) {
      applyLocalUpdate(client.id, (c) => ({ ...c, custom_values: prevValues }))
      setError('שמירת השינוי נכשלה.')
      toast('שמירת השינוי נכשלה.', 'error')
      return
    }
    paged.refetch()
  }

  // ---- לקוחות ----
  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const { count } = await supabase
        .from('clients')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
      const { error: insError } = await supabase.from('clients').insert({
        org_id: orgId,
        name: newClient.name.trim(),
        phone: newClient.phone.trim() || null,
        email: newClient.email.trim() || null,
        status_id: newClient.status_id ?? statuses[0]?.id ?? null, // ברירת מחדל: השלב הראשון בפייפליין
        custom_values: newClient.custom_values || {},
        position: count ?? 0,
      })
      if (insError) throw insError
      setAddOpen(false)
      setNewClient({ name: '', phone: '', email: '', status_id: null, custom_values: {} })
      // הלקוח החדש עשוי לא להשתייך לעמוד/סינון הנוכחיים — רענון מלא במקום דחיפה מקומית
      paged.refetch()
      if (view === 'kanban') setKanbanReload((n) => n + 1)
      loadStatusCounts()
      toast('הלקוח נוצר בהצלחה')
    } catch {
      setError('יצירת הלקוח נכשלה.')
    } finally {
      setSaving(false)
    }
  }

  async function archiveClient(client) {
    const ok = await confirm({
      title: 'השבתת לקוח',
      message: `להשבית את הלקוח "${client.name}"? הנתונים יישמרו וניתן לשחזר.`,
      confirmText: 'השבתה',
      danger: true,
    })
    if (!ok) return
    const prevLocalRows = localRows
    const prevKanbanClients = kanbanClients
    setLocalRows((cur) => cur.filter((c) => c.id !== client.id))
    setKanbanClients((cur) => cur.filter((c) => c.id !== client.id))
    const { error: updError } = await supabase.from('clients').update({ is_archived: true }).eq('id', client.id)
    if (updError) {
      setLocalRows(prevLocalRows)
      setKanbanClients(prevKanbanClients)
      toast('השבתת הלקוח נכשלה.', 'error')
      return
    }
    toast('הלקוח הושבת בהצלחה')
    paged.refetch()
    loadArchived()
    loadStatusCounts()
  }

  async function restoreClient(client) {
    const { error: updError } = await supabase.from('clients').update({ is_archived: false }).eq('id', client.id)
    if (updError) {
      toast('שחזור הלקוח נכשל.', 'error')
      return
    }
    paged.refetch()
    if (view === 'kanban') setKanbanReload((n) => n + 1)
    loadArchived()
    loadStatusCounts()
    toast('הלקוח שוחזר בהצלחה')
  }

  // ---- שדות מותאמים ללקוחות (שימוש חוזר במנוע העמודות) ----
  async function addField({ name, type, settings }) {
    const { error: insError } = await supabase.from('client_fields').insert({
      org_id: orgId,
      name,
      type,
      settings,
      position: fields.length,
    })
    if (insError) return setError('יצירת השדה נכשלה.')
    setAddFieldOpen(false)
    await loadMeta()
    toast('השדה נוצר בהצלחה')
  }

  async function updateField(field, { name, settings }) {
    const { error: updError } = await supabase.from('client_fields').update({ name, settings }).eq('id', field.id)
    await loadMeta()
    if (updError) toast('שמירת השדה נכשלה.', 'error')
    else toast('השדה נשמר בהצלחה')
  }

  async function moveField(field, dir) {
    const ordered = fields.filter((f) => !f.is_archived).sort((a, b) => a.position - b.position)
    const idx = ordered.findIndex((f) => f.id === field.id)
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= ordered.length) return
    const a = ordered[idx]
    const b = ordered[swapIdx]
    await Promise.all([
      supabase.from('client_fields').update({ position: b.position }).eq('id', a.id),
      supabase.from('client_fields').update({ position: a.position }).eq('id', b.id),
    ])
    await loadMeta()
  }

  async function toggleFieldHidden(field) {
    const newSettings = { ...(field.settings || {}), hidden: !field.settings?.hidden }
    await supabase.from('client_fields').update({ settings: newSettings }).eq('id', field.id)
    await loadMeta()
  }

  async function archiveField(field) {
    await supabase.from('client_fields').update({ is_archived: true }).eq('id', field.id)
    await loadMeta()
    toast('השדה הושבת בהצלחה')
  }

  async function restoreField(field) {
    await supabase.from('client_fields').update({ is_archived: false }).eq('id', field.id)
    await loadMeta()
    toast('השדה שוחזר בהצלחה')
  }

  const archivedFields = fields.filter((f) => f.is_archived)
  const hasActiveFilters = Boolean(search || statusFilter || filters.length)
  // ריק "אמיתי" (0 תוצאות בכל השרת) — לא "ריק בעמוד הזה בגלל סינון-עמודה מקומי"
  // (שם עדיין רוצים להציג את הטבלה + עימוד כדי שאפשר יהיה לדפדף לעמוד אחר).
  const listEmpty = view === 'list' && !paged.loading && paged.total === 0
  const kanbanEmpty = view === 'kanban' && !kanbanLoading && kanbanSorted.length === 0

  return (
    <div className="mx-auto max-w-5xl p-6" data-testid="clients-page">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-text">לקוחות</h1>
          <FavoriteStarButton type="clients" />
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Button variant="ghost" onClick={() => setFieldsManagerOpen(true)} data-testid="clients-fields-btn">
              ⚙ שדות לקוח
            </Button>
          )}
          <Button variant="secondary" onClick={() => setImportOpen(true)} data-testid="clients-import-btn">
            ⬆ ייבוא CSV
          </Button>
          <Button variant="secondary" onClick={exportCSV} loading={exporting} data-testid="clients-export-btn">
            ⬇ ייצוא CSV
          </Button>
          <Button onClick={() => setAddOpen(true)} data-testid="clients-new-btn">
            + לקוח חדש
          </Button>
        </div>
      </div>

      {error && <p className="mb-4 text-status-red">{error}</p>}

      {/* סרגל כלים: חיפוש, החלפת תצוגה וסינון לפי שלב */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="w-full max-w-sm">
          <span className="sr-only">חיפוש לקוחות</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם, טלפון, אימייל או ח.פ..."
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-dim outline-none focus:border-accent"
            data-testid="clients-search"
          />
        </label>

        {/* טוגל רשימה/קנבן */}
        <div className="flex overflow-hidden rounded-md border border-border" data-testid="clients-view-toggle">
          <button
            onClick={() => switchView('list')}
            className={`px-3 py-1.5 text-sm ${view === 'list' ? 'bg-accent text-white' : 'bg-surface text-text-muted hover:bg-surface-2'}`}
            data-testid="clients-view-list"
          >
            ☰ רשימה
          </button>
          <button
            onClick={() => switchView('kanban')}
            className={`px-3 py-1.5 text-sm ${view === 'kanban' ? 'bg-accent text-white' : 'bg-surface text-text-muted hover:bg-surface-2'}`}
            data-testid="clients-view-kanban"
          >
            ▦ קנבן
          </button>
        </div>
      </div>

      {/* צ'יפים לסינון לפי שלב */}
      <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="clients-status-filter">
        <button
          onClick={() => setStatusFilter(null)}
          className={`rounded-full px-3 py-1 text-sm ${
            statusFilter === null
              ? 'bg-surface-2 font-medium text-text ring-1 ring-border-light'
              : 'text-text-muted hover:bg-surface-2'
          }`}
          data-testid="status-filter-all"
        >
          הכל ({statusCounts.total})
        </button>
        {statuses.map((s) => {
          const count = statusCounts.byStatus[s.id] || 0
          return (
            <button
              key={s.id}
              onClick={() => setStatusFilter(statusFilter === s.id ? null : s.id)}
              className={`rounded-full px-3 py-1 text-sm font-medium text-white transition-opacity ${
                statusFilter === s.id ? 'ring-2 ring-white/70' : statusFilter ? 'opacity-40 hover:opacity-80' : 'opacity-80 hover:opacity-100'
              }`}
              style={{ backgroundColor: s.color }}
              data-testid={`status-filter-${s.id}`}
            >
              {s.label} ({count})
            </button>
          )
        })}
      </div>

      {/* מיון + סינון לפי עמודה */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="clients-sortfilter">
        {/* מיון */}
        <div className="flex items-center gap-1">
          <label className="flex items-center gap-1" htmlFor="clients-sort-key">
            <span className="text-sm text-text-dim">מיון:</span>
          </label>
          <select
            id="clients-sort-key"
            value={sort.key}
            onChange={(e) => applySort(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text outline-none focus:border-accent"
            data-testid="clients-sort-key"
          >
            {columns.map((col) => (
              <option key={col.key} value={col.key}>
                {col.label}
              </option>
            ))}
          </select>
          <button
            onClick={toggleSortDir}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text-muted hover:text-text"
            title="הפוך את סדר המיון"
            aria-label="הפוך את סדר המיון"
            data-testid="clients-sort-dir"
          >
            {sort.dir === 'asc' ? 'א→ת ▲' : 'ת→א ▼'}
          </button>
          {view === 'list' && sortIsPageLocal && (
            <span className="text-xs text-text-dim" data-testid="clients-sort-page-local-note">
              (מיון בעמוד הנוכחי בלבד)
            </span>
          )}
        </div>

        {/* בונה סינון */}
        <div className="flex flex-wrap items-center gap-1">
          <label className="flex items-center gap-1" htmlFor="clients-filter-key">
            <span className="text-sm text-text-dim">סינון:</span>
          </label>
          <select
            id="clients-filter-key"
            value={draftKey}
            onChange={(e) => {
              setDraftKey(e.target.value)
              setDraftVal('')
            }}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text outline-none focus:border-accent"
            data-testid="clients-filter-key"
          >
            <option value="">בחר עמודה…</option>
            {columns.map((col) => (
              <option key={col.key} value={col.key}>
                {col.label}
              </option>
            ))}
          </select>
          {draftKey &&
            (draftOptions ? (
              <select
                value={draftVal}
                onChange={(e) => setDraftVal(e.target.value)}
                className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text outline-none focus:border-accent"
                data-testid="clients-filter-value"
              >
                <option value="">בחר ערך…</option>
                {draftOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={draftVal}
                onChange={(e) => setDraftVal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addFilter()}
                placeholder="מכיל…"
                className="w-32 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text placeholder:text-text-dim outline-none focus:border-accent"
                data-testid="clients-filter-value"
              />
            ))}
          <button
            onClick={addFilter}
            disabled={!draftKey || draftVal === ''}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-accent hover:bg-surface-2 disabled:opacity-40"
            data-testid="clients-filter-add"
          >
            הוסף
          </button>
          {view === 'list' && filters.length > 0 && (
            <span className="text-xs text-text-dim" data-testid="clients-filter-page-local-note">
              (הסינון חל על העמוד הנוכחי)
            </span>
          )}
        </div>

        {/* צ'יפים של סינונים פעילים */}
        {filters.map((f) => (
          <span
            key={f.key}
            className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-sm text-text ring-1 ring-border-light"
            data-testid={`clients-filter-chip-${f.key}`}
          >
            {describeFilter(f, ctx)}
            <button
              onClick={() => removeFilter(f.key)}
              className="text-text-dim hover:text-status-red"
              title="הסר סינון"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {metaLoading ? (
        <LoadingSpinner label="טוען לקוחות..." />
      ) : view === 'kanban' ? (
        kanbanLoading ? (
          <LoadingSpinner label="טוען לקוחות..." />
        ) : kanbanEmpty ? (
          hasActiveFilters ? (
            <div className="rounded-lg border border-dashed border-border bg-surface/50 p-10 text-center">
              <p className="mb-4 text-text-muted">לא נמצאו לקוחות התואמים את הסינון.</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('')
                  setStatusFilter(null)
                  setFilters([])
                }}
                data-testid="clients-clear-filters"
              >
                נקו סינון
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-surface/50 p-10 text-center">
              <p className="mb-4 text-text-muted">אין עדיין לקוחות.</p>
              <Button onClick={() => setAddOpen(true)} data-testid="clients-empty-add-btn">
                + לקוח חדש
              </Button>
            </div>
          )
        ) : (
          <ClientsKanban
            clients={kanbanSorted}
            statuses={statusFilter ? statuses.filter((s) => s.id === statusFilter) : statuses}
            orgId={orgId}
            onSetStatus={setClientStatus}
          />
        )
      ) : paged.loading ? (
        <ClientsTableSkeleton columns={columns} />
      ) : listEmpty ? (
        hasActiveFilters ? (
          <div className="rounded-lg border border-dashed border-border bg-surface/50 p-10 text-center">
            <p className="mb-4 text-text-muted">לא נמצאו לקוחות התואמים את הסינון.</p>
            <Button
              variant="secondary"
              onClick={() => {
                setSearch('')
                setStatusFilter(null)
                setFilters([])
              }}
              data-testid="clients-clear-filters"
            >
              נקו סינון
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-surface/50 p-10 text-center">
            <p className="mb-4 text-text-muted">אין עדיין לקוחות.</p>
            <Button onClick={() => setAddOpen(true)} data-testid="clients-empty-add-btn">
              + לקוח חדש
            </Button>
          </div>
        )
      ) : (
        <>
          <ClientsTable
            clients={pageFilteredRows}
            columns={columns}
            orgId={orgId}
            statuses={statuses}
            members={members}
            sort={sort}
            onSort={applySort}
            onArchive={archiveClient}
            onSetStatus={setClientStatus}
            onSetField={updateClientField}
            onSetCustomValue={updateClientCustomValue}
          />
          <Pagination
            page={paged.page}
            setPage={paged.setPage}
            pageSize={paged.pageSize}
            setPageSize={paged.setPageSize}
            total={paged.total}
          />
        </>
      )}

      {/* לקוחות מושבתים */}
      {isAdmin && archivedClients.length > 0 && (
        <section className="mt-8" data-testid="clients-archived-section">
          <h2 className="mb-2 text-sm font-semibold text-text-muted">
            לקוחות מושבתים ({archivedClients.length})
          </h2>
          <div className="space-y-1">
            {archivedClients.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-md border border-dashed border-border bg-surface/50 px-3 py-2"
              >
                <span className="text-sm text-text-dim">{c.name}</span>
                <button
                  onClick={() => restoreClient(c)}
                  className="text-sm text-accent hover:underline"
                  data-testid={`client-restore-${c.id}`}
                >
                  שחזר
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* לקוח חדש */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="לקוח חדש" testid="add-client-modal">
        <form onSubmit={handleCreate} onKeyDown={handleEnterAsTab} className="space-y-4">
          <Input
            label="שם הלקוח"
            value={newClient.name}
            onChange={(e) => setNewClient((c) => ({ ...c, name: e.target.value }))}
            placeholder="לדוגמה: חברת אלפא בע״מ"
            required
            autoFocus
            data-testid="client-name-input"
          />
          <Input
            label="טלפון (אופציונלי)"
            type="tel"
            value={newClient.phone}
            onChange={(e) => setNewClient((c) => ({ ...c, phone: e.target.value }))}
            data-testid="client-phone-input"
          />
          <Input
            label="אימייל (אופציונלי)"
            type="email"
            value={newClient.email}
            onChange={(e) => setNewClient((c) => ({ ...c, email: e.target.value }))}
            data-testid="client-email-input"
          />

          <label className="block">
            <span className="mb-1 block text-sm text-text-muted">שלב</span>
            <select
              value={newClient.status_id ?? statuses[0]?.id ?? ''}
              onChange={(e) => setNewClient((c) => ({ ...c, status_id: e.target.value || null }))}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent"
              data-testid="client-status-select"
            >
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          {visibleFields
            .filter((f) => f.type !== 'files')
            .map((field) => (
              <label key={field.id} className="block">
                <span className="mb-1 block text-sm text-text-muted">{field.name}</span>
                <div
                  className="h-9 overflow-hidden rounded-md border border-border"
                  data-testid={`client-field-input-${field.id}`}
                >
                  <BoardCell
                    column={field}
                    item={newClient}
                    orgId={orgId}
                    value={newClient.custom_values?.[field.id]}
                    members={members}
                    canEdit
                    onChange={(v) =>
                      setNewClient((c) => ({
                        ...c,
                        custom_values: { ...(c.custom_values || {}), [field.id]: v },
                      }))
                    }
                  />
                </div>
              </label>
            ))}

          <div className="flex justify-start gap-2">
            <Button
              type="submit"
              disabled={!newClient.name.trim()}
              loading={saving}
              data-testid="client-create-submit"
            >
              צור לקוח
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
              ביטול
            </Button>
          </div>
        </form>
      </Modal>

      {/* ניהול שדות לקוח — שימוש חוזר ברכיבי העמודות של הבורד */}
      <ColumnManagerModal
        open={fieldsManagerOpen}
        onClose={() => setFieldsManagerOpen(false)}
        columns={activeFields}
        archivedColumns={archivedFields}
        onMove={moveField}
        onEdit={(f) => setEditingField(f)}
        onToggleHidden={toggleFieldHidden}
        onArchive={archiveField}
        onRestore={restoreField}
      />
      {fieldsManagerOpen && !addFieldOpen && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <Button onClick={() => setAddFieldOpen(true)} data-testid="clients-add-field-btn">
            + שדה חדש
          </Button>
        </div>
      )}
      <AddColumnModal
        open={addFieldOpen}
        onClose={() => setAddFieldOpen(false)}
        onCreate={addField}
        title="שדה לקוח חדש"
        excludeTypes={['client']}
      />
      <EditColumnModal
        open={Boolean(editingField)}
        column={editingField}
        onClose={() => setEditingField(null)}
        onSave={updateField}
      />

      {/* ייבוא לקוחות מ-CSV */}
      <ImportClientsModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        orgId={orgId}
        statuses={statuses}
        clientFields={activeFields}
        existingCount={statusCounts.grandTotal}
        onImported={() => {
          paged.refetch()
          if (view === 'kanban') setKanbanReload((n) => n + 1)
          loadStatusCounts()
        }}
      />
    </div>
  )
}
