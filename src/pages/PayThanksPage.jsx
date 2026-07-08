import { useSearchParams } from 'react-router-dom'

// עמוד ציבורי (ללא התחברות) — חזרה אחרי תשלום דרך קישור Cardcom
export default function PayThanksPage() {
  const [params] = useSearchParams()
  const failed = params.get('failed') === '1'
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6" dir="rtl">
      <div className="max-w-md rounded-lg border border-border bg-surface p-8 text-center" data-testid="pay-thanks">
        <div className="mb-3 text-4xl">{failed ? '😕' : '✅'}</div>
        <h1 className="mb-2 text-xl font-bold text-text">
          {failed ? 'התשלום לא הושלם' : 'התשלום התקבל — תודה!'}
        </h1>
        <p className="text-sm text-text-muted">
          {failed ? 'ניתן לנסות שוב דרך הקישור שקיבלתם, או לפנות לבית העסק.' : 'קבלה/חשבונית תישלח אליכם במייל.'}
        </p>
      </div>
    </div>
  )
}
