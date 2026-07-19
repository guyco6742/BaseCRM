// מתאם Grow (Meshulam "light server" API) — דפי תשלום מתארחים
// חוזה מתועד ב-docs/superpowers/specs/grow-api-contract.md — אם ה-API בפועל שונה, עדכנו שם וכאן בלבד.
// שימו לב: אין Deno globals ברמת המודול — הפונקציות הטהורות נבדקות ב-Vitest (Node).

const SANDBOX_BASE = 'https://sandbox.meshulam.co.il/api/light/server/1.0'
const DEFAULT_PROD_BASE = 'https://meshulam.co.il/api/light/server/1.0'

export interface GrowCreds { user_id: string; page_code: string; sandbox?: boolean }
export interface GrowCreateParams {
  amount: number; description: string
  clientName: string; clientPhone: string | null | undefined; clientEmail?: string
  maxInstallments?: number
  successUrl: string; cancelUrl: string; notifyUrl: string
  paymentId: string // cField1 — חוזר אלינו ב-notify
}

export function growBaseUrl(creds: GrowCreds): string {
  if (creds.sandbox !== false) return SANDBOX_BASE
  // deno-lint-ignore no-explicit-any
  const env = (globalThis as any).Deno?.env?.get?.('GROW_BASE_URL_PROD')
  return env || DEFAULT_PROD_BASE
}

// נייד ישראלי בלבד (05X). מקבל פורמט מקומי/בינלאומי עם מקפים/רווחים.
export function normalizeIsraeliPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  let d = String(raw).replace(/\D/g, '')
  if (d.startsWith('972')) d = '0' + d.slice(3)
  if (!/^05\d{8}$/.test(d)) return null
  return d
}

export function buildCreateProcessForm(creds: GrowCreds, p: GrowCreateParams): Record<string, string> {
  const phone = normalizeIsraeliPhone(p.clientPhone)
  if (!phone) throw new Error('client_phone_required')
  const form: Record<string, string> = {
    pageCode: creds.page_code,
    userId: creds.user_id,
    sum: String(p.amount),
    description: p.description.slice(0, 250),
    chargeType: '1',
    successUrl: p.successUrl,
    cancelUrl: p.cancelUrl,
    notifyUrl: p.notifyUrl,
    'pageField[fullName]': p.clientName,
    'pageField[phone]': phone,
    cField1: p.paymentId,
  }
  if (p.clientEmail) form['pageField[email]'] = p.clientEmail
  if (p.maxInstallments && p.maxInstallments > 1) form.maxPaymentNum = String(Math.min(p.maxInstallments, 12))
  return form
}

// getPaymentProcessInfo: עסקה קיימת (transactionCode) = שולם; אחרת עדיין ממתין.
// Grow לא שולחים notify על כישלון — עמוד התשלום מאפשר ניסיון חוזר; לכן אין מיפוי ל-failed.
export function mapProcessInfo(data: unknown): { status: 'paid' | 'pending'; transactionCode?: string } {
  const d = (data ?? {}) as Record<string, unknown>
  const tc = d.transactionCode ? String(d.transactionCode) : undefined
  return { status: tc ? 'paid' : 'pending', transactionCode: tc }
}
