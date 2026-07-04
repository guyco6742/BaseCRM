import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
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
import { handleEnterAsTab } from '../lib/formNav'
import {
  buildColumns,
  sortClients,
  matchesFilters,
  filterOptionsFor,
  describeFilter,
} from '../lib/clientTable'

export default function ClientsPage() {
  const { orgId, isAdmin } = useOrg()
  const [clients, setClients] = useState([])
  const [statuses, setStatuses] = useState([])
  const [fields, setFields] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  // תצוגה: רשימה / קנבן — נשמרת בין ביקורים
  const [view, setView] = useState(() => localStorage.getItem('basecrm.clientsView') || 'list')
  // סינון לפי שלב בפייפליין (null = הכל)
  const [statusFilter, setStatusFilter] = useState(null)
  // מיון: { key, dir } — נשמר בין ביקורים
  const [sort, setSort] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('basecrm.clientsSort')) || { key: 'name', dir: 'asc' }
    } catch {
      return { key: 'name', dir: 'asc' }
    }
  })
  // סינונים לפי עמודה: [{ key, value }] — מצטברים ב"וגם"
  const [filters, setFilters] = useState([])
  // טיוטת בונה הסינון
  const [draftKey, setDraftKey] = useState('')
  const [draftVal, setDraftVal] = useState('')

  // מודלים
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [newClient, setNewClient] = useState({ name: '', phone: '', email: '' })
  const [saving, setSaving] = useState(false)
  const [fieldsManagerOpen, setFieldsManagerOpen] = useState(false)
  const [addFieldOpen, setAddFieldOpen] = useState(false)
  const [editingField, setEditingField] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const [cRes, sRes, fRes, mRes] = await Promise.all([
        supabase
          .from('clients')
          .select('*, contacts(count)')
          .eq('org_id', orgId)
          .eq('contacts.is_archived', false)
          .order('position'),
        supabase.from('client_statuses').select('*').eq('org_id', orgId).order('position'),
        supabase.from('client_fields').select('*').eq('org_id', orgId).order('position'),
        supabase
          .from('memberships')
          .select('user_id, profiles(full_name, email, is_super_admin)')
          .eq('org_id', orgId),
      ])
      if (cRes.error) throw cRes.error
      setClients(cRes.data || [])
      setStatuses((sRes.data || []).filter((s) => !s.is_archived))
      setFields(fRes.data || [])
      // סופר-אדמין שקוף לארגון — לא רלוונטי כאחראי
      setMembers(
        (mRes.data || [])
          .filter((m) => !m.profiles?.is_super_admin)
          .map((m) => ({
            user_id: m.user_id,
            full_name: m.profiles?.full_name,
            email: m.profiles?.email,
          }))
      )
    } catch {
      setError('טעינת הלקוחות נכשלה.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const activeClients = clients.filter((c) => !c.is_archived)
  const archivedClients = clients.filter((c) => c.is_archived)

  // שדות פעילים (לא בארכיון) וגלויים (לא מוסתרים) → עמודות הטבלה
  const activeFields = useMemo(
    () => fields.filter((f) => !f.is_archived).sort((a, b) => a.position - b.position),
    [fields]
  )
  const visibleFields = useMemo(() => activeFields.filter((f) => !f.settings?.hidden), [activeFields])
  const columns = useMemo(() => buildColumns(visibleFields), [visibleFields])
  const ctx = useMemo(() => ({ columns, statuses, members }), [columns, statuses, members])

  // חיפוש + סינון שלב + סינוני עמודה → מיון
  const filtered = activeClients.filter((c) => {
    if (statusFilter && c.status_id !== statusFilter) return false
    if (!matchesFilters(c, filters, ctx)) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return [c.name, c.phone, c.email, c.company_number]
      .filter(Boolean)
      .some((v) => v.toLowerCase().includes(q))
  })
  const sorted = sortClients(filtered, sort, ctx)

  // ---- מיון וסינון (פקדי סרגל הכלים) ----
  function applySort(key) {
    setSort((prev) => {
      const next = prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
      localStorage.setItem('basecrm.clientsSort', JSON.stringify(next))
      return next
    })
  }
  function toggleSortDir() {
    setSort((prev) => {
      const next = { key: prev.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      localStorage.setItem('basecrm.clientsSort', JSON.stringify(next))
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
    localStorage.setItem('basecrm.clientsView', v)
  }

  // שינוי שלב מגרירה בקנבן — עדכון אופטימי
  async function setClientStatus(clientId, statusId) {
    setClients((prev) => prev.map((c) => (c.id === clientId ? { ...c, status_id: statusId } : c)))
    const { error } = await supabase
      .from('clients')
      .update({ status_id: statusId, updated_at: new Date().toISOString() })
      .eq('id', clientId)
    if (error) setError('עדכון השלב נכשל.')
  }

  // ---- לקוחות ----
  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const { error } = await supabase.from('clients').insert({
        org_id: orgId,
        name: newClient.name.trim(),
        phone: newClient.phone.trim() || null,
        email: newClient.email.trim() || null,
        status_id: statuses[0]?.id ?? null, // ברירת מחדל: השלב הראשון בפייפליין
        position: clients.length,
      })
      if (error) throw error
      setAddOpen(false)
      setNewClient({ name: '', phone: '', email: '' })
      await load()
    } catch {
      setError('יצירת הלקוח נכשלה.')
    } finally {
      setSaving(false)
    }
  }

  async function archiveClient(client) {
    if (!window.confirm(`להשבית את הלקוח "${client.name}"? הנתונים יישמרו וניתן לשחזר.`)) return
    await supabase.from('clients').update({ is_archived: true }).eq('id', client.id)
    await load()
  }

  async function restoreClient(client) {
    await supabase.from('clients').update({ is_archived: false }).eq('id', client.id)
    await load()
  }

  // ---- שדות מותאמים ללקוחות (שימוש חוזר במנוע העמודות) ----
  async function addField({ name, type, settings }) {
    const { error } = await supabase.from('client_fields').insert({
      org_id: orgId,
      name,
      type,
      settings,
      position: fields.length,
    })
    if (error) return setError('יצירת השדה נכשלה.')
    setAddFieldOpen(false)
    await load()
  }

  async function updateField(field, { name, settings }) {
    await supabase.from('client_fields').update({ name, settings }).eq('id', field.id)
    await load()
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
    await load()
  }

  async function toggleFieldHidden(field) {
    const newSettings = { ...(field.settings || {}), hidden: !field.settings?.hidden }
    await supabase.from('client_fields').update({ settings: newSettings }).eq('id', field.id)
    await load()
  }

  async function archiveField(field) {
    await supabase.from('client_fields').update({ is_archived: true }).eq('id', field.id)
    await load()
  }

  async function restoreField(field) {
    await supabase.from('client_fields').update({ is_archived: false }).eq('id', field.id)
    await load()
  }

  const archivedFields = fields.filter((f) => f.is_archived)

  return (
    <div className="mx-auto max-w-5xl p-6" data-testid="clients-page">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-text">לקוחות</h1>
        <div className="flex gap-2">
          {isAdmin && (
            <Button variant="ghost" onClick={() => setFieldsManagerOpen(true)} data-testid="clients-fields-btn">
              ⚙ שדות לקוח
            </Button>
          )}
          <Button variant="secondary" onClick={() => setImportOpen(true)} data-testid="clients-import-btn">
            ⬆ ייבוא CSV
          </Button>
          <Button onClick={() => setAddOpen(true)} data-testid="clients-new-btn">
            + לקוח חדש
          </Button>
        </div>
      </div>

      {error && <p className="mb-4 text-status-red">{error}</p>}

      {/* סרגל כלים: חיפוש, החלפת תצוגה וסינון לפי שלב */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש לפי שם, טלפון, אימייל או ח.פ..."
          className="w-full max-w-sm rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-dim outline-none focus:border-accent"
          data-testid="clients-search"
        />

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
          הכל ({activeClients.length})
        </button>
        {statuses.map((s) => {
          const count = activeClients.filter((c) => c.status_id === s.id).length
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
          <span className="text-sm text-text-dim">מיון:</span>
          <select
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
            data-testid="clients-sort-dir"
          >
            {sort.dir === 'asc' ? 'א→ת ▲' : 'ת→א ▼'}
          </button>
        </div>

        {/* בונה סינון */}
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-sm text-text-dim">סינון:</span>
          <select
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

      {loading ? (
        <LoadingSpinner label="טוען לקוחות..." />
      ) : view === 'kanban' ? (
        <ClientsKanban
          clients={sorted}
          statuses={statusFilter ? statuses.filter((s) => s.id === statusFilter) : statuses}
          orgId={orgId}
          onSetStatus={setClientStatus}
        />
      ) : sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface/50 p-10 text-center text-text-muted">
          {search || statusFilter || filters.length
            ? 'לא נמצאו לקוחות התואמים את הסינון.'
            : 'אין עדיין לקוחות. הוסיפו את הראשון!'}
        </div>
      ) : (
        <ClientsTable
          clients={sorted}
          columns={columns}
          orgId={orgId}
          statuses={statuses}
          members={members}
          sort={sort}
          onSort={applySort}
          onArchive={archiveClient}
        />
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
          <div className="flex justify-start gap-2">
            <Button type="submit" disabled={saving || !newClient.name.trim()} data-testid="client-create-submit">
              {saving ? 'יוצר...' : 'צור לקוח'}
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
        existingCount={clients.length}
        onImported={load}
      />
    </div>
  )
}
