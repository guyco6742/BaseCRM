import { useState } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import Input from '../ui/Input'
import { COLUMN_TYPE_LIST, COLUMN_TYPES, defaultSettings } from '../../lib/columnTypes'
import ColumnSettingsEditor from './ColumnSettingsEditor'
import { handleEnterAsTab } from '../../lib/formNav'

export default function AddColumnModal({ open, onClose, onCreate, title = 'עמודה חדשה', excludeTypes = [] }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('text')
  const [settings, setSettings] = useState({})
  const [saving, setSaving] = useState(false)

  const typeList = COLUMN_TYPE_LIST.filter((t) => !excludeTypes.includes(t.value))

  function pickType(t) {
    setType(t)
    setSettings(defaultSettings(t))
    if (!name.trim()) setName(COLUMN_TYPES[t].label)
  }

  function reset() {
    setName('')
    setType('text')
    setSettings({})
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    await onCreate({ name: name.trim(), type, settings })
    setSaving(false)
    reset()
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg" testid="add-column-modal">
      <form onSubmit={handleSubmit} onKeyDown={handleEnterAsTab} className="space-y-4">
        <Input
          label="שם העמודה"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
          data-testid="add-column-name"
        />

        <div>
          <span className="mb-1 block text-sm text-text-muted">סוג</span>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {typeList.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => pickType(t.value)}
                data-testid={`add-column-type-${t.value}`}
                className={`flex flex-col items-center gap-1 rounded-md border p-2 text-xs ${
                  type === t.value
                    ? 'border-accent bg-accent/10 text-text'
                    : 'border-border bg-bg text-text-muted hover:border-border-light'
                }`}
              >
                <span className="text-base">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* הגדרות לפי סוג */}
        <ColumnSettingsEditor type={type} settings={settings} setSettings={setSettings} />

        <div className="flex justify-start gap-2 border-t border-border pt-3">
          <Button type="submit" disabled={saving || !name.trim()} data-testid="add-column-submit">
            {saving ? 'יוצר...' : 'צור עמודה'}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            ביטול
          </Button>
        </div>
      </form>
    </Modal>
  )
}
