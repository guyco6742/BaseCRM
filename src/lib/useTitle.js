import { useEffect } from 'react'

const DEFAULT_TITLE = 'work-it — ניהול משימות ולקוחות'

export function useTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · work-it` : DEFAULT_TITLE
    return () => { document.title = DEFAULT_TITLE }
  }, [title])
}
