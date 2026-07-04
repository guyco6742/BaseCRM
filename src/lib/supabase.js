import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// האם החיבור ל-Supabase הוגדר (קובץ .env מלא)?
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey)

// אם עדיין לא הוגדר, יוצרים client עם ערכי מקום כדי שהאפליקציה לא תקרוס בזמן פיתוח.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseKey || 'placeholder-anon-key'
)
