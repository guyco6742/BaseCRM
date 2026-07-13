import { serviceClient, requireOrgAdmin, json, corsPreflight } from '../_shared/db.ts'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VALID_ROLES = ['admin', 'member']
const RESEND_COOLDOWN_MS = 60 * 1000

function buildInviteUrl(token: string): string {
  const appUrl = Deno.env.get('APP_URL') ?? 'https://base-crm-kohl.vercel.app'
  return `${appUrl}/accept-invite?token=${token}`
}

// שולח מייל הזמנה דרך Resend. מחזיר true/false בלבד — כשלון בשליחה אף פעם לא
// מבטל את שורת ה-invitation (ראו §7 Item 4 בספק).
async function sendInviteEmail({
  to,
  orgName,
  orgLogoUrl,
  inviterName,
  inviteUrl,
}: {
  to: string
  orgName: string
  orgLogoUrl?: string | null
  inviterName: string
  inviteUrl: string
}): Promise<boolean> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return false // ללא מפתח — no-op חינני, לא כשל

  const from = Deno.env.get('RESEND_FROM') ?? 'work-it <onboarding@resend.dev>'
  // שם הארגון והמזמין הם קלט משתמש — חובה escaping לפני הזרקה ל-HTML של המייל,
  // אחרת שם ארגון כמו <a href="..."> היה מתרנדר כמרקאפ חי (וקטור פישינג).
  const esc = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const orgNameHtml = esc(orgName)
  const inviterNameHtml = esc(inviterName)
  const initials = esc(
    inviterName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0])
      .join('')
      .toUpperCase() || '·'
  )
  // logo_url מגיע מ-Supabase Storage (bucket ציבורי, מוזן ע"י אדמין הארגון בלבד) —
  // עדיין עובר escaping כי הוא מוזרק ישירות לתוך attribute ב-HTML.
  const logoUrlHtml = orgLogoUrl ? esc(orgLogoUrl) : null

  const headerHtml = logoUrlHtml
    ? `<div style="background:#ffffff; padding:20px 24px; text-align:center; border-bottom:1px solid #e5e7eb;">
         <img src="${logoUrlHtml}" alt="${orgNameHtml}" height="40" style="max-height:40px; max-width:200px; display:inline-block;" />
       </div>`
    : `<div style="background:#4f46e5; padding:22px 24px; text-align:center;">
         <div style="font-size:14px; font-weight:bold; color:#ffffff;">work-it</div>
       </div>`

  const subject = `הוזמנת להצטרף ל-${orgName} ב-work-it`
  const html = `
    <div dir="rtl" lang="he" style="font-family: Arial, Helvetica, sans-serif; background:#f5f5f5; padding:24px;">
      <div style="max-width:480px; margin:0 auto; background:#ffffff; border-radius:8px; overflow:hidden; color:#1f2937;">
        ${headerHtml}
        <div style="padding:28px 24px;">
          <div style="width:44px; height:44px; border-radius:50%; background:#eef2ff; color:#4f46e5;
                      display:flex; align-items:center; justify-content:center; font-weight:bold;
                      font-size:15px; margin:0 auto 16px; text-align:center; line-height:44px;">
            ${initials}
          </div>
          <h1 style="font-size:17px; font-weight:bold; margin:0 0 10px; text-align:center;">הזמנה לארגון ${orgNameHtml}</h1>
          <p style="font-size:14px; line-height:1.7; color:#4b5563; margin:0 0 22px; text-align:center;">
            <strong style="color:#1f2937;">${inviterNameHtml}</strong> הזמין/ה אותך להצטרף כחבר/ה בארגון
            <strong style="color:#1f2937;">${orgNameHtml}</strong> במערכת work-it.
          </p>
          <div style="text-align:center; margin:0 0 18px;">
            <a href="${inviteUrl}"
               style="display:inline-block; background:#4f46e5; color:#ffffff; text-decoration:none;
                      padding:12px 28px; border-radius:20px; font-size:14px; font-weight:bold;">
              קבלת ההזמנה
            </a>
          </div>
          <p style="font-size:12px; color:#9ca3af; margin:0 0 4px; text-align:center;">
            אם הכפתור לא עובד, העתיקו את הקישור לדפדפן:
          </p>
          <p style="font-size:12px; margin:0; text-align:center;">
            <a href="${inviteUrl}" style="color:#4f46e5; word-break:break-all;">${inviteUrl}</a>
          </p>
        </div>
        <div style="background:#f9fafb; padding:12px 24px; text-align:center; border-top:1px solid #e5e7eb;">
          <p style="font-size:10px; color:#9ca3af; margin:0;">נשלח על ידי work-it</p>
        </div>
      </div>
    </div>
  `

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html }),
    })
    return res.ok
  } catch (e) {
    console.error('resend send failed', e)
    return false
  }
}

Deno.serve(async (req) => {
  const pre = corsPreflight(req); if (pre) return pre
  try {
    const body = await req.json()
    const action = body?.action

    if (action === 'create') {
      const orgId = body?.orgId
      const email = String(body?.email ?? '').trim().toLowerCase()
      const role = body?.role

      if (!orgId || !EMAIL_RE.test(email) || !VALID_ROLES.includes(role)) {
        return json({ error: 'bad request' }, 400)
      }

      const auth = await requireOrgAdmin(req, orgId)
      if (auth instanceof Response) return auth

      const svc = serviceClient()
      const { data: invitation, error: insErr } = await svc
        .from('invitations')
        .insert({ org_id: orgId, email, role, invited_by: auth.userId })
        .select('id, token')
        .single()

      if (insErr) {
        if (insErr.code === '23505') return json({ error: 'already_invited' }, 409)
        console.error('invite insert failed', insErr)
        return json({ error: 'internal' }, 500)
      }

      const [{ data: org }, { data: inviter }] = await Promise.all([
        svc.from('organizations').select('name, logo_url').eq('id', orgId).maybeSingle(),
        svc.from('profiles').select('full_name, email').eq('id', auth.userId).maybeSingle(),
      ])

      const inviteUrl = buildInviteUrl(invitation.token)
      const emailSent = await sendInviteEmail({
        to: email,
        orgName: org?.name ?? 'הארגון',
        orgLogoUrl: org?.logo_url,
        inviterName: inviter?.full_name || inviter?.email || 'חבר צוות',
        inviteUrl,
      })

      if (emailSent) {
        await svc.from('invitations').update({ last_sent_at: new Date().toISOString() }).eq('id', invitation.id)
      }

      return json({ ok: true, emailSent, inviteUrl })
    }

    if (action === 'resend') {
      const orgId = body?.orgId
      const invitationId = body?.invitationId
      if (!orgId || !invitationId) return json({ error: 'bad request' }, 400)

      const auth = await requireOrgAdmin(req, orgId)
      if (auth instanceof Response) return auth

      const svc = serviceClient()
      const { data: invitation } = await svc
        .from('invitations')
        .select('id, org_id, email, token, status, invited_by, last_sent_at')
        .eq('id', invitationId)
        .maybeSingle()

      if (!invitation || invitation.org_id !== orgId || invitation.status !== 'pending') {
        return json({ error: 'not_found' }, 404)
      }

      if (invitation.last_sent_at && Date.now() - new Date(invitation.last_sent_at).getTime() < RESEND_COOLDOWN_MS) {
        return json({ error: 'too_soon' }, 429)
      }

      const [{ data: org }, { data: inviter }] = await Promise.all([
        svc.from('organizations').select('name, logo_url').eq('id', orgId).maybeSingle(),
        invitation.invited_by
          ? svc.from('profiles').select('full_name, email').eq('id', invitation.invited_by).maybeSingle()
          : Promise.resolve({ data: null }),
      ])

      const inviteUrl = buildInviteUrl(invitation.token)
      const emailSent = await sendInviteEmail({
        to: invitation.email,
        orgName: org?.name ?? 'הארגון',
        orgLogoUrl: org?.logo_url,
        inviterName: inviter?.full_name || inviter?.email || 'חבר צוות',
        inviteUrl,
      })

      if (emailSent) {
        await svc.from('invitations').update({ last_sent_at: new Date().toISOString() }).eq('id', invitation.id)
      }

      return json({ ok: true, emailSent, inviteUrl })
    }

    return json({ error: 'bad request' }, 400)
  } catch (e) {
    console.error(e)
    return json({ error: 'internal' }, 500)
  }
})
