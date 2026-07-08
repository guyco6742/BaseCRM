import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { useConfirm } from '../context/ConfirmContext'
import { useToast } from '../context/ToastContext'
import { useTitle } from '../lib/useTitle'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import Avatar from '../components/ui/Avatar'
import BoardCell from '../components/board/BoardCell'
import PaymentsSection from '../components/crm/PaymentsSection'
import { formatDateTime } from '../lib/columnTypes'
import { handleEnterAsTab } from '../lib/formNav'

// שדה בסיס בכרטיס לקוח — טיוטה מקומית, נשמר בעזיבת השדה
function EditableField({ label, value, onSave, type = 'text', textarea = false, testid, dir }) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => {
    setDraft(value ?? '')
  }, [value])

  function commit() {
    if ((draft ?? '') !== (value ?? '')) onSave(draft.trim() || null)
  }

  const cls =
    'w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-dim outline-none focus:border-accent'

  return (
    <label className="block">
      <span className="mb-1 block text-xs text-text-dim">{label}</span>
      {textarea ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          rows={3}
          className={cls}
          data-testid={testid}
        />
      ) : (
        <input
          type={type}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className={cls}
          data-testid={testid}
          dir={dir}
        />
      )}
    </label>
  )
}

export default function ClientPage() {
  const { clientId } = useParams()
  const { orgId, isAdmin, members: orgMembers } = useOrg()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { toast } = useToast()

  const [client, setClient] = useState(null)
  const [statuses, setStatuses] = useState([])
  const [fields, setFields] = useState([])
  const [contacts, setContacts] = useState([])
  const [linkedItems, setLinkedItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [contactModalOpen, setContactModalOpen] = useState(false)
  const [editingContact, setEditingContact] = useState(null)
  const [contactDraft, setContactDraft] = useState({ name: '', role: '', phone: '', email: '' })
  const [savingContact, setSavingContact] = useState(false)
  const [archivingClient, setArchivingClient] = useState(false)

  useTitle(client?.name)

  async function load() {
    setLoading(true)
    try {
      const [cRes, sRes, fRes, ctRes] = await Promise.all([
        supabase.from('clients').select('*').eq('id', clientId).maybeSingle(),
        supabase.from('client_statuses').select('*').eq('org_id', orgId).eq('is_archived', false).order('position'),
        supabase.from('client_fields').select('*').eq('org_id', orgId).eq('is_archived', false).order('position'),
        supabase.from('contacts').select('*').eq('client_id', clientId).eq('is_archived', false).order('position'),
      ])
      if (cRes.error || !cRes.data) throw cRes.error || new Error('not found')
      setClient(cRes.data)
      setStatuses(sRes.data || [])
      setFields(fRes.data || [])
      setContacts(ctRes.data || [])

      // משימות מקושרות — פריטים שבעמודת "לקוח" שלהם מופיע הלקוח הזה
      const { data: clientCols } = await supabase
        .from('columns')
        .select('id')
        .eq('org_id', orgId)
        .eq('type', 'client')
        .eq('is_archived', false)

      let linked = []
      if (clientCols?.length) {
        const orExpr = clientCols.map((c) => `values->>${c.id}.eq.${clientId}`).join(',')
        const { data, error: orError } = await supabase
          .from('items')
          .select('id, name, board_id, created_at, boards(name)')
          .eq('org_id', orgId)
          .eq('is_archived', false)
          .or(orExpr)
        if (!orError) {
          linked = data || []
        } else {
          // fallback: התנהגות קודמת (שאילתה לכל עמודה) אם ה-or נכשל
          const results = await Promise.all(
            clientCols.map((col) =>
              supabase
                .from('items')
                .select('id, name, board_id, created_at, boards(name)')
                .eq('org_id', orgId)
                .eq('is_archived', false)
                .contains('values', { [col.id]: clientId })
            )
          )
          linked = results.flatMap((r) => r.data || [])
        }
      }
      const merged = new Map()
      linked.forEach((it) => merged.set(it.id, it))
      setLinkedItems([...merged.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)))
    } catch {
      setError('טעינת הלקוח נכשלה.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, orgId])

  // סופר-אדמין שקוף לארגון — לא מופיע כבחירה ב"אחראי לקוח"
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

  // עדכון שדה בלקוח (בסיס או סטטוס/אחראי)
  async function patchClient(patch) {
    setClient((c) => ({ ...c, ...patch }))
    const { error } = await supabase
      .from('clients')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', clientId)
    if (error) {
      setError('שמירת השינוי נכשלה.')
      toast('שמירת השינוי נכשלה', 'error')
    }
  }

  // עדכון ערך של שדה מותאם
  async function patchCustomValue(fieldId, value) {
    const newValues = { ...(client.custom_values || {}), [fieldId]: value }
    await patchClient({ custom_values: newValues })
  }

  // ---- אנשי קשר ----
  function openAddContact() {
    setEditingContact(null)
    setContactDraft({ name: '', role: '', phone: '', email: '' })
    setContactModalOpen(true)
  }

  function openEditContact(ct) {
    setEditingContact(ct)
    setContactDraft({ name: ct.name, role: ct.role || '', phone: ct.phone || '', email: ct.email || '' })
    setContactModalOpen(true)
  }

  async function saveContact(e) {
    e.preventDefault()
    setSavingContact(true)
    try {
      const payload = {
        name: contactDraft.name.trim(),
        role: contactDraft.role.trim() || null,
        phone: contactDraft.phone.trim() || null,
        email: contactDraft.email.trim() || null,
      }
      if (editingContact) {
        const { error } = await supabase.from('contacts').update(payload).eq('id', editingContact.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('contacts').insert({
          ...payload,
          org_id: orgId,
          client_id: clientId,
          position: contacts.length,
        })
        if (error) throw error
      }
      setContactModalOpen(false)
      toast(editingContact ? 'איש הקשר עודכן בהצלחה' : 'איש הקשר נוסף בהצלחה')
      await load()
    } catch {
      setError('שמירת איש הקשר נכשלה.')
    } finally {
      setSavingContact(false)
    }
  }

  async function archiveContact(ct) {
    const ok = await confirm({
      title: 'השבתת איש קשר',
      message: `להשבית את איש הקשר "${ct.name}"?`,
      confirmText: 'השבתה',
      danger: true,
    })
    if (!ok) return
    const { error } = await supabase.from('contacts').update({ is_archived: true }).eq('id', ct.id)
    if (error) {
      toast('השבתת איש הקשר נכשלה', 'error')
      return
    }
    toast('איש הקשר הושבת בהצלחה')
    await load()
  }

  async function archiveClient() {
    const ok = await confirm({
      title: 'השבתת לקוח',
      message: `להשבית את הלקוח "${client.name}"? הנתונים יישמרו וניתן לשחזר.`,
      confirmText: 'השבתה',
      danger: true,
    })
    if (!ok) return
    setArchivingClient(true)
    const { error } = await supabase.from('clients').update({ is_archived: true }).eq('id', clientId)
    if (error) {
      toast('השבתת הלקוח נכשלה', 'error')
      setArchivingClient(false)
      return
    }
    toast('הלקוח הושבת בהצלחה')
    navigate(`/org/${orgId}/clients`)
  }

  if (loading) return <LoadingSpinner label="טוען כרטיס לקוח..." />
  if (!client) {
    return (
      <div className="p-6 text-center text-text-muted">
        הלקוח לא נמצא.{' '}
        <Link to={`/org/${orgId}/clients`} className="text-accent hover:underline">
          חזרה לרשימת הלקוחות
        </Link>
      </div>
    )
  }

  const owner = members.find((m) => m.user_id === client.owner_id)
  const visibleFields = fields.filter((f) => !f.settings?.hidden)

  return (
    <div className="mx-auto max-w-5xl p-6" data-testid="client-page">
      {/* כותרת */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={`/org/${orgId}/clients`} className="text-xs text-text-dim hover:text-text-muted">
            → כל הלקוחות
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-text" data-testid="client-title">
            {client.name}
          </h1>
          <p className="mt-1 text-xs text-text-dim">נוצר: {formatDateTime(client.created_at)}</p>
        </div>
        {isAdmin && (
          <Button variant="ghost" onClick={archiveClient} loading={archivingClient} data-testid="client-archive-btn">
            <span className="text-status-orange">השבת לקוח</span>
          </Button>
        )}
      </div>

      {error && <p className="mb-4 text-status-red">{error}</p>}

      {/* פייפליין סטטוסים */}
      <div className="mb-6 rounded-lg border border-border bg-surface p-4" data-testid="client-pipeline">
        <span className="mb-2 block text-xs text-text-dim">סטטוס בפייפליין</span>
        <div className="flex flex-wrap gap-2">
          {statuses.map((s) => (
            <button
              key={s.id}
              onClick={() => patchClient({ status_id: s.id })}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-all ${
                client.status_id === s.id
                  ? 'text-white ring-2 ring-white/60'
                  : 'text-white/80 opacity-50 hover:opacity-90'
              }`}
              style={{ backgroundColor: s.color }}
              data-testid={`client-status-${s.id}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* פרטי בסיס */}
        <section
          className="rounded-lg border border-border bg-surface p-4"
          data-testid="client-base-fields"
          onKeyDown={handleEnterAsTab}
        >
          <h2 className="mb-3 text-lg font-semibold text-text">פרטי הלקוח</h2>
          <div className="space-y-3">
            <EditableField
              label="שם הלקוח"
              value={client.name}
              onSave={(v) => v && patchClient({ name: v })}
              testid="client-field-name"
            />
            <div className="grid grid-cols-2 gap-3">
              <EditableField
                label="ח.פ / ע.מ"
                value={client.company_number}
                onSave={(v) => patchClient({ company_number: v })}
                testid="client-field-company-number"
                dir="ltr"
              />
              <EditableField
                label="טלפון"
                type="tel"
                value={client.phone}
                onSave={(v) => patchClient({ phone: v })}
                testid="client-field-phone"
                dir="ltr"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <EditableField
                label="אימייל"
                type="email"
                value={client.email}
                onSave={(v) => patchClient({ email: v })}
                testid="client-field-email"
                dir="ltr"
              />
              <EditableField
                label="אתר"
                type="url"
                value={client.website}
                onSave={(v) => patchClient({ website: v })}
                testid="client-field-website"
                dir="ltr"
              />
            </div>
            <EditableField
              label="כתובת"
              value={client.address}
              onSave={(v) => patchClient({ address: v })}
              testid="client-field-address"
            />
            <EditableField
              label="הערות"
              value={client.notes}
              onSave={(v) => patchClient({ notes: v })}
              textarea
              testid="client-field-notes"
            />

            {/* אחראי לקוח */}
            <label className="block">
              <span className="mb-1 block text-xs text-text-dim">אחראי לקוח</span>
              <select
                value={client.owner_id || ''}
                onChange={(e) => patchClient({ owner_id: e.target.value || null })}
                className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent"
                data-testid="client-owner-select"
              >
                <option value="">ללא</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name || m.email}
                  </option>
                ))}
              </select>
            </label>
            {owner && (
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <Avatar name={owner.full_name} email={owner.email} size={24} />
                {owner.full_name || owner.email}
              </div>
            )}
          </div>

          {/* שדות מותאמים */}
          {visibleFields.length > 0 && (
            <div className="mt-5 border-t border-border pt-4">
              <h3 className="mb-3 text-sm font-semibold text-text-muted">שדות נוספים</h3>
              <div className="space-y-2">
                {visibleFields.map((f) => (
                  <div key={f.id} className="grid grid-cols-[1fr_2fr] items-center gap-2">
                    <span className="text-sm text-text-dim">{f.name}</span>
                    <div
                      className="h-9 overflow-hidden rounded-md border border-border bg-bg"
                      data-testid={`client-custom-field-${f.id}`}
                    >
                      <BoardCell
                        column={f}
                        item={client}
                        orgId={orgId}
                        value={client.custom_values?.[f.id]}
                        members={members}
                        canEdit={true}
                        onChange={(v) => patchCustomValue(f.id, v)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <div className="space-y-6">
          {/* אנשי קשר */}
          <section className="rounded-lg border border-border bg-surface p-4" data-testid="client-contacts">
            {/* איש קשר ראשי — ברירת מחדל: הלקוח עצמו */}
            <div className="mb-4 border-b border-border pb-4" data-testid="primary-contact">
              <label className="flex items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  checked={client.contact_is_self}
                  onChange={(e) => patchClient({ contact_is_self: e.target.checked })}
                  className="h-4 w-4 accent-[var(--color-accent)]"
                  data-testid="primary-contact-is-self"
                />
                איש הקשר הוא הלקוח עצמו
              </label>

              {client.contact_is_self ? (
                <div
                  className="mt-2 rounded-md bg-bg px-3 py-2 text-sm text-text-muted"
                  data-testid="primary-contact-self-summary"
                >
                  <div>{client.name}</div>
                  {client.phone && <div dir="ltr">{client.phone}</div>}
                  {client.email && <div dir="ltr">{client.email}</div>}
                </div>
              ) : (
                <div className="mt-3 space-y-3" onKeyDown={handleEnterAsTab}>
                  <EditableField
                    label="שם איש הקשר"
                    value={client.contact_name}
                    onSave={(v) => patchClient({ contact_name: v })}
                    testid="primary-contact-name"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <EditableField
                      label="תפקיד"
                      value={client.contact_role}
                      onSave={(v) => patchClient({ contact_role: v })}
                      testid="primary-contact-role"
                    />
                    <EditableField
                      label="טלפון"
                      type="tel"
                      value={client.contact_phone}
                      onSave={(v) => patchClient({ contact_phone: v })}
                      testid="primary-contact-phone"
                      dir="ltr"
                    />
                  </div>
                  <EditableField
                    label="אימייל"
                    type="email"
                    value={client.contact_email}
                    onSave={(v) => patchClient({ contact_email: v })}
                    testid="primary-contact-email"
                    dir="ltr"
                  />
                </div>
              )}
            </div>

            {/* אנשי קשר נוספים */}
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text">אנשי קשר נוספים ({contacts.length})</h2>
              <Button size="sm" variant="secondary" onClick={openAddContact} data-testid="contact-add-btn">
                + איש קשר
              </Button>
            </div>
            {contacts.length === 0 ? (
              <p className="py-4 text-center text-sm text-text-dim">אין עדיין אנשי קשר.</p>
            ) : (
              <div className="space-y-2">
                {contacts.map((ct) => (
                  <div
                    key={ct.id}
                    className="flex items-start justify-between rounded-md border border-border bg-bg p-3"
                    data-testid={`contact-row-${ct.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar name={ct.name} size={32} />
                      <div>
                        <div className="font-medium text-text">
                          {ct.name}
                          {ct.role && <span className="mr-2 text-xs text-text-dim">({ct.role})</span>}
                        </div>
                        <div className="mt-0.5 space-x-3 text-xs text-text-muted" dir="ltr">
                          {ct.phone && (
                            <a href={`tel:${ct.phone}`} className="hover:text-accent">
                              {ct.phone}
                            </a>
                          )}
                          {ct.email && (
                            <a href={`mailto:${ct.email}`} className="hover:text-accent">
                              {ct.email}
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 text-xs">
                      <button
                        onClick={() => openEditContact(ct)}
                        className="text-text-dim hover:text-text"
                        data-testid={`contact-edit-${ct.id}`}
                      >
                        עריכה
                      </button>
                      <button
                        onClick={() => archiveContact(ct)}
                        className="text-text-dim hover:text-status-red"
                        data-testid={`contact-archive-${ct.id}`}
                      >
                        השבת
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <PaymentsSection orgId={orgId} clientId={clientId} clientPhone={client.phone} clientName={client.name} />

          {/* משימות מקושרות */}
          <section className="rounded-lg border border-border bg-surface p-4" data-testid="client-linked-tasks">
            <h2 className="mb-3 text-lg font-semibold text-text">
              משימות מקושרות ({linkedItems.length})
            </h2>
            {linkedItems.length === 0 ? (
              <p className="py-4 text-center text-sm text-text-dim">
                אין משימות מקושרות. הוסיפו עמודת "לקוח (CRM)" לבורד ובחרו את הלקוח הזה.
              </p>
            ) : (
              <div className="space-y-1.5">
                {linkedItems.map((it) => (
                  <Link
                    key={it.id}
                    to={`/org/${orgId}/board/${it.board_id}`}
                    className="flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2 hover:border-accent"
                    data-testid={`linked-item-${it.id}`}
                  >
                    <span className="truncate text-sm text-text">{it.name || 'פריט ללא שם'}</span>
                    <span className="mr-2 shrink-0 text-xs text-text-dim">
                      {it.boards?.name} · {formatDateTime(it.created_at).split(',')[1] || formatDateTime(it.created_at)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* מודל איש קשר */}
      <Modal
        open={contactModalOpen}
        onClose={() => setContactModalOpen(false)}
        title={editingContact ? 'עריכת איש קשר' : 'איש קשר חדש'}
        testid="contact-modal"
      >
        <form onSubmit={saveContact} onKeyDown={handleEnterAsTab} className="space-y-4">
          <Input
            label="שם"
            value={contactDraft.name}
            onChange={(e) => setContactDraft((d) => ({ ...d, name: e.target.value }))}
            required
            autoFocus
            data-testid="contact-name-input"
          />
          <Input
            label="תפקיד (אופציונלי)"
            value={contactDraft.role}
            onChange={(e) => setContactDraft((d) => ({ ...d, role: e.target.value }))}
            placeholder="מנכ״ל, מנהלת כספים..."
            data-testid="contact-role-input"
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="טלפון"
              type="tel"
              value={contactDraft.phone}
              onChange={(e) => setContactDraft((d) => ({ ...d, phone: e.target.value }))}
              data-testid="contact-phone-input"
            />
            <Input
              label="אימייל"
              type="email"
              value={contactDraft.email}
              onChange={(e) => setContactDraft((d) => ({ ...d, email: e.target.value }))}
              data-testid="contact-email-input"
            />
          </div>
          <div className="flex justify-start gap-2">
            <Button
              type="submit"
              disabled={!contactDraft.name.trim()}
              loading={savingContact}
              data-testid="contact-save-btn"
            >
              שמירה
            </Button>
            <Button type="button" variant="ghost" onClick={() => setContactModalOpen(false)}>
              ביטול
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
