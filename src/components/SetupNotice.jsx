import { isSupabaseConfigured } from '../lib/supabase'

// באנר שמופיע רק כל עוד לא הוגדר חיבור ל-Supabase (קובץ .env ריק)
export default function SetupNotice() {
  if (isSupabaseConfigured) return null
  return (
    <div className="bg-status-orange/15 border-b border-status-orange/40 px-4 py-2 text-center text-sm text-status-orange">
      החיבור ל-Supabase עדיין לא הוגדר. נשלים אותו בשלב הקמת בסיס הנתונים — עד אז ההתחברות לא תעבוד.
    </div>
  )
}
