/**
 * Argument vectors for the `gh` calls in sync-github-releases.cjs.
 *
 * Kept pure and shell-free on purpose: the release title comes from a CHANGELOG heading, and
 * headings contain backticks (`app_log`, `computeLedger()`). Interpolated into a double-quoted
 * `execSync` string those are command substitution — the shell ran them (the 0.9.35 and 0.9.33
 * Release titles lost their `code` text that way) and a `$(…)` heading would have executed in CI
 * with a write token (Task 193 M13). Passing an array to `execFileSync` never involves a shell.
 */

/** `gh release create` for a version that has no Release yet. */
function buildCreateArgs({ tag, targetCommit, title, notesFile, isLatest }) {
  return [
    'release', 'create', tag,
    '--target', targetCommit,
    '--title', title,
    '--notes-file', notesFile,
    isLatest ? '--latest' : '--latest=false',
  ]
}

/** `gh release edit` for `--force` updates of an existing Release. */
function buildEditArgs({ tag, title, notesFile }) {
  return ['release', 'edit', tag, '--title', title, '--notes-file', notesFile]
}

module.exports = { buildCreateArgs, buildEditArgs }
