import Input from '../ui/Input'
import { LABEL_COLORS } from '../../lib/columnTypes'

// עורך ההגדרות של עמודה לפי סוג (תוויות סטטוס / אפשרויות דרופדאון / יחידת מספר).
// משותף ליצירת עמודה ולעריכתה.
export default function ColumnSettingsEditor({ type, settings, setSettings }) {
  // ----- תוויות סטטוס -----
  const labels = settings.labels || []
  function updateLabel(id, patch) {
    setSettings((s) => ({ ...s, labels: s.labels.map((l) => (l.id === id ? { ...l, ...patch } : l)) }))
  }
  function addLabel() {
    setSettings((s) => ({
      ...s,
      labels: [
        ...(s.labels || []),
        {
          id: crypto.randomUUID(),
          label: 'חדש',
          color: LABEL_COLORS[(s.labels?.length || 0) % LABEL_COLORS.length],
        },
      ],
    }))
  }
  function removeLabel(id) {
    setSettings((s) => ({ ...s, labels: (s.labels || []).filter((l) => l.id !== id) }))
  }

  // ----- אפשרויות דרופדאון -----
  const options = settings.options || []
  function updateOption(id, label) {
    setSettings((s) => ({ ...s, options: s.options.map((o) => (o.id === id ? { ...o, label } : o)) }))
  }
  function addOption() {
    setSettings((s) => ({
      ...s,
      options: [...(s.options || []), { id: crypto.randomUUID(), label: 'אפשרות' }],
    }))
  }
  function removeOption(id) {
    setSettings((s) => ({ ...s, options: (s.options || []).filter((o) => o.id !== id) }))
  }

  if (type === 'status') {
    return (
      <div>
        <span className="mb-1 block text-sm text-text-muted">תוויות סטטוס וצבעים</span>
        <div className="space-y-2">
          {labels.map((l) => (
            <div key={l.id} className="flex items-center gap-2">
              <input
                value={l.label}
                onChange={(e) => updateLabel(l.id, { label: e.target.value })}
                className="flex-1 rounded-md border border-border bg-bg px-2 py-1 text-sm text-text outline-none focus:border-accent"
              />
              <div className="flex gap-1">
                {LABEL_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => updateLabel(l.id, { color: c })}
                    className={`h-5 w-5 rounded-full ${l.color === c ? 'ring-2 ring-white' : ''}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => removeLabel(l.id)}
                className="text-text-dim hover:text-status-red"
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" onClick={addLabel} className="text-sm text-accent hover:underline">
            + הוסף תווית
          </button>
        </div>
      </div>
    )
  }

  if (type === 'dropdown') {
    return (
      <div>
        <span className="mb-1 block text-sm text-text-muted">אפשרויות</span>
        <div className="space-y-2">
          {options.map((o) => (
            <div key={o.id} className="flex items-center gap-2">
              <input
                value={o.label}
                onChange={(e) => updateOption(o.id, e.target.value)}
                className="flex-1 rounded-md border border-border bg-bg px-2 py-1 text-sm text-text outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => removeOption(o.id)}
                className="text-text-dim hover:text-status-red"
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" onClick={addOption} className="text-sm text-accent hover:underline">
            + הוסף אפשרות
          </button>
        </div>
      </div>
    )
  }

  if (type === 'number') {
    return (
      <Input
        label="יחידה (אופציונלי)"
        value={settings.unit || ''}
        onChange={(e) => setSettings((s) => ({ ...s, unit: e.target.value }))}
        placeholder="₪, ק״ג, שעות..."
      />
    )
  }

  return null
}

// האם לסוג העמודה יש הגדרות שניתן לערוך
export function hasEditableSettings(type) {
  return type === 'status' || type === 'dropdown' || type === 'number'
}
