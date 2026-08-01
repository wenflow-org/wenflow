import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const mode = process.argv.includes('--history') ? 'history' : 'current'
const baseline = JSON.parse(readFileSync(join(root, '.secret-scan-baseline.json'), 'utf8'))
const allowedHistoryFingerprints = new Set(baseline.allowedHistoryFingerprints || [])

const excludedDirectories = new Set([
  '.git', 'node_modules', 'dist', 'coverage', 'playwright-report', 'test-results',
  'backend/src/generated', 'frontend/dist'
])
const excludedExtensions = new Set([
  '.db', '.sqlite', '.sqlite3', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.woff',
  '.woff2', '.ttf', '.ico', '.pdf', '.zip', '.gz', '.tgz'
])

const rules = [
  { id: 'openai-compatible-key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'github-token', pattern: /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g },
  { id: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { id: 'private-key', pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g },
  { id: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g }
]

function fingerprint(secret) {
  return createHash('sha256').update(secret).digest('hex')
}

function isPlaceholder(secret) {
  const normalized = secret.toLowerCase()
  return /(?:your|example|replace|redacted|placeholder|dummy|sample|fake|test|ci-only)/.test(normalized)
    || /^sk-\d+$/.test(normalized)
}

function findingsInText(text, location, allowHistoricalBaseline) {
  const findings = []
  for (const rule of rules) {
    for (const match of text.matchAll(rule.pattern)) {
      const secret = match[0]
      if (isPlaceholder(secret)) continue
      const hash = fingerprint(secret)
      if (allowHistoricalBaseline && allowedHistoryFingerprints.has(hash)) continue
      const line = text.slice(0, match.index).split('\n').length
      findings.push({ rule: rule.id, location, line, fingerprint: hash.slice(0, 12) })
    }
  }
  return findings
}

function shouldSkip(path) {
  const normalized = path.replace(/\\/g, '/')
  for (const directory of excludedDirectories) {
    if (normalized === directory || normalized.startsWith(`${directory}/`)) return true
  }
  const lower = normalized.toLowerCase()
  if ([...excludedExtensions].some(extension => lower.endsWith(extension))) return true
  if (/\.(?:db|sqlite|sqlite3)\.(?:bak|backup|old|new|copy|\d|-|_)/i.test(lower)) return true
  return false
}

function scanCurrent() {
  const findings = []
  const files = execFileSync('git', [
    'ls-files', '--cached', '--others', '--exclude-standard', '-z'
  ], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  for (const path of files) {
    if (shouldSkip(path)) continue
    const absolute = join(root, path)
    if (!existsSync(absolute)) continue
    if (statSync(absolute).size > 5 * 1024 * 1024) continue
    const buffer = readFileSync(absolute)
    if (buffer.includes(0)) continue
    findings.push(...findingsInText(buffer.toString('utf8'), path, false))
  }
  return findings
}

function scanHistory() {
  const history = execFileSync('git', [
    'log', '--all', '--full-history', '--no-ext-diff', '--format=commit:%H', '-p', '--binary'
  ], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

  const findings = []
  let commit = 'unknown'
  let path = 'unknown'
  for (const line of history.split('\n')) {
    if (line.startsWith('commit:')) {
      commit = line.slice('commit:'.length, 'commit:'.length + 12)
      continue
    }
    if (line.startsWith('+++ b/')) {
      path = line.slice(6)
      continue
    }
    if (line.startsWith('--- a/') && path === 'unknown') {
      path = line.slice(6)
      continue
    }
    if ((!line.startsWith('+') && !line.startsWith('-')) || line.startsWith('+++') || line.startsWith('---')) continue
    findings.push(...findingsInText(line.slice(1), `${commit}:${path}`, true))
  }
  return findings
}

const findings = mode === 'history' ? scanHistory() : scanCurrent()
if (findings.length > 0) {
  console.error(`[secret-scan] ${mode} scan found ${findings.length} potential secret(s)`)
  for (const finding of findings) {
    console.error(`${finding.rule} ${finding.location}:${finding.line} sha256:${finding.fingerprint}`)
  }
  process.exitCode = 1
} else {
  console.log(JSON.stringify({ success: true, mode, findings: 0 }))
}
