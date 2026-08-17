#!/usr/bin/env node

/**
 * sync-github-releases.cjs
 *
 * Synchronizes versions from docs/agent/CHANGELOG.md to GitHub Releases.
 *
 * Features:
 *  - Parses docs/agent/CHANGELOG.md into structured version entries.
 *  - Finds matching git commit SHAs for each version.
 *  - Creates or updates GitHub Releases via GitHub CLI (gh) or REST API.
 *  - Supports modes:
 *      --all            : Sync all versions in CHANGELOG.md (from oldest to newest)
 *      --latest         : Sync only the current project version (from package.json / version.ts)
 *      --version <ver>  : Sync a specific version
 *      --dry-run        : Preview operations without executing
 *      --force          : Update existing releases with new notes/title
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Determine repo root
const repoRoot = path.resolve(__dirname, '../..');
const changelogPath = path.join(repoRoot, 'docs/agent/CHANGELOG.md');
const packageJsonPath = path.join(repoRoot, 'sources/package.json');
const versionTsPath = path.join(repoRoot, 'sources/src/version.ts');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    all: false,
    latest: false,
    version: null,
    dryRun: false,
    force: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--all') {
      options.all = true;
    } else if (arg === '--latest') {
      options.latest = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--version' && i + 1 < args.length) {
      options.version = args[++i];
    }
  }

  // Default to --latest if no mode is specified
  if (!options.all && !options.version && !options.latest) {
    options.latest = true;
  }

  return options;
}

function parseChangelog() {
  if (!fs.existsSync(changelogPath)) {
    throw new Error(`CHANGELOG.md not found at ${changelogPath}`);
  }

  const content = fs.readFileSync(changelogPath, 'utf8');
  const lines = content.split('\n');
  const versions = [];
  let current = null;

  for (const line of lines) {
    const m = line.match(/^###\s+([0-9]+\.[0-9]+(?:\.[0-9]+)?)(?:（([^）]+)）)?(?:[—\- ]+(.*))?/);
    if (m) {
      if (current) {
        current.body = current.bodyLines.join('\n').trim();
        delete current.bodyLines;
        versions.push(current);
      }
      const version = m[1];
      const date = m[2] || '';
      const subtitle = m[3] ? m[3].trim() : '';
      const title = subtitle ? `${version} — ${subtitle}` : version;
      current = {
        version,
        date,
        subtitle,
        title,
        heading: line,
        bodyLines: [],
      };
    } else if (current) {
      current.bodyLines.push(line);
    }
  }

  if (current) {
    current.body = current.bodyLines.join('\n').trim();
    delete current.bodyLines;
    versions.push(current);
  }

  return versions;
}

function getGitCommits() {
  const logOut = execSync('git log --format="%H|%s|%aI"', { cwd: repoRoot })
    .toString()
    .trim()
    .split('\n');

  return logOut.map(line => {
    const [hash, subject, date] = line.split('|');
    return { hash, subject, date };
  });
}

function matchCommitForVersion(version, commits) {
  // Method 1: Check release / chore(release) / Merge branch with version
  let target = commits.find(c => {
    const isRelease = /release|定版|chore\(release\)|Merge branch/i.test(c.subject);
    const verMatch = new RegExp(`(^|[^0-9.])${version.replace(/\\./g, '\\.')}($|[^0-9.])`).test(c.subject);
    return isRelease && verMatch;
  });

  // Method 2: Commit subject ending with (version) or (v.version)
  if (!target) {
    target = commits.find(c => {
      return new RegExp(`\\(v?${version.replace(/\\./g, '\\.')}\\)$`).test(c.subject);
    });
  }

  // Method 3: Commit subject containing version and not -dev
  if (!target) {
    target = commits.find(c => {
      const verMatch = new RegExp(`(^|[^0-9.])${version.replace(/\\./g, '\\.')}($|[^0-9.])`).test(c.subject);
      const isDev = new RegExp(`${version.replace(/\\./g, '\\.')}-dev`).test(c.subject);
      return verMatch && !isDev;
    });
  }

  // Method 4: Any matching commit
  if (!target) {
    target = commits.find(c => {
      return new RegExp(`(^|[^0-9.])${version.replace(/\\./g, '\\.')}($|[^0-9.])`).test(c.subject);
    });
  }

  return target ? target.hash : null;
}

function getExistingReleases() {
  try {
    const output = execSync('gh release list --limit 300', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();

    if (!output) return new Set();

    const lines = output.split('\n');
    const existing = new Set();
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        existing.add(parts[2].trim()); // TAG NAME
      }
    }
    return existing;
  } catch (err) {
    console.warn('[WARN] Failed to list releases via gh CLI:', err.message);
    return new Set();
  }
}

function getLatestAppVersion() {
  if (fs.existsSync(packageJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (pkg.version) return pkg.version;
  }
  if (fs.existsSync(versionTsPath)) {
    const ts = fs.readFileSync(versionTsPath, 'utf8');
    const m = ts.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
    if (m) return m[1];
  }
  return null;
}

async function main() {
  const options = parseArgs();
  console.log(`=== GitHub Release Sync Tool ===`);
  console.log(`Mode: ${options.all ? 'ALL VERSIONS' : options.version ? `VERSION ${options.version}` : 'LATEST VERSION'}`);
  console.log(`Dry run: ${options.dryRun ? 'YES' : 'NO'}`);
  console.log(`Force update: ${options.force ? 'YES' : 'NO'}`);

  const allVersions = parseChangelog();
  console.log(`Loaded ${allVersions.length} versions from CHANGELOG.md`);

  const commits = getGitCommits();
  const existingReleases = getExistingReleases();
  console.log(`Found ${existingReleases.size} existing GitHub releases`);

  let targetVersions = [];

  if (options.all) {
    // Process from oldest to newest so newest ends up at top
    targetVersions = [...allVersions].reverse();
  } else if (options.version) {
    const found = allVersions.find(v => v.version === options.version);
    if (!found) {
      console.error(`[ERROR] Version ${options.version} not found in CHANGELOG.md`);
      process.exit(1);
    }
    targetVersions = [found];
  } else if (options.latest) {
    const latestVer = getLatestAppVersion();
    if (!latestVer) {
      console.error('[ERROR] Could not determine latest app version from package.json/version.ts');
      process.exit(1);
    }
    // Ignore -dev suffix if in dev mode
    const cleanVer = latestVer.replace(/-dev\.\d+$/, '');
    const found = allVersions.find(v => v.version === cleanVer);
    if (!found) {
      console.error(`[ERROR] Latest version ${cleanVer} not found in CHANGELOG.md`);
      process.exit(1);
    }
    targetVersions = [found];
  }

  console.log(`\nProcessing ${targetVersions.length} release(s)...`);

  const tmpDir = path.join(repoRoot, '.tmp-releases');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const item of targetVersions) {
    const tag = item.version;
    const exists = existingReleases.has(tag);
    const targetCommit = matchCommitForVersion(tag, commits) || 'main';

    console.log(`\n-----------------------------------------`);
    console.log(`Version : ${tag}`);
    console.log(`Title   : ${item.title}`);
    console.log(`Commit  : ${targetCommit.slice(0, 7)}`);
    console.log(`Exists  : ${exists ? 'YES' : 'NO'}`);

    if (exists && !options.force) {
      console.log(`[SKIP] Release ${tag} already exists. (Use --force to overwrite notes)`);
      skippedCount++;
      continue;
    }

    // Prepare notes content
    // Include full body notes; if body is empty, provide default note
    const notesContent = item.body || item.title;
    const notesFile = path.join(tmpDir, `release-${tag}.md`);
    fs.writeFileSync(notesFile, notesContent, 'utf8');

    if (options.dryRun) {
      console.log(`[DRY-RUN] Would ${exists ? 'update' : 'create'} release for ${tag}`);
      console.log(`[DRY-RUN] Notes preview:\n${notesContent.slice(0, 200)}...\n`);
      if (exists) updatedCount++; else createdCount++;
      continue;
    }

    try {
      if (exists) {
        console.log(`[UPDATE] Updating release ${tag}...`);
        execSync(`gh release edit "${tag}" --title "${item.title.replace(/"/g, '\\"')}" --notes-file "${notesFile}"`, {
          cwd: repoRoot,
          stdio: 'inherit',
        });
        updatedCount++;
      } else {
        console.log(`[CREATE] Creating release ${tag} pointing to commit ${targetCommit.slice(0, 7)}...`);
        const isLatest = (tag === allVersions[0].version);
        const latestFlag = isLatest ? '--latest' : '--latest=false';
        execSync(`gh release create "${tag}" --target "${targetCommit}" --title "${item.title.replace(/"/g, '\\"')}" --notes-file "${notesFile}" ${latestFlag}`, {
          cwd: repoRoot,
          stdio: 'inherit',
        });
        createdCount++;
      }
      console.log(`[SUCCESS] Release ${tag} synced successfully.`);
    } catch (err) {
      console.error(`[ERROR] Failed to sync release ${tag}:`, err.message);
    }
  }

  // Cleanup tmp dir
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}

  console.log(`\n=== Summary ===`);
  console.log(`Created: ${createdCount}`);
  console.log(`Updated: ${updatedCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Total  : ${targetVersions.length}`);
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
