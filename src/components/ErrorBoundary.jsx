import { Component } from 'react'
import * as Sentry from '@sentry/react'

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack)
    Sentry.captureException(error, { extra: { componentStack: info?.componentStack } })
  }

  render() {
    if (this.state.error) {
      return (
        <div dir="rtl" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
          <h1 className="text-2xl font-bold text-text">משהו השתבש</h1>
          <p className="max-w-md text-text-muted">
            אירעה שגיאה בלתי צפויה. אפשר לנסות לרענן את הדף — אם הבעיה חוזרת, צרו קשר עם התמיכה.
          </p>
          <button
            onClick={() => { window.location.href = '/' }}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover cursor-pointer"
          >
            חזרה לדף הבית
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
