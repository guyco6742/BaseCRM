// מתאם Cardcom — API v11 LowProfile (דפי תשלום מתארחים)
// חוזה מאומת מול swagger.json חי של Cardcom — ראו docs/superpowers/specs/cardcom-api-contract.md
// אם החוזה בפועל ישתנה — עדכנו כאן בלבד; שאר הפונקציות תלויות בממשק, לא ב-Cardcom.

const BASE = 'https://secure.cardcom.solutions/api/v11'

export interface CardcomCreds { terminal_number: string; api_name: string; api_password?: string }
export interface CreateLinkParams {
  amount: number; description: string; clientName?: string; clientEmail?: string
  maxInstallments?: number; autoInvoice?: boolean; successUrl: string; failedUrl: string; webhookUrl: string
  paymentId: string // ReturnValue — חוזר אלינו ב-webhook
}
export interface VerifyResult {
  status: 'paid' | 'failed' | 'pending'
  paidAt?: string; invoiceUrl?: string; invoiceNumber?: string; raw: unknown
}

export async function createPaymentLink(creds: CardcomCreds, p: CreateLinkParams): Promise<{ url: string; providerRef: string }> {
  const body: Record<string, unknown> = {
    TerminalNumber: Number(creds.terminal_number),
    ApiName: creds.api_name,
    Operation: 'ChargeOnly',
    Amount: p.amount,
    ProductName: p.description.slice(0, 250),
    SuccessRedirectUrl: p.successUrl,
    FailedRedirectUrl: p.failedUrl,
    WebHookUrl: p.webhookUrl,
    ReturnValue: p.paymentId,
    Language: 'he',
    ISOCoinId: 1, // ILS
  }
  if (p.maxInstallments && p.maxInstallments > 1) {
    // תשלומים חיים תחת AdvancedDefinition, לא בשורש הבקשה
    body.AdvancedDefinition = { MinNumOfPayments: 1, MaxNumOfPayments: p.maxInstallments }
  }
  if (p.autoInvoice) {
    // אין ערך Operation ייעודי להנפקת מסמך — היא מופעלת רק ע"י נוכחות אובייקט Document
    body.Document = {
      Name: (p.clientName || 'לקוח').slice(0, 50),
      Email: p.clientEmail || undefined,
      DocumentTypeToCreate: 'TaxInvoiceAndReceipt', // חשבונית מס/קבלה
      IsSendByEmail: true,
      Products: [{ Description: p.description.slice(0, 250), UnitCost: p.amount, Quantity: 1 }],
    }
  }
  const res = await fetch(`${BASE}/LowProfile/Create`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok || data.ResponseCode !== 0) {
    throw new Error(`cardcom create failed: ${data.ResponseCode} ${data.Description ?? ''}`)
  }
  return { url: data.Url, providerRef: data.LowProfileId }
}

export async function verifyTransaction(creds: CardcomCreds, providerRef: string): Promise<VerifyResult> {
  const res = await fetch(`${BASE}/LowProfile/GetLpResult`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ TerminalNumber: Number(creds.terminal_number), ApiName: creds.api_name, LowProfileId: providerRef }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`cardcom verify failed: http ${res.status}`)
  // הצלחה = ResponseCode עליון 0 (הקריאה עצמה תקינה) וגם TranzactionInfo.ResponseCode 0 (החיוב עצמו הצליח)
  const paid = data.ResponseCode === 0 && data.TranzactionInfo?.ResponseCode === 0
  const failed = data.ResponseCode === 0 && data.TranzactionInfo && data.TranzactionInfo.ResponseCode !== 0
  // מקרה קצה בעל משמעות רגולטורית/תאימות: החיוב הצליח אבל הנפקת החשבונית נכשלה.
  // לא משנים את הסטטוס המוחזר (העסקה אכן הצליחה) — רק חושפים את הכשל ביומן כדי שמישהו יטפל בזה ידנית.
  if (data.DocumentInfo && data.DocumentInfo.ResponseCode) {
    console.error(
      `cardcom: charge succeeded but invoice issuance failed — LowProfileId=${providerRef} DocumentInfo.ResponseCode=${data.DocumentInfo.ResponseCode} Description=${data.DocumentInfo.Description ?? ''}`,
    )
  }
  return {
    status: paid ? 'paid' : failed ? 'failed' : 'pending',
    paidAt: paid ? new Date().toISOString() : undefined,
    // פרטי החשבונית נמצאים ב-DocumentInfo בשורש התשובה (אח של TranzactionInfo, לא מקונן בתוכו)
    invoiceUrl: data.DocumentInfo?.DocumentUrl ?? undefined,
    invoiceNumber: data.DocumentInfo?.DocumentNumber ? String(data.DocumentInfo.DocumentNumber) : undefined,
    raw: data,
  }
}

// ה-webhook של Cardcom — מחלצים רק את המזהה; את האמת מביאים מ-verifyTransaction
// ב-APILevel 11 קארדקום שולחים JSON עם LowProfileId בשורש (זהו הנתיב האמיתי);
// שומרים גם על נפילה חזרה ל-form-encoded (lowprofilecode) למקרה של ממשק ישן/APILevel 10.
export async function parseWebhook(req: Request): Promise<{ providerRef: string | null }> {
  try {
    const ct = req.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) {
      const data = await req.json()
      return { providerRef: data.LowProfileId ?? data.lowprofilecode ?? null }
    }
    const form = await req.formData()
    return { providerRef: (form.get('LowProfileId') ?? form.get('lowprofilecode'))?.toString() ?? null }
  } catch {
    return { providerRef: null }
  }
}
