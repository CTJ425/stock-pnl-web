/**
 * Run a large SQL string through `supabase db query --file` instead of as a command-line argument.
 *
 * Linux caps one argv string at 128 KiB (`E2BIG`, tested at 131,072 bytes); schema.sql alone is
 * 100 KB and data-public.sql grows with the users, so passing them as the `<sql>` argument fails
 * the first time a real restore runs — possibly after setup.sql already applied. An argument is
 * also world-readable in /proc/<pid>/cmdline, and these statements carry password hashes and the
 * CRON_SECRET. A 0600 file in a 0700 temp directory has neither problem (Task 193 M14).
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

/** `supabase db query` arguments for a SQL file against the linked project. */
function buildQueryArgs(filePath) {
  return ['db', 'query', '--linked', '--file', filePath]
}

/**
 * Write `sql` to a private temp file, call `fn(filePath)`, and always delete the file — also when
 * `fn` throws, because the content is secret.
 */
function withSqlFile(sql, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-sql-')) // mkdtemp creates it 0700
  const file = path.join(dir, 'statement.sql')
  try {
    fs.writeFileSync(file, sql, { mode: 0o600 })
    return fn(file)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

module.exports = { buildQueryArgs, withSqlFile }
