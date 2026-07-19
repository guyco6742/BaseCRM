import { serviceClient, requireOrgAdmin, json, corsPreflight } from '../_shared/db.ts'
import * as cardcom from '../_shared/cardcom.ts'
import * as grow from '../_shared/grow.ts'
import { pickAccount } from '../_shared/providers.ts'

Deno.serve(async (req) => {
  const pre = corsPreflight(req); if (pre) return pre
  try {
    const { org_id, client_id, amount, description, max_installments, provider } = await req.json()
    if (!org_id || !client_id || !amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return json({ error: 'bad request' }, 400)
    if (provider && !['cardcom', 'grow'].includes(provider)) return json({ error: 'bad request' }, 400)

    const auth = await requireOrgAdmin(req, org_id)
    if (auth instanceof Response) return auth

    const svc = serviceClient()
    const [{ data: accounts }, { data: client }] = await Promise.all([
      svc.from('payment_provider_accounts').select('*')
        .eq('org_id', org_id).eq('is_active', true).eq('is_archived', false),
      svc.from('clients').select('id, org_id, name, email, phone').eq('id', client_id).maybeSingle(),
    ])
    const picked = pickAccount(accounts ?? [], provider ?? null)
    if (picked.error) {
      // תאימות לאחור: הלקוח הישן מצפה ל-'no active provider'
      return json({ error: picked.error === 'no_active_provider' ? 'no active provider' : picked.error }, 400)
    }
    const account = picked.account!
    if (!client || client.org_id !== org_id) return json({ error: 'client not found' }, 404)

    // ל-Grow חובה טלפון נייד ישראלי — נכשלים מוקדם עם קוד ייעודי ל-UI
    if (account.provider === 'grow' && !grow.normalizeIsraeliPhone(client.phone)) {
      return json({ error: 'client_phone_required' }, 400)
    }

    // יוצרים קודם שורת תשלום כדי לקבל id; אם יצירת הלינק תיכשל — מארכבים
    const { data: payment, error: insErr } = await svc.from('payments').insert({
      org_id, client_id, provider_account_id: account.id,
      amount: Number(amount), description: description ?? null,
      method: 'credit_card', status: 'pending', created_by: auth.userId,
    }).select().single()
    if (insErr) return json({ error: 'db insert failed' }, 500)

    try {
      const appUrl = Deno.env.get('APP_BASE_URL') ?? 'https://base-crm-kohl.vercel.app'
      const webhookSecret = Deno.env.get('PAYMENT_WEBHOOK_SECRET')
      const webhook = new URL(`${Deno.env.get('SUPABASE_URL')}/functions/v1/payment-webhook`)
      if (webhookSecret) webhook.searchParams.set('s', webhookSecret)

      let url: string, providerRef: string, providerMeta: Record<string, string> | null = null
      if (account.provider === 'grow') {
        webhook.searchParams.set('provider', 'grow')
        const r = await grow.createPaymentLink(account.credentials, {
          amount: Number(amount), description: description || 'תשלום',
          clientName: client.name, clientPhone: client.phone, clientEmail: client.email ?? undefined,
          maxInstallments: max_installments ? Number(max_installments) : undefined,
          successUrl: `${appUrl}/pay/thanks`, cancelUrl: `${appUrl}/pay/thanks?failed=1`,
          notifyUrl: webhook.toString(), paymentId: payment.id,
        })
        url = r.url; providerRef = r.providerRef; providerMeta = r.providerMeta
      } else {
        const r = await cardcom.createPaymentLink(account.credentials, {
          amount: Number(amount), description: description ?? 'תשלום',
          clientName: client.name, clientEmail: client.email ?? undefined,
          maxInstallments: max_installments ? Number(max_installments) : undefined,
          autoInvoice: account.settings?.auto_invoice !== false,
          successUrl: `${appUrl}/pay/thanks`, failedUrl: `${appUrl}/pay/thanks?failed=1`,
          webhookUrl: webhook.toString(),
          paymentId: payment.id,
        })
        url = r.url; providerRef = r.providerRef
      }
      await svc.from('payments').update({ payment_link: url, provider_ref: providerRef, provider_meta: providerMeta }).eq('id', payment.id)
      return json({ payment_id: payment.id, url })
    } catch (e) {
      await svc.from('payments').update({ is_archived: true }).eq('id', payment.id)
      console.error('create link failed', e)
      const msg = e instanceof Error && e.message === 'client_phone_required' ? 'client_phone_required' : 'provider error'
      return json({ error: msg }, msg === 'client_phone_required' ? 400 : 502)
    }
  } catch (e) {
    console.error(e)
    return json({ error: 'internal' }, 500)
  }
})
