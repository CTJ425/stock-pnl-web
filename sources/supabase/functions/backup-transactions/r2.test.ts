import { describe, expect, it } from 'vitest'
import {
  parseListKeys,
  readR2Config,
  signR2Request,
  syncToR2,
  type R2Config,
} from './r2'

/**
 * The SigV4 expectations below come from an independent Python (stdlib `hmac`/`hashlib`)
 * implementation, not from this TypeScript code. Without a live R2 bucket that cross-check is
 * the only proof that the signature is correct — a signature test written against the same
 * implementation it verifies proves nothing.
 *
 * Fixed inputs for every vector:
 *   accountId  abc123def456
 *   accessKey  AKIAIOSFODNN7EXAMPLE
 *   secret     wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
 *   bucket     stock-pnl-backups
 *   timestamp  2026-09-14T01:56:14Z  ->  20260914T015614Z
 *   region     auto      service  s3
 */
const CONFIG: R2Config = {
  accountId: 'abc123def456',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  bucket: 'stock-pnl-backups',
}
const NOW = new Date('2026-09-14T01:56:14Z')
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

describe('signR2Request', () => {
  it('signs a PUT to match the independent reference vector', async () => {
    const signed = await signR2Request({
      method: 'PUT',
      config: CONFIG,
      key: 'u-1/2026-09-14.json',
      body: new TextEncoder().encode('{"ok":1}'),
      now: NOW,
    })
    expect(signed.url).toBe(
      'https://abc123def456.r2.cloudflarestorage.com/stock-pnl-backups/u-1/2026-09-14.json',
    )
    expect(signed.headers['x-amz-date']).toBe('20260914T015614Z')
    expect(signed.headers['x-amz-content-sha256']).toBe(
      '39f94024cbcf740958d8bb6e25095e33ee260776744698ff4e0d43a4454bf72f',
    )
    expect(signed.headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20260914/auto/s3/aws4_request, ' +
        'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
        'Signature=0a330d22890b24192b9d105c9c73529fff2a6e22cdbc12be15b0d179b56590b4',
    )
  })

  it('signs a ListObjectsV2 GET, and percent-encodes the prefix in the query', async () => {
    const signed = await signR2Request({
      method: 'GET',
      config: CONFIG,
      query: [
        ['list-type', '2'],
        ['prefix', 'u-1/'],
      ],
      now: NOW,
    })
    expect(signed.url).toBe(
      'https://abc123def456.r2.cloudflarestorage.com/stock-pnl-backups?list-type=2&prefix=u-1%2F',
    )
    expect(signed.headers['x-amz-content-sha256']).toBe(EMPTY_SHA256)
    expect(signed.headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20260914/auto/s3/aws4_request, ' +
        'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
        'Signature=40863773b75ae2908e8fff50dc13c182b7cfa23825dd180375b7bc1bd491dd64',
    )
  })

  it('percent-encodes a key, leaving / and ~ unreserved', async () => {
    const signed = await signR2Request({
      method: 'PUT',
      config: CONFIG,
      key: 'u 1/a+b~c.json',
      body: new TextEncoder().encode('{"ok":1}'),
      now: NOW,
    })
    expect(signed.url).toBe(
      'https://abc123def456.r2.cloudflarestorage.com/stock-pnl-backups/u%201/a%2Bb~c.json',
    )
    expect(signed.headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20260914/auto/s3/aws4_request, ' +
        'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
        'Signature=d08e12962fa0aec185d121bd686b4afa4e83ae1f94209c9ead37e10322f1def7',
    )
  })

  it('percent-encodes a query value, where / is reserved and ~ is not', async () => {
    const signed = await signR2Request({
      method: 'GET',
      config: CONFIG,
      query: [
        ['list-type', '2'],
        ['prefix', 'u 1/a+b~c'],
      ],
      now: NOW,
    })
    expect(signed.url).toBe(
      'https://abc123def456.r2.cloudflarestorage.com/stock-pnl-backups' +
        '?list-type=2&prefix=u%201%2Fa%2Bb~c',
    )
    expect(signed.headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20260914/auto/s3/aws4_request, ' +
        'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
        'Signature=c084be4a6a7fe16436dbac559f7890270cba583e30302033e5902fb6d038a6cb',
    )
  })

  it('signs a DELETE with the empty-payload hash', async () => {
    const signed = await signR2Request({
      method: 'DELETE',
      config: CONFIG,
      key: 'u-1/2026-09-07.json',
      now: NOW,
    })
    expect(signed.headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20260914/auto/s3/aws4_request, ' +
        'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
        'Signature=a525f2bc8b2e63ae8e20bb7f4f06c50f0392f027234260a307d54e87ae77a115',
    )
  })
})

describe('readR2Config', () => {
  const full: Record<string, string> = {
    R2_ACCOUNT_ID: 'abc123def456',
    R2_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
    R2_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    R2_BUCKET_NAME: 'stock-pnl-backups',
  }

  it('reads all four variables', () => {
    expect(readR2Config((n) => full[n])).toEqual(CONFIG)
  })

  it.each(Object.keys(full))('returns null when %s is absent', (missing) => {
    const partial = { ...full }
    delete partial[missing]
    expect(readR2Config((n) => partial[n])).toBeNull()
  })

  it('treats an empty string as absent, so a blank secret never signs a request', () => {
    expect(readR2Config((n) => (n === 'R2_BUCKET_NAME' ? '' : full[n]))).toBeNull()
  })
})

describe('parseListKeys', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Contents><Key>u-1/2026-09-14.json</Key><Size>12</Size></Contents>
  <Contents><Key>u-1/2026-09-13.json</Key><Size>12</Size></Contents>
  <IsTruncated>true</IsTruncated>
  <NextContinuationToken>1ueGcxLPRx1Tr</NextContinuationToken>
</ListBucketResult>`

  it('extracts every key and the continuation token', () => {
    expect(parseListKeys(xml)).toEqual({
      keys: ['u-1/2026-09-14.json', 'u-1/2026-09-13.json'],
      nextToken: '1ueGcxLPRx1Tr',
    })
  })

  it('returns a null token when the listing is complete', () => {
    const done = xml
      .replace('<IsTruncated>true</IsTruncated>', '<IsTruncated>false</IsTruncated>')
      .replace('<NextContinuationToken>1ueGcxLPRx1Tr</NextContinuationToken>', '')
    expect(parseListKeys(done).nextToken).toBeNull()
  })

  it('returns an empty list for a bucket prefix with no objects', () => {
    expect(parseListKeys('<ListBucketResult><KeyCount>0</KeyCount></ListBucketResult>')).toEqual({
      keys: [],
      nextToken: null,
    })
  })
})

/** Records every request so a test can assert method, url and body. */
function recordingFetch(
  reply: (url: string, init: RequestInit) => { status: number; body?: string },
): { fetch: typeof fetch; calls: Array<{ method: string; url: string; body: string }> } {
  const calls: Array<{ method: string; url: string; body: string }> = []
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = String(init?.method ?? 'GET')
    const raw = init?.body
    const body = raw instanceof Uint8Array ? new TextDecoder().decode(raw) : String(raw ?? '')
    calls.push({ method, url, body })
    const r = reply(url, init ?? {})
    return new Response(r.body ?? '', { status: r.status })
  }) as unknown as typeof fetch
  return { fetch: impl, calls }
}

function listXml(keys: string[]): string {
  const contents = keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('')
  return `<ListBucketResult>${contents}<IsTruncated>false</IsTruncated></ListBucketResult>`
}

const INPUT = {
  userId: 'u-1',
  backupDate: '2026-09-14',
  body: new TextEncoder().encode('{"ok":1}'),
  keepDays: 7,
}

describe('syncToR2', () => {
  it('skips without touching the network when R2 is not configured', async () => {
    const { fetch, calls } = recordingFetch(() => ({ status: 200 }))
    const result = await syncToR2(null, INPUT, { fetch, now: () => NOW })
    expect(result).toEqual({ status: 'skipped', error: null, pruned: 0 })
    expect(calls).toHaveLength(0)
  })

  it('uploads the same key the Supabase copy uses, then prunes past keepDays', async () => {
    // 9 dated objects. keepDays 7 keeps the 7 newest and deletes the 2 oldest.
    const existing = [
      '2026-09-14', '2026-09-13', '2026-09-12', '2026-09-11', '2026-09-10',
      '2026-09-09', '2026-09-08', '2026-09-07', '2026-09-06',
    ].map((d) => `u-1/${d}.json`)
    const { fetch, calls } = recordingFetch((url) => ({
      status: 200,
      body: url.includes('list-type=2') ? listXml(existing) : '',
    }))

    const result = await syncToR2(CONFIG, INPUT, { fetch, now: () => NOW })

    expect(result).toEqual({ status: 'ok', error: null, pruned: 2 })
    const put = calls.find((c) => c.method === 'PUT')
    expect(put?.url).toBe(
      'https://abc123def456.r2.cloudflarestorage.com/stock-pnl-backups/u-1/2026-09-14.json',
    )
    expect(put?.body).toBe('{"ok":1}')
    const deleted = calls.filter((c) => c.method === 'DELETE').map((c) => c.url)
    expect(deleted).toEqual([
      'https://abc123def456.r2.cloudflarestorage.com/stock-pnl-backups/u-1/2026-09-07.json',
      'https://abc123def456.r2.cloudflarestorage.com/stock-pnl-backups/u-1/2026-09-06.json',
    ])
  })

  it('ignores objects that are not dated JSON, so an unrelated key is never deleted', async () => {
    const { fetch, calls } = recordingFetch((url) => ({
      status: 200,
      body: url.includes('list-type=2') ? listXml(['u-1/notes.txt', 'u-1/2026-09-14.json']) : '',
    }))
    const result = await syncToR2(CONFIG, INPUT, { fetch, now: () => NOW })
    expect(result.pruned).toBe(0)
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it('reports failed, and does not throw, when the upload is rejected', async () => {
    const { fetch } = recordingFetch(() => ({ status: 403, body: 'AccessDenied' }))
    const result = await syncToR2(CONFIG, INPUT, { fetch, now: () => NOW })
    expect(result).toEqual({
      status: 'failed',
      error: 'R2 PUT 403 u-1/2026-09-14.json',
      pruned: 0,
    })
  })

  it('keeps status ok when only the prune fails, because the offsite copy already landed', async () => {
    const { fetch } = recordingFetch((url) => ({ status: url.includes('list-type=2') ? 500 : 200 }))
    const result = await syncToR2(CONFIG, INPUT, { fetch, now: () => NOW })
    expect(result).toEqual({ status: 'ok', error: 'R2 GET 500 u-1/', pruned: 0 })
  })

  it('caps the listing loop, so a response that always returns a token cannot hang the run', async () => {
    // A nightly Edge invocation has no supervisor. An unbounded continuation loop would never
    // reach the catch, so the account would hang instead of recording a failure.
    const truncated =
      '<ListBucketResult><Contents><Key>u-1/2026-09-14.json</Key></Contents>' +
      '<IsTruncated>true</IsTruncated><NextContinuationToken>never-ends</NextContinuationToken>' +
      '</ListBucketResult>'
    const { fetch, calls } = recordingFetch((url) => ({
      status: 200,
      body: url.includes('list-type=2') ? truncated : '',
    }))

    const result = await syncToR2(CONFIG, INPUT, { fetch, now: () => NOW })

    // The upload already landed, so the run stays ok and the cap is recorded as the prune error.
    expect(result.status).toBe('ok')
    expect(result.pruned).toBe(0)
    expect(result.error).toBe('R2 list exceeded 50 pages for u-1/')
    expect(calls.filter((c) => c.url.includes('list-type=2'))).toHaveLength(50)
  })

  it('never lets an R2 network error escape to the caller', async () => {
    const impl = (async () => {
      throw new TypeError('network unreachable')
    }) as unknown as typeof fetch
    const result = await syncToR2(CONFIG, INPUT, { fetch: impl, now: () => NOW })
    expect(result.status).toBe('failed')
    expect(result.error).toBe('network unreachable')
  })
})
