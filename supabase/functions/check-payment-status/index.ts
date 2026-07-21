import { serviceClient, requireOrgMember, json, corsPreflight } from '../_shared/db.ts'
import * as cardcom from '../_shared/cardcom.ts'
import * as grow from '../_shared/grow.ts'

Deno.serve(async (req) => {
  const pre = corsPreflight(req); if (pre) return pre
  const origin = req.headers.get('Origin')
  const reply = (body: unknown, status = 200) => json(body, status, origin)
  try {
    const { payment_id } = await req.json()
    if (!payment_id) return reply({ error: 'bad request' }, 400)

    const svc = serviceClient()
    const { data: payment } = await svc.from('payments').select('*').eq('id', payment_id).maybeSingle()
    if (!payment || !payment.provider_ref) return reply({ error: 'not found' }, 404)

    const auth = await requireOrgMember(req, payment.org_id)
    if (auth instanceof Response) return auth
    if (payment.status !== 'pending') return reply({ status: payment.status })

    const { data: account } = await svc.from('payment_provider_accounts')
      .select('provider, credentials').eq('id', payment.provider_account_id).maybeSingle()
    if (!account) return reply({ error: 'no provider' }, 400)

    const result = account.provider === 'grow'
      ? await grow.verifyTransaction(account.credentials, payment.provider_ref, payment.provider_meta)
      : await cardcom.verifyTransaction(account.credentials, payment.provider_ref)
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
    return reply({ status: result.status })
  } catch (e) {
    console.error(e)
    return reply({ error: 'internal' }, 500)
  }
})
