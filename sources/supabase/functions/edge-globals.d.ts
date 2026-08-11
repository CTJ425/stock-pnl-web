/**
 * Ambient declarations so `npm run typecheck:edge` can check these files with plain tsc.
 *
 * They exist because the Edge functions were **not typechecked at all** until 0.7.11: the root
 * tsconfig only includes `src`, so a missing import in `supabase/functions/` shipped clean through
 * `tsc` and `oxlint` and would only surface as a runtime crash on the server. That happened —— a
 * missing `rocDate` import reached the DEV container before anything complained.
 *
 * Deliberately minimal: this is a lint for "does it hold together", not a model of the Deno runtime.
 */
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}

declare module 'jsr:@supabase/supabase-js@2' {
  // The client is used dynamically throughout; typing it faithfully is a separate job.
  export function createClient(url: string, key: string, opts?: unknown): any
}
