import { serviceClient, requireOrgMember, json, corsPreflight } from '../_shared/db.ts'
import { createPaymentLink } from '../_shared/cardcom.ts'

Deno.serve(async (req) => {
  const pre = corsPreflight(req); if (pre) return pre
  try {
    const { org_id, client_id, amount, description, max_installments } = await req.json()
    if (!org_id || !client_id || !amount || Number(amount) <= 0) return json({ error: 'bad request' }, 400)

    const auth = await requireOrgMember(req, org_id)
    if (auth instanceof Response) return auth

    const svc = serviceClient()
    const [{ data: account }, { data: client }] = await Promise.all([
      svc.from('payment_provider_accounts').select('*')
        .eq('org_id', org_id).eq('is_active', true).eq('is_archived', false)
        .eq('provider', 'cardcom').limit(1).maybeSingle(),
      svc.from('clients').select('id, org_id, name, email').eq('id', client_id).maybeSingle(),
    ])
    if (!account) return json({ error: 'no active provider' }, 400)
    if (!client || client.org_id !== org_id) return json({ error: 'client not found' }, 404)

    // יוצרים קודם שורת תשלום כדי לקבל id (ReturnValue); אם יצירת הלינק תיכשל — מארכבים
    const { data: payment, error: insErr } = await svc.from('payments').insert({
      org_id, client_id, provider_account_id: account.id,
      amount: Number(amount), description: description ?? null,
      method: 'credit_card', status: 'pending', created_by: auth.userId,
    }).select().single()
    if (insErr) return json({ error: 'db insert failed' }, 500)

    try {
      const appUrl = Deno.env.get('APP_BASE_URL') ?? 'https://basecrm-app.netlify.app'
      const { url, providerRef } = await createPaymentLink(account.credentials, {
        amount: Number(amount), description: description ?? 'תשלום',
        clientName: client.name, clientEmail: client.email ?? undefined,
        maxInstallments: max_installments ? Number(max_installments) : undefined,
        autoInvoice: account.settings?.auto_invoice !== false,
        successUrl: `${appUrl}/pay/thanks`, failedUrl: `${appUrl}/pay/thanks?failed=1`,
        webhookUrl: `${Deno.env.get('SUPABASE_URL')}/functions/v1/payment-webhook`,
        paymentId: payment.id,
      })
      await svc.from('payments').update({ payment_link: url, provider_ref: providerRef }).eq('id', payment.id)
      return json({ payment_id: payment.id, url })
    } catch (e) {
      await svc.from('payments').update({ is_archived: true }).eq('id', payment.id)
      console.error('create link failed', e)
      return json({ error: 'provider error' }, 502)
    }
  } catch (e) {
    console.error(e)
    return json({ error: 'internal' }, 500)
  }
})
