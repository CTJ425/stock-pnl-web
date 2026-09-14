/**
 * Cloudflare R2 offsite backup target (phase 4).
 *
 * R2 is S3-compatible, so this signs plain AWS SigV4 requests (service `s3`, region `auto`)
 * with Web Crypto — no npm/JSR dependency, so it bundles the same as the rest of this Edge
 * function. See docs/agent/specs/144-admin-enhancements-and-backups.md for the exact signing
 * rules; the SigV4 vectors in r2.test.ts come from an independent Python implementation.
 */
import { describeError, prunablePaths } from './backupPlan.ts'

export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

export interface SignedRequest {
  url: string
  headers: Record<string, string>
}

export interface R2SyncResult {
  status: 'ok' | 'skipped' | 'failed'
  error: string | null
  pruned: number
}

export interface R2Deps {
  fetch?: typeof fetch
  now?: () => Date
}

const REGION = 'auto'
const SERVICE = 's3'

/** Returns null if any one of the four variables is absent OR an empty string. */
export function readR2Config(getEnv: (name: string) => string | undefined): R2Config | null {
  const accountId = getEnv('R2_ACCOUNT_ID')
  const accessKeyId = getEnv('R2_ACCESS_KEY_ID')
  const secretAccessKey = getEnv('R2_SECRET_ACCESS_KEY')
  const bucket = getEnv('R2_BUCKET_NAME')
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null
  return { accountId, accessKeyId, secretAccessKey, bucket }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  // TS 5.7 made ArrayBufferView generic on the buffer type; Uint8Array's inferred
  // `ArrayBufferLike` does not satisfy DOM's `BufferSource` (`ArrayBuffer` only) without a cast.
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource)
  return toHex(new Uint8Array(digest))
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
  return new Uint8Array(sig)
}

function amzDate(now: Date): string {
  // 'YYYYMMDDTHHMMSSZ' — slice out of the ISO string rather than reformat by hand.
  const iso = now.toISOString()
  return iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10) + 'T' +
    iso.slice(11, 13) + iso.slice(14, 16) + iso.slice(17, 19) + 'Z'
}

/**
 * AWS SigV4 URI-encode: unreserved bytes (letters, digits, `-`, `_`, `.`, `~`) pass through
 * verbatim; everything else is percent-encoded. `/` is left literal for a path (`encodeSlash`
 * false) and percent-encoded for a query key/value (`encodeSlash` true).
 */
function uriEncode(input: string, encodeSlash: boolean): string {
  const bytes = new TextEncoder().encode(input)
  let out = ''
  for (const byte of bytes) {
    const char = String.fromCharCode(byte)
    if (byte < 128 && /[A-Za-z0-9\-_.~]/.test(char)) {
      out += char
    } else if (byte === 0x2f /* '/' */) {
      out += encodeSlash ? '%2F' : '/'
    } else {
      out += '%' + byte.toString(16).toUpperCase().padStart(2, '0')
    }
  }
  return out
}

function canonicalQuery(query: Array<[string, string]> | undefined): string {
  const encoded = (query ?? []).map(([k, v]) => [uriEncode(k, true), uriEncode(v, true)] as [string, string])
  encoded.sort(([ak, av], [bk, bv]) => {
    if (ak !== bk) return ak < bk ? -1 : 1
    if (av !== bv) return av < bv ? -1 : 1
    return 0
  })
  return encoded.map(([k, v]) => `${k}=${v}`).join('&')
}

/** AWS SigV4, service `s3`, region `auto`. Signed headers: host;x-amz-content-sha256;x-amz-date. */
export async function signR2Request(input: {
  method: 'PUT' | 'GET' | 'DELETE'
  config: R2Config
  key?: string
  query?: Array<[string, string]>
  body?: Uint8Array
  now: Date
}): Promise<SignedRequest> {
  const { method, config, key, query, body, now } = input
  const host = `${config.accountId}.r2.cloudflarestorage.com`
  const date = amzDate(now)
  const dateStamp = date.slice(0, 8)
  const payloadHash = await sha256Hex(body ?? new Uint8Array(0))

  const canonicalUri = uriEncode(`/${config.bucket}${key ? `/${key}` : ''}`, false)
  const canonicalQueryString = canonicalQuery(query)
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${date}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    date,
    credentialScope,
    await sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join('\n')

  const kDate = await hmac(new TextEncoder().encode(`AWS4${config.secretAccessKey}`), dateStamp)
  const kRegion = await hmac(kDate, REGION)
  const kService = await hmac(kRegion, SERVICE)
  const kSigning = await hmac(kService, 'aws4_request')
  const signature = toHex(await hmac(kSigning, stringToSign))

  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  const url = `https://${host}${canonicalUri}${canonicalQueryString ? `?${canonicalQueryString}` : ''}`

  return {
    url,
    headers: {
      authorization,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': date,
    },
  }
}

/** ListObjectsV2 XML -> keys plus the continuation token (null when the listing is complete). */
export function parseListKeys(xml: string): { keys: string[]; nextToken: string | null } {
  const keys: string[] = []
  const keyRe = /<Key>([^<]*)<\/Key>/g
  let match: RegExpExecArray | null
  while ((match = keyRe.exec(xml)) !== null) {
    keys.push(match[1])
  }
  const tokenMatch = xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)
  return { keys, nextToken: tokenMatch ? tokenMatch[1] : null }
}

async function putObject(
  config: R2Config,
  key: string,
  body: Uint8Array,
  now: Date,
  doFetch: typeof fetch,
): Promise<void> {
  const signed = await signR2Request({ method: 'PUT', config, key, body, now })
  const res = await doFetch(signed.url, { method: 'PUT', headers: signed.headers, body: body as BodyInit })
  if (!res.ok) throw new Error(`R2 PUT ${res.status} ${key}`)
}

async function deleteObject(
  config: R2Config,
  key: string,
  now: Date,
  doFetch: typeof fetch,
): Promise<void> {
  const signed = await signR2Request({ method: 'DELETE', config, key, now })
  const res = await doFetch(signed.url, { method: 'DELETE', headers: signed.headers })
  if (!res.ok) throw new Error(`R2 DELETE ${res.status} ${key}`)
}

/** Paginates ListObjectsV2 under `prefix` until the listing is complete. */
async function listAllKeys(
  config: R2Config,
  prefix: string,
  now: Date,
  doFetch: typeof fetch,
): Promise<string[]> {
  const keys: string[] = []
  let token: string | null = null
  const MAX_PAGES = 50
  for (let page = 0; page < MAX_PAGES; page++) {
    const query: Array<[string, string]> = [['list-type', '2'], ['prefix', prefix]]
    if (token) query.push(['continuation-token', token])
    const signed = await signR2Request({ method: 'GET', config, query, now })
    const res = await doFetch(signed.url, { method: 'GET', headers: signed.headers })
    if (!res.ok) throw new Error(`R2 GET ${res.status} ${prefix}`)
    const parsed = parseListKeys(await res.text())
    keys.push(...parsed.keys)
    if (!parsed.nextToken) return keys
    token = parsed.nextToken
    if (page === MAX_PAGES - 1) throw new Error(`R2 list exceeded 50 pages for ${prefix}`)
  }
  return keys
}

/** Lists `${userId}/`, applies the shared retention rule, and deletes what falls outside it. */
async function pruneOld(
  config: R2Config,
  userId: string,
  keepDays: number,
  now: Date,
  doFetch: typeof fetch,
): Promise<number> {
  const prefix = `${userId}/`
  const keys = await listAllKeys(config, prefix, now, doFetch)
  const names = keys.map((k) => k.slice(prefix.length))
  const toDelete = prunablePaths(names, keepDays)
  for (const name of toDelete) {
    await deleteObject(config, `${userId}/${name}`, now, doFetch)
  }
  return toDelete.length
}

export async function syncToR2(
  config: R2Config | null,
  input: { userId: string; backupDate: string; body: Uint8Array; keepDays: number },
  deps: R2Deps = {},
): Promise<R2SyncResult> {
  if (!config) return { status: 'skipped', error: null, pruned: 0 }

  const doFetch = deps.fetch ?? fetch
  const now = deps.now ?? (() => new Date())
  const key = `${input.userId}/${input.backupDate}.json`

  try {
    await putObject(config, key, input.body, now(), doFetch)
  } catch (err) {
    return { status: 'failed', error: describeError(err), pruned: 0 }
  }

  // The offsite copy already landed, so a prune failure keeps status 'ok' and only reports.
  try {
    const pruned = await pruneOld(config, input.userId, input.keepDays, now(), doFetch)
    return { status: 'ok', error: null, pruned }
  } catch (err) {
    return { status: 'ok', error: describeError(err), pruned: 0 }
  }
}
