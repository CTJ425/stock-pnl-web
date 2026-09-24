/**
 * Action routing for stock-report: every action names its auth gate next to its handler, so the
 * gate an action sits behind is one table row, not a line buried in a 30-branch if chain.
 *
 * - `cron`  — `x-cron-secret` must match `CRON_SECRET` (pg_cron and other server callers)
 * - `admin` — caller's JWT must carry `app_metadata.role === 'admin'`
 * - `self`  — the handler authenticates on its own (e.g. assertUser, or admin-run's own check)
 */
export type ActionGate = 'cron' | 'admin' | 'self'

export interface ActionRoute<B> {
  gate: ActionGate
  run: (req: Request, body: B) => Promise<Response>
}

export interface GateChecks {
  cron: (req: Request) => Response | null
  admin: (req: Request) => Promise<Response | null>
}

/**
 * Runs the handler for `action` behind its gate. A Map lookup, not an object index: a body with
 * `"action": "__proto__"` or `"toString"` must land on `unknown`, never on an inherited member.
 */
export async function dispatchAction<B>(
  routes: ReadonlyMap<string, ActionRoute<B>>,
  action: unknown,
  req: Request,
  body: B,
  gates: GateChecks,
  unknown: () => Response,
): Promise<Response> {
  const route = typeof action === 'string' ? routes.get(action) : undefined
  if (!route) return unknown()
  if (route.gate === 'cron') {
    const denied = gates.cron(req)
    if (denied) return denied
  } else if (route.gate === 'admin') {
    const denied = await gates.admin(req)
    if (denied) return denied
  }
  return await route.run(req, body)
}
