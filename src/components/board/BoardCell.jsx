import { useEffect, useRef, useState } from 'react'
import Avatar from '../ui/Avatar'
import Popover from './Popover'
import FilesCell from './FilesCell'
import { formatDateTime } from '../../lib/columnTypes'

// עורך טקסט inline (משמש גם למספר/קישור/מייל/טלפון)
export function TextEditor({ value, onChange, type = 'text', display }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const inputRef = useRef(null)

  useEffect(() => {
    setDraft(value ?? '')
  }, [value])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function commit() {
    setEditing(false)
    if ((draft ?? '') !== (value ?? '')) onChange(draft)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
        className="h-full w-full bg-transparent px-2 text-center text-sm text-text outline-none"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="flex h-full w-full items-center justify-center px-2 text-sm text-text"
    >
      {display ? display(value) : value || <span className="text-text-dim">—</span>}
    </button>
  )
}

export default function BoardCell({ column, value, onChange, members = [], clients = [], canEdit = true, item, orgId }) {
  const s = column.settings || {}
  const readOnlyWrap = (content) => <div className="flex h-full items-center justify-center px-2 text-sm">{content}</div>

  switch (column.type) {
    // עמודת מערכת — תאריך יצירת הפריט, קריאה בלבד
    case 'created_at':
      return readOnlyWrap(
        <span className="text-text-muted">{formatDateTime(item?.created_at) || '—'}</span>
      )

    // קישור לקוח CRM לפריט
    case 'client': {
      const current = clients.find((c) => c.id === value)
      const cell = (
        <div className="flex h-full items-center justify-center gap-1 px-2 text-sm text-text">
          {current ? (
            <span className="truncate">🤝 {current.name}</span>
          ) : (
            <span className="text-text-dim">—</span>
          )}
        </div>
      )
      if (!canEdit) return cell
      return (
        <Popover
          panelWidth={220}
          panel={(close) => (
            <div className="max-h-56 space-y-1 overflow-auto">
              {clients.length === 0 && (
                <p className="px-2 py-1.5 text-sm text-text-dim">אין עדיין לקוחות בארגון.</p>
              )}
              {clients.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    onChange(c.id)
                    close()
                  }}
                  className="block w-full truncate rounded px-2 py-1.5 text-start text-sm text-text hover:bg-surface-2"
                  data-testid={`client-option-${c.id}`}
                >
                  {c.name}
                </button>
              ))}
              <button
                onClick={() => {
                  onChange(null)
                  close()
                }}
                className="block w-full rounded px-2 py-1.5 text-start text-sm text-text-muted hover:bg-surface-2"
              >
                נקה
              </button>
            </div>
          )}
        >
          {cell}
        </Popover>
      )
    }

    case 'files':
      return (
        <FilesCell
          orgId={orgId}
          itemId={item?.id}
          value={value}
          onChange={onChange}
          canEdit={canEdit}
        />
      )

    case 'text':
      return canEdit ? (
        <TextEditor value={value} onChange={onChange} />
      ) : (
        readOnlyWrap(value || <span className="text-text-dim">—</span>)
      )

    case 'long_text': {
      if (!canEdit) return readOnlyWrap(<span className="truncate">{value || '—'}</span>)
      return (
        <Popover
          panel={(close) => (
            <LongTextPanel value={value} onChange={onChange} close={close} />
          )}
        >
          <div className="flex h-full items-center justify-center truncate px-2 text-sm text-text">
            {value ? <span className="truncate">{value}</span> : <span className="text-text-dim">—</span>}
          </div>
        </Popover>
      )
    }

    case 'number':
      return canEdit ? (
        <TextEditor
          value={value}
          onChange={(v) => onChange(v === '' ? '' : Number(v))}
          type="number"
          display={(v) =>
            v === '' || v == null ? (
              <span className="text-text-dim">—</span>
            ) : (
              `${v}${s.unit ? ' ' + s.unit : ''}`
            )
          }
        />
      ) : (
        readOnlyWrap(value ?? '—')
      )

    case 'link':
      return <LinkLikeCell value={value} onChange={onChange} canEdit={canEdit} kind="link" />
    case 'email':
      return <LinkLikeCell value={value} onChange={onChange} canEdit={canEdit} kind="email" />
    case 'phone':
      return <LinkLikeCell value={value} onChange={onChange} canEdit={canEdit} kind="phone" />

    case 'date':
      return (
        <input
          type="date"
          value={value || ''}
          disabled={!canEdit}
          onChange={(e) => onChange(e.target.value)}
          className="h-full w-full bg-transparent px-2 text-center text-sm text-text outline-none disabled:opacity-70"
        />
      )

    case 'checkbox':
      return (
        <div className="flex h-full items-center justify-center">
          <input
            type="checkbox"
            checked={Boolean(value)}
            disabled={!canEdit}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-accent)]"
          />
        </div>
      )

    case 'status': {
      const labels = s.labels || []
      const current = labels.find((l) => l.id === value)
      const cell = (
        <div
          className="flex h-full items-center justify-center px-2 text-sm font-medium text-white"
          style={{ backgroundColor: current?.color || 'transparent' }}
        >
          {current ? current.label : <span className="text-text-dim">—</span>}
        </div>
      )
      if (!canEdit) return cell
      return (
        <Popover
          panel={(close) => (
            <div className="space-y-1">
              {labels.map((l) => (
                <button
                  key={l.id}
                  onClick={() => {
                    onChange(l.id)
                    close()
                  }}
                  className="block w-full rounded px-2 py-1.5 text-start text-sm font-medium text-white"
                  style={{ backgroundColor: l.color }}
                >
                  {l.label}
                </button>
              ))}
              <button
                onClick={() => {
                  onChange(null)
                  close()
                }}
                className="block w-full rounded px-2 py-1.5 text-start text-sm text-text-muted hover:bg-surface-2"
              >
                נקה
              </button>
            </div>
          )}
        >
          {cell}
        </Popover>
      )
    }

    case 'dropdown': {
      const options = s.options || []
      const current = options.find((o) => o.id === value)
      const cell = (
        <div className="flex h-full items-center justify-center px-2 text-sm text-text">
          {current ? current.label : <span className="text-text-dim">—</span>}
        </div>
      )
      if (!canEdit) return cell
      return (
        <Popover
          panel={(close) => (
            <div className="space-y-1">
              {options.map((o) => (
                <button
                  key={o.id}
                  onClick={() => {
                    onChange(o.id)
                    close()
                  }}
                  className="block w-full rounded px-2 py-1.5 text-start text-sm text-text hover:bg-surface-2"
                >
                  {o.label}
                </button>
              ))}
              <button
                onClick={() => {
                  onChange(null)
                  close()
                }}
                className="block w-full rounded px-2 py-1.5 text-start text-sm text-text-muted hover:bg-surface-2"
              >
                נקה
              </button>
            </div>
          )}
        >
          {cell}
        </Popover>
      )
    }

    case 'person': {
      const current = members.find((m) => m.user_id === value)
      const cell = (
        <div className="flex h-full items-center justify-center px-2">
          {current ? (
            <Avatar name={current.full_name} email={current.email} size={26} />
          ) : (
            <span className="text-sm text-text-dim">—</span>
          )}
        </div>
      )
      if (!canEdit) return cell
      return (
        <Popover
          panel={(close) => (
            <div className="max-h-56 space-y-1 overflow-auto">
              {members.map((m) => (
                <button
                  key={m.user_id}
                  onClick={() => {
                    onChange(m.user_id)
                    close()
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm text-text hover:bg-surface-2"
                >
                  <Avatar name={m.full_name} email={m.email} size={22} />
                  <span className="truncate">{m.full_name || m.email}</span>
                </button>
              ))}
              <button
                onClick={() => {
                  onChange(null)
                  close()
                }}
                className="block w-full rounded px-2 py-1.5 text-start text-sm text-text-muted hover:bg-surface-2"
              >
                נקה
              </button>
            </div>
          )}
        >
          {cell}
        </Popover>
      )
    }

    default:
      return readOnlyWrap(<span className="text-text-dim">?</span>)
  }
}

function LongTextPanel({ value, onChange, close }) {
  const [draft, setDraft] = useState(value ?? '')
  return (
    <div className="w-64">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text outline-none focus:border-accent"
      />
      <div className="mt-2 flex justify-start gap-2">
        <button
          onClick={() => {
            onChange(draft)
            close()
          }}
          className="rounded-md bg-accent px-3 py-1 text-sm text-white hover:bg-accent-hover"
        >
          שמור
        </button>
        <button onClick={close} className="px-2 py-1 text-sm text-text-muted">
          ביטול
        </button>
      </div>
    </div>
  )
}

export function LinkLikeCell({ value, onChange, canEdit, kind }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])

  const href =
    kind === 'email' ? `mailto:${value}` : kind === 'phone' ? `tel:${value}` : value
  const type = kind === 'email' ? 'email' : kind === 'phone' ? 'tel' : 'url'

  if (editing && canEdit) {
    return (
      <input
        autoFocus
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false)
          if ((draft ?? '') !== (value ?? '')) onChange(draft)
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="h-full w-full bg-transparent px-2 text-center text-sm text-text outline-none"
      />
    )
  }

  return (
    <div className="flex h-full items-center justify-center gap-1 px-2 text-sm">
      {value ? (
        <a
          href={href}
          target={kind === 'link' ? '_blank' : undefined}
          rel="noreferrer"
          className="truncate text-accent hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {value}
        </a>
      ) : (
        <span className="text-text-dim">—</span>
      )}
      {canEdit && (
        <button
          onClick={() => setEditing(true)}
          className="text-text-dim hover:text-text"
          title="עריכה"
        >
          ✎
        </button>
      )}
    </div>
  )
}
