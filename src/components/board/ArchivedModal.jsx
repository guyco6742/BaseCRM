import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../ui/Modal'
import LoadingSpinner from '../ui/LoadingSpinner'

// חלון "מושבתים" — הצגת קבוצות ופריטים מושבתים ושחזורם
export default function ArchivedModal({ open, onClose, boardId, onRestored }) {
  const [groups, setGroups] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const [gRes, iRes] = await Promise.all([
      supabase.from('groups').select('*').eq('board_id', boardId).eq('is_archived', true),
      supabase.from('items').select('*').eq('board_id', boardId).eq('is_archived', true),
    ])
    setGroups(gRes.data || [])
    setItems(iRes.data || [])
    setLoading(false)
  }

  useEffect(() => {
    if (open) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, boardId])

  async function restoreGroup(g) {
    await supabase.from('groups').update({ is_archived: false }).eq('id', g.id)
    await load()
    onRestored?.()
  }

  async function restoreItem(it) {
    await supabase.from('items').update({ is_archived: false }).eq('id', it.id)
    await load()
    onRestored?.()
  }

  return (
    <Modal open={open} onClose={onClose} title="פריטים וקבוצות מושבתים" size="md" testid="archived-modal">
      {loading ? (
        <LoadingSpinner label="טוען..." />
      ) : groups.length === 0 && items.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-dim">אין פריטים או קבוצות מושבתים.</p>
      ) : (
        <div className="space-y-5">
          {groups.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-text-muted">
                קבוצות מושבתות ({groups.length})
              </h4>
              <div className="space-y-1">
                {groups.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-center justify-between rounded-md border border-dashed border-border bg-bg/50 px-3 py-1.5"
                  >
                    <span className="flex items-center gap-2 text-sm text-text-dim">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: g.color }} />
                      {g.name}
                    </span>
                    <button
                      onClick={() => restoreGroup(g)}
                      className="text-sm text-accent hover:underline"
                      data-testid={`restore-group-${g.id}`}
                    >
                      שחזר
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-xs text-text-dim">
                שחזור קבוצה יחזיר גם את הפריטים שהיו בה ולא הושבתו בנפרד.
              </p>
            </div>
          )}

          {items.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-text-muted">
                פריטים מושבתים ({items.length})
              </h4>
              <div className="space-y-1">
                {items.map((it) => (
                  <div
                    key={it.id}
                    className="flex items-center justify-between rounded-md border border-dashed border-border bg-bg/50 px-3 py-1.5"
                  >
                    <span className="truncate text-sm text-text-dim">{it.name || 'פריט ללא שם'}</span>
                    <button
                      onClick={() => restoreItem(it)}
                      className="text-sm text-accent hover:underline"
                      data-testid={`restore-item-${it.id}`}
                    >
                      שחזר
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
