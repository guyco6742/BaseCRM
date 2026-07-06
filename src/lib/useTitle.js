import { useEffect } from 'react'

const DEFAULT_TITLE = 'BaseCRM — ניהול משימות ולקוחות'

export function useTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · BaseCRM` : DEFAULT_TITLE
    return () => { document.title = DEFAULT_TITLE }
  }, [title])
}
