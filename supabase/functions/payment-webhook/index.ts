import { serviceClient, json } from '../_shared/db.ts'
import { parseWebhook, verifyTransaction } from '../_shared/cardcom.ts'

// השוואת מחרוזות בזמן קבוע (מונע time-based side-channel על הסוד)
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  // אימות סוד משותף — נאכף רק אם הוגדר PAYMENT_WEBHOOK_SECRET (תאימות לאחור).
  // ה-endpoint ציבורי (verify_jwt=false), כך שזה חוסם קריאות שאינן מ-Cardcom.
  const expectedSecret = Deno.env.get('PAYMENT_WEBHOOK_SECRET')
  if (expectedSecret) {
    const provided = new URL(req.url).searchParams.get('s') ?? ''
    if (!safeEqual(provided, expectedSecret)) return json({ error: 'forbidden' }, 401)
  }

  const svc = serviceClient()
  try {
    const { providerRef } = await parseWebhook(req)
    if (!providerRef) return json({ ok: true }) // מתעלמים בשקט — לא מפוצצים retries

    const { data: payment } = await svc.from('payments').select('*').eq('provider_ref', providerRef).maybeSingle()
    if (!payment || payment.status === 'paid') return json({ ok: true }) // אידמפוטנטי

    const { data: account } = await svc.from('payment_provider_accounts')
      .select('credentials').eq('id', payment.provider_account_id).maybeSingle()
    if (!account) return json({ ok: true })

    // לעולם לא סומכים על גוף ה-webhook — מאמתים מול Cardcom
    const result = await verifyTransaction(account.credentials, providerRef)
    if (result.status !== 'pending') {
      await svc.from('payments').update({
        status: result.status,
        paid_at: result.status === 'paid' ? (result.paidAt ?? new Date().toISOString()) : null,
        invoice_url: result.invoiceUrl ?? null,
        invoice_number: result.invoiceNumber ?? null,
        raw_webhook: result.raw,
        is_archived: false,
      }).eq('id', payment.id)
    }
    return json({ ok: true })
  } catch (e) {
    console.error('webhook error', e)
    return json({ ok: true }) // 200 תמיד — נדיאג דרך הלוגים
  }
})
