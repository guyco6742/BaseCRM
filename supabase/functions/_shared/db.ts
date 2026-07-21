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
  const origin = req.headers.get('Origin')
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'unauthorized' }, 401, origin)

  const svc = serviceClient()
  const [{ data: member }, { data: profile }] = await Promise.all([
    svc.from('memberships').select('id').eq('org_id', orgId).eq('user_id', user.id).maybeSingle(),
    svc.from('profiles').select('is_super_admin').eq('id', user.id).maybeSingle(),
  ])
  if (!member && !profile?.is_super_admin) return json({ error: 'forbidden' }, 403, origin)
  return { userId: user.id }
}

// מזהה את המשתמש מן ה-JWT של הבקשה ובודק שהוא אדמין בארגון (כולל סופר-אדמין)
export async function requireOrgAdmin(req: Request, orgId: string): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const origin = req.headers.get('Origin')
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'unauthorized' }, 401, origin)

  const svc = serviceClient()
  const [{ data: member }, { data: profile }] = await Promise.all([
    svc.from('memberships').select('id, role').eq('org_id', orgId).eq('user_id', user.id).maybeSingle(),
    svc.from('profiles').select('is_super_admin').eq('id', user.id).maybeSingle(),
  ])
  if (member?.role !== 'admin' && !profile?.is_super_admin) return json({ error: 'forbidden' }, 403, origin)
  return { userId: user.id }
}

const CORS_ALLOW_HEADERS = 'authorization, content-type, apikey, x-client-info'

// רשימת מקורות מותרים ל-CORS. נגזרת מ-APP_BASE_URL (או APP_URL כגיבוי) בתוספת
// רשימה קשיחה של מקורות ידועים. מחליף את הישן Access-Control-Allow-Origin: '*'.
const PRIMARY_ORIGIN = Deno.env.get('APP_BASE_URL') ?? Deno.env.get('APP_URL') ?? 'https://base-crm-kohl.vercel.app'
const ALLOWED_ORIGINS = [
  PRIMARY_ORIGIN,
  'https://base-crm-kohl.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
]

// מחזיר את מקור הבקשה אם הוא ברשימת ההיתר, אחרת את המקור הראשי (ברירת מחדל בטוחה).
function resolveOrigin(origin: string | null): string {
  if (origin && ALLOWED_ORIGINS.includes(origin)) return origin
  return ALLOWED_ORIGINS[0]
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': resolveOrigin(origin),
    'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
    'Vary': 'Origin',
  }
}

export function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}

export function corsPreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(req.headers.get('Origin')),
    })
  }
  return null
}
