import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import OrgLogo from './OrgLogo'

const MIN_WIDTH = 180
const MAX_WIDTH = 520
const STORAGE_KEY = 'basecrm.sidebarWidth'

export default function Sidebar() {
  const { orgId, org, isAdmin, structureVersion } = useOrg()
  const { boardId } = useParams()
  const [workspaces, setWorkspaces] = useState([])
  const [boards, setBoards] = useState([])
  const [loading, setLoading] = useState(true)

  // רוחב הפאנל — נשמר ב-localStorage ומשוחזר בין ביקורים
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY))
    return saved >= MIN_WIDTH && saved <= MAX_WIDTH ? saved : 256
  })
  const asideRef = useRef(null)
  const [resizing, setResizing] = useState(false)

  useEffect(() => {
    if (!resizing) return
    function onMove(e) {
      // הפאנל ממוקם בצד ימין (RTL) — הרוחב = הקצה הימני שלו פחות מיקום העכבר
      const right = asideRef.current?.getBoundingClientRect().right ?? window.innerWidth
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, right - e.clientX))
      setWidth(next)
    }
    function onUp() {
      setResizing(false)
      localStorage.setItem(STORAGE_KEY, String(Math.round(asideRef.current?.getBoundingClientRect().width || 256)))
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [resizing])

  useEffect(() => {
    let active = true
    async function load() {
      const [wsRes, bRes] = await Promise.all([
        supabase.from('workspaces').select('*').eq('org_id', orgId).eq('is_archived', false).order('position'),
        supabase.from('boards').select('*').eq('org_id', orgId).eq('is_archived', false).order('position'),
      ])
      if (!active) return
      setWorkspaces(wsRes.data || [])
      setBoards(bRes.data || [])
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [orgId, structureVersion])

  return (
    <aside
      ref={asideRef}
      className="relative flex shrink-0 flex-col border-l border-border bg-sidebar"
      style={{ width }}
      data-testid="sidebar"
    >
      {/* ידית גרירה לשינוי רוחב — על הקצה הפנימי (שמאלי ב-RTL) */}
      <div
        onMouseDown={() => setResizing(true)}
        onDoubleClick={() => {
          setWidth(256)
          localStorage.setItem(STORAGE_KEY, '256')
        }}
        title="גרור לשינוי רוחב (דאבל-קליק לאיפוס)"
        data-testid="sidebar-resizer"
        className={`absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize transition-colors ${
          resizing ? 'bg-accent' : 'hover:bg-accent/50'
        }`}
      />
      <div className="border-b border-border p-4">
        <Link
          to="/"
          className="text-xs text-text-dim hover:text-text-muted"
          data-testid="sidebar-all-orgs-link"
        >
          → כל הארגונים
        </Link>
        <div className="mt-1 flex items-center gap-2">
          <OrgLogo org={org} size={32} testid="sidebar-org-logo" />
          <h2 className="truncate text-lg font-bold text-text" title={org?.name} data-testid="sidebar-org-name">
            {org?.name}
          </h2>
        </div>
      </div>

      <nav className="flex-1 overflow-auto p-2">
        {/* CRM — לקוחות */}
        <NavLink
          to={`/org/${orgId}/clients`}
          data-testid="sidebar-clients-link"
          className={({ isActive }) =>
            `mb-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium ${
              isActive ? 'bg-accent/20 text-accent' : 'text-text-muted hover:bg-surface-2'
            }`
          }
        >
          🤝 לקוחות
        </NavLink>
        <div className="mb-2 border-b border-border" />

        {loading ? (
          <p className="p-2 text-sm text-text-dim">טוען...</p>
        ) : workspaces.length === 0 ? (
          <p className="p-2 text-sm text-text-dim">אין עדיין וורקספייסים</p>
        ) : (
          workspaces.map((ws) => (
            <div key={ws.id} className="mb-2">
              <NavLink
                to={`/org/${orgId}/workspace/${ws.id}`}
                data-testid={`sidebar-workspace-${ws.id}`}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium ${
                    isActive && !boardId
                      ? 'bg-surface-2 text-text'
                      : 'text-text-muted hover:bg-surface-2'
                  }`
                }
              >
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: ws.color || '#0073ea' }}
                />
                <span className="truncate">{ws.name}</span>
              </NavLink>
              <div className="mr-3 mt-0.5 border-r border-border pr-1">
                {boards
                  .filter((b) => b.workspace_id === ws.id)
                  .map((b) => (
                    <NavLink
                      key={b.id}
                      to={`/org/${orgId}/board/${b.id}`}
                      data-testid={`sidebar-board-${b.id}`}
                      className={({ isActive }) =>
                        `block truncate rounded-md px-2 py-1 text-sm ${
                          isActive
                            ? 'bg-accent/20 text-accent'
                            : 'text-text-dim hover:bg-surface-2 hover:text-text-muted'
                        }`
                      }
                    >
                      {b.name}
                    </NavLink>
                  ))}
              </div>
            </div>
          ))
        )}
      </nav>

      {isAdmin && (
        <div className="border-t border-border p-2">
          <NavLink
            to={`/org/${orgId}/settings`}
            data-testid="sidebar-settings-link"
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                isActive ? 'bg-surface-2 text-text' : 'text-text-muted hover:bg-surface-2'
              }`
            }
          >
            ⚙ הגדרות ומשתמשים
          </NavLink>
        </div>
      )}
    </aside>
  )
}
