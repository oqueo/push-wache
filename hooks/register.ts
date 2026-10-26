import type { EngineInterface, Register } from 'claude-code'

type Engine = EngineInterface

export type Config = {
  hosts: string[]
  protectedBranches: string[]
  hooks: boolean
  force: boolean
  rm: boolean
  secrets: boolean
}

// ---------------------------------------------------------------------------
// Befehlszeile in Segmente und Wörter zerlegen (Anführungszeichen, ; && || | &)
// ---------------------------------------------------------------------------

export function tokenize(cmd: string): string[][] {
  const segments: string[][] = []
  let words: string[] = []
  let cur = ''
  let has = false
  let quote: '"' | "'" | '' = ''
  const push = () => {
    if (has) words.push(cur)
    cur = ''
    has = false
  }
  const end = () => {
    push()
    if (words.length) segments.push(words)
    words = []
  }
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd.charAt(i)
    if (quote) {
      if (c === quote) quote = ''
      else if (c === '\\' && quote === '"' && i + 1 < cmd.length) cur += cmd.charAt(++i)
      else cur += c
      has = true
    } else if (c === '"' || c === "'") {
      quote = c
      has = true
    } else if (c === '\\' && i + 1 < cmd.length) {
      cur += cmd.charAt(++i)
      has = true
    } else if (c === ' ' || c === '\t') {
      push()
    } else if (c === '\n' || c === ';' || c === '|' || c === '&') {
      end()
    } else {
      cur += c
      has = true
    }
  }
  end()
  return segments
}

const WRAPPERS = new Set(['sudo', 'env', 'command', 'time', 'nohup', 'exec', 'nice', 'xargs'])

// Wörter am Anfang abziehen, die den eigentlichen Befehl nur umhüllen (FOO=1, sudo, ...)
function stripLead(words: string[]): string[] {
  let i = 0
  while (i < words.length) {
    const w = words[i] ?? ''
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || WRAPPERS.has(w)) i++
    else break
  }
  return words.slice(i)
}

// bash -c "..." und Verwandte: den Text darin mitprüfen
function expand(segments: string[][], depth = 0): string[][] {
  const out: string[][] = []
  for (const raw of segments) {
    const words = stripLead(raw)
    if (!words.length) continue
    out.push(words)
    const shell = (words[0] ?? '').split('/').pop() ?? ''
    if (depth < 3 && ['bash', 'sh', 'zsh', 'dash'].includes(shell)) {
      const c = words.indexOf('-c')
      const inner = c >= 0 ? words[c + 1] : undefined
      if (inner) out.push(...expand(tokenize(inner), depth + 1))
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Muster
// ---------------------------------------------------------------------------

const SECRETS: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic-Schlüssel'],
  [/\bsk-[A-Za-z0-9]{32,}\b/, 'API-Schlüssel (sk-)'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS-Zugangsschlüssel'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'GitHub-Token'],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}\b/, 'GitHub-Token'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, 'Slack-Token'],
  [/-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/, 'privater Schlüssel'],
  [/\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, 'JWT-Token'],
]

const BROAD_RM = [
  /^\/\*?$/, /^~\/?\*?$/, /^\$\{?HOME\}?\/?\*?$/, /^\.{1,2}\/?\*?$/, /^\*$/,
  /^\/(Users|home|Volumes|System|Library|usr|bin|sbin|etc|var|opt|private)(\/[^/]+)?\/?$/,
]

function hostOf(url: string): string | null {
  const u = url.trim()
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^:/]+)/.exec(u)
  if (scheme) return (scheme[1] ?? '').toLowerCase()
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):/.exec(u)
  if (scp) return (scp[1] ?? '').toLowerCase()
  return null
}

function allowed(host: string, hosts: string[]): boolean {
  return hosts.some(h => h === host || (h.startsWith('*.') && host.endsWith(h.slice(1))))
}

function looksLikeUrl(s: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(s) || /^[^@/\s]+@[^:/\s]+:/.test(s)
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

type GitCall = { sub: string; args: string[]; dir: string | undefined; hooksPath: boolean }

// Zerlegt "git [-C dir] [-c k=v] <sub> args"
function parseGit(words: string[]): GitCall | null {
  if ((words[0] ?? '').split('/').pop() !== 'git') return null
  let i = 1
  let dir: string | undefined
  let hooksPath = false
  while (i < words.length) {
    const w = words[i] ?? ''
    if (w === '-C') {
      dir = words[i + 1]
      i += 2
    } else if (w === '-c') {
      if (/^core\.hooksPath=/i.test(words[i + 1] ?? '')) hooksPath = true
      i += 2
    } else if (w.startsWith('--git-dir') || w.startsWith('--work-tree')) {
      i += w.includes('=') ? 1 : 2
    } else if (w.startsWith('-')) {
      i++
    } else break
  }
  const sub = words[i]
  if (!sub) return null
  return { sub, args: words.slice(i + 1), dir, hooksPath }
}

// Ziel eines Push: die Zielbranches (Refspecs) und der Remote
function pushParts(args: string[]) {
  const flags = args.filter(a => a.startsWith('-'))
  const pos = args.filter(a => !a.startsWith('-'))
  return { flags, remote: pos[0], refs: pos.slice(1) }
}

async function run($: Engine, argv: string[], cwd: string | undefined): Promise<string> {
  try {
    const r = await $.process.run(argv, cwd ? { cwd, timeoutMs: 5000 } : { timeoutMs: 5000 })
    return r.exitCode === 0 ? r.stdout.trim() : ''
  } catch {
    return ''
  }
}

async function judgeGit($: Engine, cfg: Config, g: GitCall, cwd: string | undefined): Promise<string | null> {
  const isCommit = g.sub === 'commit'
  const isPush = g.sub === 'push'

  if (cfg.hooks && (isCommit || isPush || g.sub === 'merge' || g.sub === 'am')) {
    if (g.hooksPath) return 'git mit -c core.hooksPath ausgehebelt die Hooks des Repositories.'
    if (g.args.includes('--no-verify') || (isCommit && g.args.includes('-n'))) {
      return `git ${g.sub} --no-verify umgeht die Hooks des Repositories. Den Hook beheben statt umgehen.`
    }
  }
  if (!isPush) return null

  const { flags, remote, refs } = pushParts(g.args)
  const dryRun = flags.includes('--dry-run') || flags.includes('-n')

  // Ziel prüfen
  if (cfg.hosts.length && !dryRun) {
    let name = remote
    let url: string | undefined = remote && looksLikeUrl(remote) ? remote : undefined
    if (!url) {
      if (!name) {
        const up = await run($, ['git', 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{push}'], cwd)
        name = up.includes('/') ? up.split('/')[0] : 'origin'
      }
      url = await run($, ['git', 'remote', 'get-url', '--push', name ?? 'origin'], cwd)
    }
    const host = url ? hostOf(url) : null
    if (host && !allowed(host, cfg.hosts)) {
      return `git push an "${host}" ist hier nicht erlaubt. Erlaubt: ${cfg.hosts.join(', ')}.`
    }
  }

  // Force und Löschen
  if (cfg.force) {
    const plain = flags.includes('--force') || flags.includes('-f') || flags.some(f => /^-[a-zA-Z]*f[a-zA-Z]*$/.test(f))
    const lease = flags.some(f => f.startsWith('--force-with-lease') || f === '--force-if-includes')
    const plus = refs.some(r => r.startsWith('+'))
    const del = flags.includes('--delete') || flags.includes('-d') || refs.some(r => r.startsWith(':'))
    if (plain) return 'git push --force überschreibt fremden Stand. Besser --force-with-lease, und nie auf geschützte Branches.'
    if (lease || plus || del) {
      let targets = refs.map(r => r.replace(/^\+/, '').split(':').pop() ?? '').filter(Boolean)
      if (!targets.length) targets = [await run($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd)]
      const hit = targets
        .map(t => t.replace(/^refs\/heads\//, ''))
        .find(t => cfg.protectedBranches.includes(t))
      if (hit) return `Force-Push oder Löschen auf den geschützten Branch "${hit}" ist gesperrt.`
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// rm
// ---------------------------------------------------------------------------

function judgeRm(words: string[]): string | null {
  if ((words[0] ?? '').split('/').pop() !== 'rm') return null
  const flags = words.slice(1).filter(w => w.startsWith('-'))
  const recursive = flags.some(f => f === '--recursive' || /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(f))
  if (!recursive) return null
  const targets = words.slice(1).filter(w => !w.startsWith('-'))
  const bad = targets.find(t => BROAD_RM.some(re => re.test(t)))
  return bad ? `rm -r auf "${bad}" ist zu breit und hier gesperrt. Den genauen Pfad nennen.` : null
}

function judgeSecrets(cmd: string): string | null {
  for (const [re, label] of SECRETS) {
    if (re.test(cmd)) return `In der Befehlszeile steht ein ${label}. Zugangsdaten gehören in Umgebungsvariablen, Passwortmanager oder eine geschützte Datei, nicht in den Befehl.`
  }
  return null
}

// ---------------------------------------------------------------------------

export async function judge($: Engine, cfg: Config, command: string): Promise<string | null> {
  if (cfg.secrets) {
    const s = judgeSecrets(command)
    if (s) return s
  }
  let cwd: string | undefined
  for (const words of expand(tokenize(command))) {
    if (words[0] === 'cd' && words[1]) {
      cwd = words[1]
      continue
    }
    if (cfg.rm) {
      const r = judgeRm(words)
      if (r) return r
    }
    const g = parseGit(words)
    if (g) {
      const why = await judgeGit($, cfg, g, g.dir ?? cwd)
      if (why) return why
    }
  }
  return null
}

const list = (v: unknown) =>
  String(v ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)

export const register: Register = (on, options) => {
  const cfg: Config = {
    hosts: list(options.erlaubte_hosts),
    protectedBranches: list(options.geschuetzte_branches).length ? list(options.geschuetzte_branches) : ['main', 'master'],
    hooks: options.hooks_nicht_umgehen !== false,
    force: options.force_sperren !== false,
    rm: options.rm_sperren !== false,
    secrets: options.geheimnisse_sperren !== false,
  }

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const why = await judge($, cfg, e.command)
    return why ? { deny: `push-wache: ${why}` } : next(e)
  }).catch(($, e, next) =>
    next.called
      ? next(e)
      : /\b(git|rm)\b/.test(e.command)
        ? { deny: 'push-wache: die Prüfung ist fehlgeschlagen, der Befehl wurde vorsichtshalber nicht ausgeführt.' }
        : next(e),
  )
}
