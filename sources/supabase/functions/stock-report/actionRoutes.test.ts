import { describe, expect, it, vi } from 'vitest'
import { dispatchAction, type ActionRoute, type GateChecks } from './actionRoutes.ts'

const req = new Request('https://example.test', { method: 'POST' })
const ok = (tag: string) => async () => new Response(tag)
const unknown = () => new Response('unknown', { status: 400 })

function gates(cronOk: boolean, adminOk: boolean): GateChecks {
  return {
    cron: vi.fn(() => (cronOk ? null : new Response('cron-denied', { status: 401 }))),
    admin: vi.fn(async () => (adminOk ? null : new Response('admin-denied', { status: 403 }))),
  }
}

const routes = new Map<string, ActionRoute<unknown>>([
  ['c', { gate: 'cron', run: ok('ran-c') }],
  ['a', { gate: 'admin', run: ok('ran-a') }],
  ['s', { gate: 'self', run: ok('ran-s') }],
])

async function text(p: Promise<Response>) {
  return (await p).text()
}

describe('dispatchAction', () => {
  it('runs a handler only after its own gate passes', async () => {
    expect(await text(dispatchAction(routes, 'c', req, {}, gates(true, false), unknown))).toBe('ran-c')
    expect(await text(dispatchAction(routes, 'a', req, {}, gates(false, true), unknown))).toBe('ran-a')
  })

  it('returns the gate denial and never runs the handler', async () => {
    const run = vi.fn(ok('x'))
    const r = new Map<string, ActionRoute<unknown>>([['c', { gate: 'cron', run }], ['a', { gate: 'admin', run }]])
    expect((await dispatchAction(r, 'c', req, {}, gates(false, true), unknown)).status).toBe(401)
    expect((await dispatchAction(r, 'a', req, {}, gates(true, false), unknown)).status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('does not consult any gate for a self-authenticating action', async () => {
    const g = gates(false, false)
    expect(await text(dispatchAction(routes, 's', req, {}, g, unknown))).toBe('ran-s')
    expect(g.cron).not.toHaveBeenCalled()
    expect(g.admin).not.toHaveBeenCalled()
  })

  it('treats missing, non-string and inherited-member actions as unknown', async () => {
    for (const action of [undefined, 42, 'nope', '__proto__', 'toString', 'constructor']) {
      expect((await dispatchAction(routes, action, req, {}, gates(true, true), unknown)).status).toBe(400)
    }
  })
})
