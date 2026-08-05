/**
 * Supabase client initialization.
 * If the environment variable is not set, null is returned and the application is downgraded to "native mode".
 * (localStorage storage, no login required), convenient for use before creating a Supabase project.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url: string | undefined = import.meta.env.VITE_SUPABASE_URL
const anonKey: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured: boolean = Boolean(
  url && anonKey && !url.startsWith('YOUR_') && !anonKey.startsWith('YOUR_'),
)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!)
  : null
