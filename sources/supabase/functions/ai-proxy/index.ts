/**
 * Supabase Edge Function: ai-proxy.
 *
 * Deployment method (need to install Supabase CLI and log in):
 *   supabase functions deploy ai-proxy
 *
 * Spec 161: keeps the Google AI API key out of the browser. The browser still builds the
 * Google request body and parses the response (aiClient.ts); this function only injects the
 * server-side model name and API key and forwards Google's status/JSON verbatim. See
 * docs/agent/specs/161-ai-key-proxy.md for the full contract.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { handleAiProxy, type AiProxyDeps, type AiProxySettings } from './handler.ts'

// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are automatically injected by the Supabase execution
// environment. Service role bypasses RLS — required to read the google key/model, which
// authenticated users can no longer SELECT directly (schema.sql REVOKE). Also used to verify
// the caller's JWT via auth.getUser(token), same convention as stock-report/index.ts.
const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

const deps: AiProxyDeps = {
  async verifyJwt(token: string): Promise<boolean> {
    try {
      const { data, error } = await db.auth.getUser(token)
      return !error && !!data.user
    } catch {
      return false
    }
  },

  async readSettings(): Promise<AiProxySettings> {
    const { data, error } = await db
      .from('app_settings')
      .select('ai_provider, ai_model, ai_api_key')
      .eq('id', 1)
      .maybeSingle()
    // Never swallow this: without it a transient read failure looks exactly like
    // "provider is not google" and the caller gets a 400 for a 500-class fault.
    if (error) throw new Error(error.message)
    return {
      provider: data?.ai_provider ?? '',
      model: data?.ai_model ?? '',
      apiKey: data?.ai_api_key ?? '',
    }
  },

  fetchUpstream(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, init)
  },
}

Deno.serve(async (req) => handleAiProxy(req, deps))
