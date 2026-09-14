# Spec 161 — Keep the Google AI key out of the browser

- Task: 161
- Lane: 2 (auth, external API, Edge Function, schema)
- Created: 2026-09-14 Asia/Taipei
- Related: audit item A1

## 1. Problem

`app_settings` holds one shared row with `ai_api_key`. Its RLS SELECT policy is
`TO authenticated USING (true)` (`sources/supabase/schema.sql:262-266`). The browser reads
the column directly (`sources/src/services/aiSettings.ts:100`) and posts it to Google
(`sources/src/services/aiClient.ts:369-373`, header `x-goog-api-key`).

Result: every account that can log in can read the site-wide Google API key and spend the
owner's quota outside the app. `TASK.md` records `disable_signup=false` and
`mailer_autoconfirm=true`, so anyone can self-register and read it immediately.

## 2. Decision and scope

The user decided on 2026-09-14: **protect the `google` provider only**. The
`openai-compatible` path keeps its current browser-direct behaviour, because a local
Ollama endpoint is not reachable from a Supabase Edge Function.

Accepted residual risk (record as RISK-013): if an admin ever points `openai-compatible` at
a cloud endpoint that needs a real key, that key still reaches every authenticated browser.

## 3. Design — `ai-proxy` is a credential-injecting relay

The Edge Function does **not** re-implement the Google client. The browser keeps building
the request body and keeps parsing the response, so `buildBody`, the 400 retry,
`mapHttpError` and `extractGoogleText` stay in `aiClient.ts` with their tests.

The proxy adds exactly two things the browser must not hold: the API key and the model name.

```
browser                         ai-proxy (Deno)                 Google
  |  POST /functions/v1/ai-proxy       |                            |
  |  Authorization: Bearer <user JWT>  |                            |
  |  { googleBody: <built body> } ---> |                            |
  |                                    | getUser(jwt) -> 401 if bad |
  |                                    | service-role read of       |
  |                                    |   app_settings (key+model) |
  |                                    | POST v1beta/models/<model> |
  |                                    |   :generateContent    ---> |
  |                                    |   x-goog-api-key: <key>    |
  |  <--- upstream status + JSON <---- | <------------------------- |
```

The proxy forwards Google's HTTP status verbatim. That is what keeps the browser's existing
400-retry, `mapHttpError` and timeout logic correct.

### 3.1 Why direct `fetch`, not `supabase.functions.invoke`

Every other service here uses `functions.invoke`. This path must not, for two reasons:

1. `functions.invoke` collapses a non-2xx response into `FunctionsHttpError` and hides the
   status code. The Google path branches on 400 (retry without `thinkingConfig`), 401, 429
   and 5xx.
2. `requestJson` (`aiClient.ts:305-347`) holds a 180 s timer that must also cover reading the
   body. `functions.invoke` has no equivalent.

So `GoogleProviderImpl` keeps calling `requestJson`; only the URL and headers change.

## 4. Contract

### 4.1 Database (`sources/supabase/schema.sql`)

1. Take the key column away from `authenticated`:

```sql
REVOKE SELECT ON public.app_settings FROM authenticated, anon;
GRANT SELECT (id, ai_provider, ai_base_url, ai_model, ai_updated_at, ai_prompt_analysis, ai_prompt_chat)
  ON public.app_settings TO authenticated;
```

   **Correction, 2026-09-14.** This spec first said
   `REVOKE SELECT (ai_api_key) ON public.app_settings FROM authenticated, anon;`. That is
   wrong and fails silently. Supabase grants `authenticated` table-level SELECT on every
   table in `public`, and Postgres checks the table-level privilege first, so a column-level
   REVOKE cannot subtract from it. Measured on supabase/postgres 17.6: after that REVOKE,
   `SET ROLE authenticated; SELECT secret FROM t;` still returned the value. The fix would
   have been a no-op that every test still passed.

   The order above was then verified end to end on the same engine, against a table with the
   real column list: a direct `SELECT ai_api_key` raises `permission denied for table
   app_settings`; `ai_provider` / `ai_model` / `ai_prompt_analysis` still read; the admin
   UPDATE still succeeds; `get_ai_settings()` returns `''` for google and the real key for
   openai-compatible.

   A column added to this table later is NOT readable until it is added to the GRANT.
   No `select('*')` on this table exists in the codebase, so no other read breaks.
   Row-level policies are unchanged. INSERT/UPDATE privileges are unaffected.
2. Add a `SECURITY DEFINER` reader that never returns a google key:

```sql
CREATE OR REPLACE FUNCTION public.get_ai_settings()
RETURNS TABLE (ai_provider TEXT, ai_base_url TEXT, ai_model TEXT, ai_api_key TEXT, ai_has_key BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ai_provider, ai_base_url, ai_model,
         CASE WHEN ai_provider = 'google' THEN '' ELSE COALESCE(ai_api_key, '') END,
         (ai_api_key IS NOT NULL AND ai_api_key <> '')
  FROM app_settings WHERE id = 1;
$$;
REVOKE ALL ON FUNCTION public.get_ai_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ai_settings() TO authenticated;
```

3. Ship the same two statements as `docs/agent/161-ai-key-proxy-migration.sql` for DEV/PROD.

### 4.2 Edge Function `sources/supabase/functions/ai-proxy/index.ts` (new)

- `OPTIONS` returns the CORS preflight used by `stock-report` (`Access-Control-Allow-Origin: *`,
  allowed headers include `authorization`, `apikey`, `content-type`).
- Method other than `POST` -> 405.
- Missing or invalid `Authorization: Bearer <jwt>` -> 401 `{ error }`. Validate with
  `db.auth.getUser(token)` on an anon client, exactly as `stock-report/index.ts:951-955`.
- Request body must be `{ googleBody: object }`. Reject a body over 256 KB with 413.
  Reject a missing or non-object `googleBody` with 400.
- Read `ai_provider`, `ai_model`, `ai_api_key` from `app_settings` with a service-role client
  built as in `backup-transactions/index.ts:39-41`.
- `ai_provider <> 'google'` -> 400 `{ error: 'ai-proxy 只處理 google 供應商' }`.
- Missing key or model -> 500 `{ error }` naming which field is unset.
- POST `https://generativelanguage.googleapis.com/v1beta/models/<encodeURIComponent(ai_model)>:generateContent`
  with headers `Content-Type: application/json` and `x-goog-api-key: <ai_api_key>`, body =
  the client's `googleBody` **verbatim**.
- Respond with Google's status code and Google's JSON body verbatim.
- Must NOT: log the key, echo the key in any response, accept a model or URL from the client,
  or read `app_settings` with the caller's JWT.

### 4.3 `sources/src/services/aiClient.ts`

- `GoogleProviderImpl.complete()` keeps `buildBody`, the single 400 retry, `mapHttpError`
  and `extractGoogleText` unchanged.
- It now posts to `` `${supabaseUrl}/functions/v1/ai-proxy` `` (`supabaseUrl` is already exported
  from `./supabase`) with headers `Content-Type: application/json` and
  `Authorization: Bearer <session access token>`; body `JSON.stringify({ googleBody })`.
  Do **not** send an `apikey` header: the user JWT is enough, and the anon key is not exported.
- `settings.model` is no longer used on the google path. The proxy reads the model from
  `app_settings`, so a caller cannot redirect the request to another model.
- The session token comes from `supabase.auth.getSession()`. No session -> throw
  `AiError('auth', '請先登入後再使用 AI 功能')`.
- `this.settings.apiKey` must no longer appear in any request this class makes.
- `OpenAiCompatibleProviderImpl`, `createAiProvider`, `requestJson`, `normalizeBaseUrl`,
  `mapHttpError`, `extractGoogleText`, `extractOpenAiText`, `stripThinkTags` and
  `toGoogleContents` are unchanged.

### 4.4 `sources/src/services/aiSettings.ts`

- `loadAiSettings()` calls `client().rpc('get_ai_settings')` and normalizes the first row.
  On error or empty -> `null`, as today.
- New export `loadAiSettingsView(): Promise<{ settings: AiSettings | null; hasKey: boolean }>`
  returning the same row plus `ai_has_key`. `loadAiSettings()` stays for existing callers.
- `saveAiSettings(s, hasStoredKey = false)`: when `s.provider === 'google'`, `s.apiKey` is
  empty and `hasStoredKey` is true, omit `ai_api_key` from the upsert so the stored key
  survives an edit of the model. It passes `hasStoredKey` through to `validateAiSettings`.
  Everything else is unchanged.
- `validateAiSettings(s)` gains a second optional argument `hasStoredKey = false`. The
  google-needs-a-key rule passes when `hasStoredKey` is true. Default keeps today's behaviour.
- `clearAiSettings()` is unchanged.

### 4.5 `sources/src/components/Admin/AiConnectionSection.tsx`

- Line 49 must stop prefilling the key field: a google key can no longer be read back.
- Load through `loadAiSettingsView()`. When `hasKey` is true, render the hint
  `已設定（留空則不更動）` next to the API Key label and keep the input empty.
- Pass `hasKey` to `validateAiSettings` so saving a model-only edit is allowed.

## 5. Test charter

| Case | Expected outcome | Layer / file |
| --- | --- | --- |
| Google complete() posts to the ai-proxy URL | URL ends `/functions/v1/ai-proxy` | `src/services/aiClient.test.ts` |
| Google complete() sends the user JWT | header `Authorization: Bearer test-token` | same |
| Google complete() never sends the key | no `x-goog-api-key` header, key string absent from body | same |
| Google body still carries systemInstruction + contents | body `googleBody` matches today's shape | same |
| Google 400 still retries once without thinkingConfig | 2 calls, second body has no `thinkingConfig` | same |
| Google 400 twice gives up | exactly 2 calls, throws AiError | same |
| Google 401 does not retry | 1 call, throws AiError('auth') | same |
| No session | throws AiError('auth'), 0 fetch calls | same |
| openai-compatible path unchanged | existing assertions still pass untouched | same |
| `loadAiSettings` reads via rpc('get_ai_settings') | rpc called, settings normalized | `src/services/aiSettings.test.ts` |
| `loadAiSettingsView` returns hasKey | `{ settings, hasKey: true }` | same |
| google save with empty apiKey omits the column | upsert payload has no `ai_api_key` key | same |
| google save with a new apiKey writes it | upsert payload carries the new value | same |
| `validateAiSettings` accepts empty google key when stored | returns null | same |
| ai-proxy rejects a non-POST method | 405 | `supabase/functions/ai-proxy/handler.test.ts` |
| ai-proxy rejects a missing JWT | 401 | same |
| ai-proxy rejects a non-google provider | 400 | same |
| ai-proxy forwards the upstream status and JSON | status and body passthrough | same |
| ai-proxy sends the stored model and key upstream | URL has the stored model, header has the key | same |
| ai-proxy never takes a model from the client | client-supplied model is ignored | same |

To keep the handler testable, put the request logic in
`sources/supabase/functions/ai-proxy/handler.ts` as an exported
`handleAiProxy(req, deps)` where `deps` supplies the settings reader, the JWT verifier and
`fetch`. `index.ts` only wires the real dependencies to `Deno.serve`.

## 6. Files

```
sources/supabase/schema.sql                              (edit)
sources/supabase/functions/ai-proxy/index.ts             (new)
sources/supabase/functions/ai-proxy/handler.ts           (new)
sources/src/services/aiClient.ts                         (edit)
sources/src/services/aiSettings.ts                       (edit)
sources/src/components/Admin/AiConnectionSection.tsx     (edit)
docs/agent/161-ai-key-proxy-migration.sql                (new)
```

Test files are written by the main session and are not builder's to edit. They already exist
and currently fail:

```
sources/src/services/aiClient.test.ts                    (updated)
sources/src/services/aiSettings.test.ts                  (updated)
sources/supabase/functions/ai-proxy/handler.test.ts      (new)
```

## 7. Non-goals

- No change to `openai-compatible` request or response handling.
- No streaming, no retry policy change, no timeout change.
- No prompt-column change (`ai_prompt_analysis`, `ai_prompt_chat` stay readable).
- No deploy. The Edge deploy and the two SQL statements need the user's explicit approval.

## 8. Verify

From `sources/`:

```
npm run lint && npm run build && npm run typecheck:edge && npm test
```

All four must exit 0.
