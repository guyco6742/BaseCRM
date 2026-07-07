import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatDateTime } from '../../lib/columnTypes'
import { useConfirm } from '../../context/ConfirmContext'
import { useToast } from '../../context/ToastContext'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import { handleEnterAsTab } from '../../lib/formNav'

const SOURCE_TYPES = {
  facebook: { label: 'פייסבוק (Lead Ads)', icon: '📘' },
  webhook: { label: 'Webhook כללי (אתר / דף נחיתה)', icon: '🔗' },
  other: { label: 'אחר', icon: '📥' },
}

// שורת העתקה עם כפתור
function CopyRow({ label, value, testid }) {
  const [copied, setCopied] = useState(false)
  return (
    <div>
      <span className="mb-1 block text-xs text-text-dim">{label}</span>
      <div className="flex gap-2">
        <input
          readOnly
          value={value}
          dir="ltr"
          onFocus={(e) => e.target.select()}
          className="flex-1 truncate rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text-muted"
          data-testid={testid}
        />
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="shrink-0 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-text hover:bg-border"
        >
          {copied ? 'הועתק ✓' : 'העתק'}
        </button>
      </div>
    </div>
  )
}

// ניהול מקורות לידים של הארגון (אדמין) — מוצג בהגדרות הארגון
export default function LeadSourcesManager({ orgId }) {
  const confirm = useConfirm()
  const { toast } = useToast()
  const [sources, setSources] = useState([])
  const [recentLeads, setRecentLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('facebook')
  const [saving, setSaving] = useState(false)
  const [connectSource, setConnectSource] = useState(null) // מקור שמציגים עבורו הוראות חיבור

  async function load() {
    const [sRes, lRes] = await Promise.all([
      supabase
        .from('lead_sources')
        .select('*, leads(count)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false }),
      supabase
        .from('leads')
        .select('*, lead_sources:source_id(name)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(10),
    ])
    if (sRes.error) {
      setError('טעינת מקורות הלידים נכשלה (ודאו שמיגרציית הלידים רצה).')
    } else {
      setSources(sRes.data || [])
      setRecentLeads(lRes.data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  async function addSource(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const { data, error } = await supabase
        .from('lead_sources')
        .insert({ org_id: orgId, name: newName.trim(), source_type: newType })
        .select()
        .single()
      if (error) throw error
      setAddOpen(false)
      setNewName('')
      await load()
      setConnectSource(data) // פותחים מיד את הוראות החיבור
      toast('המקור נוצר בהצלחה')
    } catch {
      setError('יצירת המקור נכשלה.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(src) {
    const { error } = await supabase.from('lead_sources').update({ is_active: !src.is_active }).eq('id', src.id)
    if (error) {
      toast('עדכון המקור נכשל.', 'error')
      return
    }
    await load()
  }

  async function archiveSource(src) {
    const ok = await confirm({
      title: 'השבתת מקור לידים',
      message: `להשבית את המקור "${src.name}"? לידים חדשים ממנו יידחו.`,
      confirmText: 'השבתה',
      danger: true,
    })
    if (!ok) return
    const { error } = await supabase
      .from('lead_sources')
      .update({ is_archived: true, is_active: false })
      .eq('id', src.id)
    if (error) {
      toast('השבתת המקור נכשלה.', 'error')
      return
    }
    await load()
    toast('המקור הושבת בהצלחה')
  }

  const supaUrl = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  const endpoint = `${supaUrl}/rest/v1/rpc/ingest_lead`

  const activeSources = sources.filter((s) => !s.is_archived)

  if (loading) return null

  return (
    <section className="mb-8" data-testid="lead-sources-manager">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text">קליטת לידים (פייסבוק ועוד)</h2>
          <p className="text-xs text-text-dim">
            כל מקור מקבל כתובת + מפתח סודי. לידים נכנסים הופכים אוטומטית ללקוחות בשלב הראשון בפייפליין.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)} data-testid="lead-source-add-btn">
          + מקור לידים
        </Button>
      </div>

      {error && <p className="mb-2 text-sm text-status-red">{error}</p>}

      {activeSources.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface/50 p-6 text-center">
          <p className="mb-4 text-sm text-text-muted">
            אין עדיין מקורות לידים. צרו מקור ראשון — למשל "פייסבוק - קמפיין ראשי".
          </p>
          <Button size="sm" onClick={() => setAddOpen(true)} data-testid="lead-source-empty-add-btn">
            + מקור לידים
          </Button>
        </div>
      ) : (
        <div className="space-y-1">
          {activeSources.map((src) => (
            <div
              key={src.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 py-2"
              data-testid={`lead-source-${src.id}`}
            >
              <div className="flex items-center gap-2">
                <span>{SOURCE_TYPES[src.source_type]?.icon ?? '📥'}</span>
                <div>
                  <span className="text-sm font-medium text-text">{src.name}</span>
                  <span className="mr-2 text-xs text-text-dim">
                    {src.leads?.[0]?.count ?? 0} לידים התקבלו
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {/* מתג פעיל/כבוי */}
                <button
                  onClick={() => toggleActive(src)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    src.is_active ? 'bg-status-green/20 text-status-green' : 'bg-surface-2 text-text-dim'
                  }`}
                  title={src.is_active ? 'לחצו לכיבוי הקליטה' : 'לחצו להפעלה'}
                  data-testid={`lead-source-toggle-${src.id}`}
                >
                  {src.is_active ? '● פעיל' : '○ כבוי'}
                </button>
                <button
                  onClick={() => setConnectSource(src)}
                  className="text-sm text-accent hover:underline"
                  data-testid={`lead-source-connect-${src.id}`}
                >
                  הוראות חיבור
                </button>
                <button
                  onClick={() => archiveSource(src)}
                  className="text-text-dim hover:text-status-red"
                  title="השבת מקור"
                  data-testid={`lead-source-archive-${src.id}`}
                >
                  🗄
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* לידים אחרונים */}
      {recentLeads.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-1 text-xs font-semibold text-text-dim">לידים אחרונים</h4>
          <div className="space-y-1">
            {recentLeads.map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between rounded-md bg-surface/60 px-3 py-1.5 text-sm"
                data-testid={`lead-row-${l.id}`}
              >
                <span className="flex items-center gap-2 truncate">
                  {l.client_id ? (
                    <Link to={`/org/${orgId}/clients/${l.client_id}`} className="truncate text-text hover:text-accent">
                      {l.name || l.email || l.phone || 'ליד'}
                    </Link>
                  ) : (
                    <span className="truncate text-text">{l.name || l.email || l.phone || 'ליד'}</span>
                  )}
                  {l.deduped && (
                    <span className="rounded bg-status-orange/20 px-1.5 text-xs text-status-orange" title="חובר ללקוח קיים">
                      כפילות
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-text-dim">
                  {l.lead_sources?.name} · {formatDateTime(l.created_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* מקור חדש */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="מקור לידים חדש" testid="add-lead-source-modal">
        <form onSubmit={addSource} onKeyDown={handleEnterAsTab} className="space-y-4">
          <Input
            label="שם המקור"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder='לדוגמה: פייסבוק - קמפיין ראשי'
            required
            autoFocus
            data-testid="lead-source-name-input"
          />
          <label className="block">
            <span className="mb-1 block text-sm text-text-muted">סוג</span>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text outline-none focus:border-accent"
              data-testid="lead-source-type-select"
            >
              {Object.entries(SOURCE_TYPES).map(([value, t]) => (
                <option key={value} value={value}>
                  {t.icon} {t.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-start gap-2">
            <Button
              type="submit"
              disabled={!newName.trim()}
              loading={saving}
              data-testid="lead-source-create-submit"
            >
              צור מקור
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
              ביטול
            </Button>
          </div>
        </form>
      </Modal>

      {/* הוראות חיבור */}
      <Modal
        open={Boolean(connectSource)}
        onClose={() => setConnectSource(null)}
        title={`חיבור: ${connectSource?.name ?? ''}`}
        size="xl"
        testid="lead-source-connect-modal"
      >
        {connectSource && (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-bg p-3 text-sm text-text-muted">
              <b className="text-text">איך מחברים את פייסבוק?</b>
              <ol className="mt-1 list-decimal space-y-1 pr-5 text-xs">
                <li>פתחו חשבון ב-Zapier או Make (מחברים בין פייסבוק לכל מערכת).</li>
                <li>צרו אוטומציה: טריגר = "Facebook Lead Ads – New Lead".</li>
                <li>פעולה = "Webhooks – POST" עם הפרטים שלמטה (מפו את שם/טלפון/אימייל מהליד).</li>
                <li>אותם פרטים עובדים גם לטופס באתר, דף נחיתה, או כל מערכת ששולחת Webhook.</li>
              </ol>
            </div>

            <CopyRow label="כתובת (URL) — שיטת POST" value={endpoint} testid="connect-url" />
            <CopyRow label="Header: apikey" value={anonKey} testid="connect-apikey" />
            <CopyRow label="Header: Content-Type" value="application/json" />
            <CopyRow
              label="גוף הבקשה (Body — JSON)"
              value={JSON.stringify({
                p_token: connectSource.token,
                p_payload: { name: '{{שם}}', phone: '{{טלפון}}', email: '{{אימייל}}' },
              })}
              testid="connect-body"
            />

            <p className="text-xs text-text-dim">
              שדות נתמכים ב-p_payload: name / full_name / first_name+last_name / שם · phone / phone_number / טלפון ·
              email / אימייל. כל שדה נוסף נשמר ביומן הלידים. ליד עם אימייל או טלפון של לקוח קיים יחובר אליו
              אוטומטית (ללא כפילות). המפתח (p_token) הוא סודי — שתפו אותו רק עם מי שמחבר את המערכת.
            </p>
          </div>
        )}
      </Modal>
    </section>
  )
}
