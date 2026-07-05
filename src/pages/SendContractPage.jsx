import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useOrg } from '../context/OrgContext'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'

// עמוד אופציונלי פר-ארגון — מוצג רק אם features.send_contract === true
// (נשלט ע"י סופר-אדמין דרך /admin). מבוסס על הארטיפקט signwell_contract_form_v2.html.
const WORKER_URL = 'https://signwell-proxy.guyco6742.workers.dev/'
const TEMPLATE_ID = '887807dc-3225-4ba3-83c8-1729f83682c1'
const TEST_MODE = true

const OPTION_FIELDS = [
  { key: 'deposit', label: 'דמי רצינות', options: ['250', '650'], suffix: '₪' },
  { key: 'fixed', label: 'סכום קבוע (שכ"ט אישור סופי)', options: ['1500', '3000'], suffix: '₪' },
  { key: 'percentage', label: 'אחוז מסך האשראי שיגויס', options: ['1.5', '2'], suffix: '%' },
  { key: 'interest', label: 'ריבית פיגורים חודשית', options: ['1', '3'], suffix: '%' },
]

export default function SendContractPage() {
  const { org } = useOrg()

  const [clientName, setClientName] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [senderEmail, setSenderEmail] = useState('guyco6742@gmail.com')

  // ערך נבחר לכל שדה אופציות: 'other' | ערך מספרי כמחרוזת | null
  const [selected, setSelected] = useState({ deposit: null, fixed: null, percentage: null, interest: null })
  const [customValues, setCustomValues] = useState({ deposit: '', fixed: '', percentage: '', interest: '' })

  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null) // { type: 'success' | 'error', message }

  // דף אופציונלי — כבוי כברירת מחדל, מוצג רק אם סופר-אדמין הפעיל אותו לארגון הזה
  if (!org?.features?.send_contract) {
    return <Navigate to="../" replace />
  }

  function selectOption(field, value) {
    setSelected((prev) => ({ ...prev, [field]: value }))
  }

  function getFieldValue(field) {
    const value = selected[field]
    if (!value) return null
    if (value === 'other') return customValues[field].trim() || null
    return value
  }

  async function handleSend(e) {
    e.preventDefault()
    setResult(null)

    if (!clientName.trim() || !clientId.trim() || !clientEmail.trim() || !senderEmail.trim()) {
      setResult({ type: 'error', message: 'נא למלא שם לקוח, ח.פ/ת.ז, אימייל לקוח ואימייל שולח.' })
      return
    }

    const deposit = getFieldValue('deposit')
    const fixed = getFieldValue('fixed')
    const percentage = getFieldValue('percentage')
    const interest = getFieldValue('interest')

    if (!deposit || !fixed || !percentage || !interest) {
      setResult({ type: 'error', message: "נא לבחור ערך עבור כל אחד מהשדות המספריים (או להזין ערך ב'אחר')." })
      return
    }

    setSending(true)
    try {
      const payload = {
        test_mode: TEST_MODE,
        template_id: TEMPLATE_ID,
        recipients: [
          { id: '1', name: clientName.trim(), email: clientEmail.trim(), placeholder_name: 'Client' },
          { id: '2', name: 'Reich Finance', email: senderEmail.trim(), placeholder_name: 'Sender' },
        ],
        signing_elements: [
          { api_id: 'client_name', value: clientName.trim() },
          { api_id: 'client_id_number', value: clientId.trim() },
          { api_id: 'deposit_amount', value: String(deposit) },
          { api_id: 'fixed_amount', value: String(fixed) },
          { api_id: 'percentage_fee', value: String(percentage) },
          { api_id: 'monthly_interest', value: String(interest) },
        ],
      }

      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json()

      if (response.ok) {
        const links = (data.recipients || [])
          .map((r) => `${r.placeholder_name}: ${r.signing_url}`)
          .join('\n')
        setResult({
          type: 'success',
          message: `נשלח בהצלחה (test mode)!\n\nמזהה מסמך: ${data.id || '—'}\n\n${links}`,
        })
      } else {
        setResult({ type: 'error', message: `שגיאה מה-API:\n${JSON.stringify(data, null, 2)}` })
      }
    } catch (err) {
      setResult({ type: 'error', message: `שגיאת רשת (ייתכן CORS):\n${err.message}` })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="w-full flex-1 overflow-auto">
      <div className="mx-auto max-w-xl p-6">
        <Card>
          <span className="mb-3 inline-block rounded-full bg-status-orange/20 px-2.5 py-0.5 text-xs font-semibold text-status-orange">
            TEST MODE — לא נשלח בפועל
          </span>
          <h1 className="text-lg font-bold text-text">שליחת חוזה לחתימה</h1>
          <p className="mb-5 text-sm text-text-dim">
            הסכם התקשרות לבקשת ערבות מדינה ואשראי בנקאי — {org?.name}
          </p>

          <form onSubmit={handleSend} className="space-y-4">
            <Input
              label="שם הלקוח / החברה"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder='לדוגמה: ישראל ישראלי בע"מ'
              data-testid="contract-client-name"
            />
            <Input
              label="ח.פ / ת.ז"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="לדוגמה: 123456789"
              data-testid="contract-client-id"
            />
            <Input
              label="אימייל הלקוח (לשליחת קישור החתימה)"
              type="email"
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
              placeholder="client@example.com"
              data-testid="contract-client-email"
            />
            <Input
              label="אימייל השולח (רייך פיננסים)"
              type="email"
              value={senderEmail}
              onChange={(e) => setSenderEmail(e.target.value)}
              data-testid="contract-sender-email"
            />

            {OPTION_FIELDS.map(({ key, label, options, suffix }) => (
              <div key={key} className="border-t border-border pt-4">
                <span className="mb-1.5 block text-sm text-text-muted">{label}</span>
                <div className="flex gap-2">
                  {options.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => selectOption(key, opt)}
                      className={`flex-1 rounded-md border px-2 py-2 text-sm transition-colors ${
                        selected[key] === opt
                          ? 'border-accent bg-accent text-white font-semibold'
                          : 'border-border bg-bg text-text hover:border-accent'
                      }`}
                      data-testid={`contract-${key}-${opt}`}
                    >
                      {opt}
                      {suffix}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => selectOption(key, 'other')}
                    className={`flex-1 rounded-md border px-2 py-2 text-sm transition-colors ${
                      selected[key] === 'other'
                        ? 'border-accent bg-accent text-white font-semibold'
                        : 'border-border bg-bg text-text hover:border-accent'
                    }`}
                    data-testid={`contract-${key}-other`}
                  >
                    אחר
                  </button>
                </div>
                {selected[key] === 'other' && (
                  <div className="mt-2">
                    <Input
                      value={customValues[key]}
                      onChange={(e) => setCustomValues((prev) => ({ ...prev, [key]: e.target.value }))}
                      placeholder={`הזן ${suffix === '%' ? 'אחוז' : 'סכום'}`}
                    />
                  </div>
                )}
              </div>
            ))}

            <Button type="submit" size="lg" className="w-full" disabled={sending} data-testid="contract-submit">
              {sending ? 'שולח...' : 'שלח חוזה לחתימה'}
            </Button>
          </form>

          {result && (
            <div
              className={`mt-4 whitespace-pre-wrap break-words rounded-md border p-3 text-sm ${
                result.type === 'success'
                  ? 'border-status-green/40 bg-status-green/10 text-status-green'
                  : 'border-status-red/40 bg-status-red/10 text-status-red'
              }`}
              data-testid="contract-result"
            >
              {result.message}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
