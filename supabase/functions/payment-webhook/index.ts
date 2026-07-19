import { serviceClient, json } from '../_shared/db.ts'
import * as cardcom from '../_shared/cardcom.ts'
import * as grow from '../_shared/grow.ts'

// השוואת מחרוזות בזמן קבוע (מונע time-based side-channel על הסוד)
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// עדכון תשלום שהוסדר — משותף לשני הספקים
async function settle(svc: ReturnType<typeof serviceClient>, paymentId: string,
  result: { status: string; paidAt?: string; invoiceUrl?: string; invoiceNumber?: string; raw: unknown }) {
  if (result.status === 'pending') return
  await svc.from('payments').update({
    status: result.status,
    paid_at: result.status === 'paid' ? (result.paidAt ?? new Date().toISOString()) : null,
    invoice_url: result.invoiceUrl ?? null,
    invoice_number: result.invoiceNumber ?? null,
    raw_webhook: result.raw,
    is_archived: false,
  }).eq('id', paymentId)
}

Deno.serve(async (req) => {
  // אימות סוד משותף — נאכף רק אם הוגדר PAYMENT_WEBHOOK_SECRET (תאימות לאחור).
  const params = new URL(req.url).searchParams
  const expectedSecret = Deno.env.get('PAYMENT_WEBHOOK_SECRET')
  if (expectedSecret && !safeEqual(params.get('s') ?? '', expectedSecret)) return json({ error: 'forbidden' }, 401)

  const svc = serviceClient()
  try {
    if (params.get('provider') === 'grow') {
      const { paymentId, providerRef, notifyBody } = await grow.parseWebhook(req)
      if (!paymentId && !providerRef) return json({ ok: true })

      // איתור לפי המזהה שלנו (cField1); נפילה חזרה ל-provider_ref (processId)
      let payment = null
      if (paymentId) ({ data: payment } = await svc.from('payments').select('*').eq('id', paymentId).maybeSingle())
      if (!payment && providerRef) ({ data: payment } = await svc.from('payments').select('*').eq('provider_ref', providerRef).maybeSingle())
      if (!payment) return json({ ok: true })

      const { data: account } = await svc.from('payment_provider_accounts')
        .select('provider, credentials').eq('id', payment.provider_account_id).maybeSingle()
      // הגנה: notify של Grow חייב להצביע על תשלום ששייך לחשבון Grow
      if (!account || account.provider !== 'grow') return json({ ok: true })

      if (payment.status !== 'paid') {
        // לעולם לא סומכים על גוף ה-notify — מאמתים מול Grow
        const result = await grow.verifyTransaction(account.credentials, payment.provider_ref, payment.provider_meta)
        await settle(svc, payment.id, result)
      }
      // חובה לאשר קבלה גם אם כבר שולם (idempotent אצלנו; מונע 5 שליחות חוזרות)
      await grow.approveTransaction(account.credentials, notifyBody)
      return json({ ok: true })
    }

    // ברירת מחדל: Cardcom — נתיב קיים ללא שינוי התנהגות
    const { providerRef } = await cardcom.parseWebhook(req)
    if (!providerRef) return json({ ok: true })

    const { data: payment } = await svc.from('payments').select('*').eq('provider_ref', providerRef).maybeSingle()
    if (!payment || payment.status === 'paid') return json({ ok: true })

    const { data: account } = await svc.from('payment_provider_accounts')
      .select('credentials').eq('id', payment.provider_account_id).maybeSingle()
    if (!account) return json({ ok: true })

    const result = await cardcom.verifyTransaction(account.credentials, providerRef)
    await settle(svc, payment.id, result)
    return json({ ok: true })
  } catch (e) {
    console.error('webhook error', e)
    return json({ ok: true }) // 200 תמיד — נדיאג דרך הלוגים
  }
})
