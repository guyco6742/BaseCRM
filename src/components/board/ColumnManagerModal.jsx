import Modal from '../ui/Modal'
import { COLUMN_TYPES } from '../../lib/columnTypes'
import { hasEditableSettings } from './ColumnSettingsEditor'

// חלון ניהול עמודות: שינוי סדר, עריכה, הצגה/הסתרה והשבתה (מחיקה רכה) + שחזור מושבתות
export default function ColumnManagerModal({
  open,
  onClose,
  columns,
  archivedColumns = [],
  onMove,
  onEdit,
  onToggleHidden,
  onArchive,
  onRestore,
}) {
  return (
    <Modal open={open} onClose={onClose} title="ניהול עמודות" size="md" testid="column-manager-modal">
      <p className="mb-3 text-sm text-text-dim">
        שנו את סדר העמודות, הסתירו זמנית, או השביתו (הנתונים נשמרים וניתנים לשחזור).
      </p>
      <div className="space-y-1">
        {columns.length === 0 && (
          <p className="py-4 text-center text-sm text-text-dim">אין עדיין עמודות.</p>
        )}
        {columns.map((col, idx) => {
          const hidden = Boolean(col.settings?.hidden)
          const isSystem = COLUMN_TYPES[col.type]?.system
          return (
            <div
              key={col.id}
              className="flex items-center gap-2 rounded-md border border-border bg-bg px-2 py-1.5"
            >
              <div className="flex flex-col">
                <button
                  onClick={() => onMove(col, -1)}
                  disabled={idx === 0}
                  className="leading-none text-text-dim hover:text-text disabled:opacity-30"
                  title="הזז קדימה"
                  data-testid={`column-move-up-${col.id}`}
                >
                  ▲
                </button>
                <button
                  onClick={() => onMove(col, 1)}
                  disabled={idx === columns.length - 1}
                  className="leading-none text-text-dim hover:text-text disabled:opacity-30"
                  title="הזז אחורה"
                  data-testid={`column-move-down-${col.id}`}
                >
                  ▼
                </button>
              </div>

              <span className="w-5 text-center text-sm">{COLUMN_TYPES[col.type]?.icon}</span>

              <div className="flex-1 truncate">
                <span className={`text-sm ${hidden ? 'text-text-dim line-through' : 'text-text'}`}>
                  {col.name}
                </span>
                <span className="mr-2 text-xs text-text-dim">{COLUMN_TYPES[col.type]?.label}</span>
              </div>

              {hasEditableSettings(col.type) && (
                <button
                  onClick={() => onEdit(col)}
                  className="rounded px-2 py-1 text-sm text-text-muted hover:bg-surface-2"
                  title="ערוך עמודה (תוויות/צבעים)"
                  data-testid={`column-edit-${col.id}`}
                >
                  ✎
                </button>
              )}

              <button
                onClick={() => onToggleHidden(col)}
                className="rounded px-2 py-1 text-sm text-text-muted hover:bg-surface-2"
                title={hidden ? 'הצג עמודה' : 'הסתר עמודה'}
                data-testid={`column-toggle-hidden-${col.id}`}
              >
                {hidden ? '🚫' : '👁'}
              </button>

              {/* עמודת מערכת (נוצר בתאריך) לא ניתנת להשבתה */}
              {!isSystem && (
                <button
                  onClick={() => onArchive(col)}
                  className="rounded px-2 py-1 text-sm text-text-dim hover:text-status-red"
                  title="השבת עמודה (ניתן לשחזור)"
                  data-testid={`column-archive-btn-${col.id}`}
                >
                  🗄
                </button>
              )}
            </div>
          )
        })}
      </div>

      {archivedColumns.length > 0 && (
        <div className="mt-5">
          <h4 className="mb-2 text-sm font-semibold text-text-muted">
            עמודות מושבתות ({archivedColumns.length})
          </h4>
          <div className="space-y-1">
            {archivedColumns.map((col) => (
              <div
                key={col.id}
                className="flex items-center gap-2 rounded-md border border-dashed border-border bg-bg/50 px-2 py-1.5"
              >
                <span className="w-5 text-center text-sm">{COLUMN_TYPES[col.type]?.icon}</span>
                <div className="flex-1 truncate">
                  <span className="text-sm text-text-dim">{col.name}</span>
                  <span className="mr-2 text-xs text-text-dim">{COLUMN_TYPES[col.type]?.label}</span>
                </div>
                <button
                  onClick={() => onRestore(col)}
                  className="rounded px-2 py-1 text-sm text-accent hover:underline"
                  title="שחזר עמודה"
                  data-testid={`column-restore-${col.id}`}
                >
                  שחזר
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}
