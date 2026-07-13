import { createClient } from 'npm:@supabase/supabase-js@2'

export function serviceClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

// מזהה את המשתמש מן ה-JWT של הבקשה ובודק חברות בארגון (כולל סופר-אדמין)
export async function requireOrgMember(req: Request, orgId: string): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'unauthorized' }, 401)

  const svc = serviceClient()
  const [{ data: member }, { data: profile }] = await Promise.all([
    svc.from('memberships').select('id').eq('org_id', orgId).eq('user_id', user.id).maybeSingle(),
    svc.from('profiles').select('is_super_admin').eq('id', user.id).maybeSingle(),
  ])
  if (!member && !profile?.is_super_admin) return json({ error: 'forbidden' }, 403)
  return { userId: user.id }
}

// כמו requireOrgMember, אך דורש תפקיד אדמין בארגון (או סופר-אדמין) — לכתיבת תשלומים
export async function requireOrgAdmin(req: Request, orgId: string): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'unauthorized' }, 401)

  const svc = serviceClient()
  const [{ data: member }, { data: profile }] = await Promise.all([
    svc.from('memberships').select('role').eq('org_id', orgId).eq('user_id', user.id).maybeSingle(),
    svc.from('profiles').select('is_super_admin').eq('id', user.id).maybeSingle(),
  ])
  if (member?.role !== 'admin' && !profile?.is_super_admin) return json({ error: 'forbidden' }, 403)
  return { userId: user.id }
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey' },
  })
}

export function corsPreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return json(null, 204)
  return null
}
