import { useEffect, useState } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import Input from '../ui/Input'
import ColumnSettingsEditor from './ColumnSettingsEditor'
import { COLUMN_TYPES } from '../../lib/columnTypes'
import { handleEnterAsTab } from '../../lib/formNav'

// עריכת עמודה קיימת: שם + הגדרות (תוויות/צבעים לסטטוס, אפשרויות לדרופדאון, יחידה למספר)
export default function EditColumnModal({ open, column, onClose, onSave }) {
  const [name, setName] = useState('')
  const [settings, setSettings] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (column) {
      setName(column.name)
      setSettings(column.settings || {})
    }
  }, [column])

  if (!column) return null

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    await onSave(column, { name: name.trim(), settings })
    setSaving(false)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`עריכת עמודה — ${COLUMN_TYPES[column.type]?.label}`}
      size="lg"
      testid="edit-column-modal"
    >
      <form onSubmit={handleSubmit} onKeyDown={handleEnterAsTab} className="space-y-4">
        <Input
          label="שם העמודה"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
          data-testid="edit-column-name"
        />

        <ColumnSettingsEditor type={column.type} settings={settings} setSettings={setSettings} />

        <div className="flex justify-start gap-2 border-t border-border pt-3">
          <Button type="submit" disabled={saving || !name.trim()} data-testid="edit-column-save">
            {saving ? 'שומר...' : 'שמירה'}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            ביטול
          </Button>
        </div>
      </form>
    </Modal>
  )
}
