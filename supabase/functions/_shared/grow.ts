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

export interface VerifyResult {
  status: 'paid' | 'failed' | 'pending'
  paidAt?: string; invoiceUrl?: string; invoiceNumber?: string; raw: unknown
}

function toFormData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return fd
}

async function growPost(creds: GrowCreds, path: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`${growBaseUrl(creds)}/${path}`, { method: 'POST', body: toFormData(fields) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || (data as Record<string, unknown>).status !== 1) {
    throw new Error(`grow ${path} failed: http ${res.status} ${JSON.stringify((data as Record<string, unknown>).err ?? data)}`)
  }
  return data as Record<string, unknown>
}

export async function createPaymentLink(creds: GrowCreds, p: GrowCreateParams):
  Promise<{ url: string; providerRef: string; providerMeta: { process_token: string } }> {
  const data = await growPost(creds, 'createPaymentProcess', buildCreateProcessForm(creds, p))
  const d = (data.data ?? {}) as Record<string, unknown>
  if (!d.url || !d.processId || !d.processToken) throw new Error('grow createPaymentProcess: missing url/processId/processToken')
  return { url: String(d.url), providerRef: String(d.processId), providerMeta: { process_token: String(d.processToken) } }
}

export async function verifyTransaction(creds: GrowCreds, providerRef: string,
  providerMeta: { process_token?: string } | null): Promise<VerifyResult> {
  if (!providerMeta?.process_token) return { status: 'pending', raw: { error: 'missing process_token' } }
  const data = await growPost(creds, 'getPaymentProcessInfo', {
    pageCode: creds.page_code, processId: providerRef, processToken: providerMeta.process_token,
  })
  const mapped = mapProcessInfo(data.data)
  return {
    status: mapped.status,
    paidAt: mapped.status === 'paid' ? new Date().toISOString() : undefined,
    // חשבוניות מונפקות בצד Grow (ראו spec §8) — אין שדות מסמך ב-flow הזה כרגע
    raw: data,
  }
}

// ה-notify של Grow — form-encoded. cField1 = מזהה התשלום שלנו; processId = provider_ref.
export async function parseWebhook(req: Request):
  Promise<{ paymentId: string | null; providerRef: string | null; notifyBody: Record<string, string> }> {
  try {
    const body: Record<string, string> = {}
    const ct = req.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) {
      const data = await req.json()
      for (const [k, v] of Object.entries(data ?? {})) body[k] = String(v)
    } else {
      const form = await req.formData()
      for (const [k, v] of form.entries()) body[k] = String(v)
    }
    return { paymentId: body.cField1 ?? null, providerRef: body.processId ?? null, notifyBody: body }
  } catch {
    return { paymentId: null, providerRef: null, notifyBody: {} }
  }
}

// אישור קבלת העדכון — חובה, אחרת Grow שולחים שוב עד 5 פעמים. כישלון נרשם ולא מפיל את ה-webhook.
export async function approveTransaction(creds: GrowCreds, notifyBody: Record<string, string>): Promise<void> {
  try {
    await growPost(creds, 'approveTransaction', { ...notifyBody, pageCode: creds.page_code })
  } catch (e) {
    console.error(`grow approveTransaction failed (processId=${notifyBody.processId ?? '?'})`, e)
  }
}
