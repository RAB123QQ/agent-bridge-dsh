import { homedir, tmpdir } from 'node:os'
import { writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
/**
 * pair-panel host half: serves GET /pair-panel/snapshot with the live
 * agentbridge pair state, the codex thread rollout tail, and the DSH
 * session context pressure from the token meter.
 * Pure display layer: reads state files and the token meter, never writes.
 */
const STATE_DIR = '/.local/state/agentbridge/pairs'
const CODEX_SESSIONS = '/.codex/sessions'

const lastSize = new Map()
const lastLines = new Map()
const rolloutCache = new Map()
const windowCache = new Map()
let scanBudget = 2000
let lastDebug = null // diagnostics from the last snapshot run (?debug=1 returns it)

// fs-local stat() returns {version:"dev:ino:size:mtimeNs:ctimeNs",type,size} —
// there is NO mtimeMs; recover the mtime from the version string.
function statMtimeMs(st) {
  if (!st || typeof st.version !== 'string') return 0
  const parts = st.version.split(':')
  const ns = Number(parts[3])
  return Number.isFinite(ns) && ns > 0 ? ns / 1e6 : 0
}

function parseJson(text) {
  try { return JSON.parse(text) } catch { return null }
}

async function safeRead(ctx, p) {
  try {
    const fs = ctx.get('fs')
    if (!fs) return null
    const target = await fs.resolve(p)
    return { target, text: await fs.readText(target) }
  } catch { return null }
}

async function safeStat(ctx, p) {
  try {
    const fs = ctx.get('fs')
    if (!fs) return null
    const target = await fs.resolve(p)
    return await fs.stat(target)
  } catch { return null }
}

async function safeList(ctx, p) {
  try {
    const fs = ctx.get('fs')
    if (!fs) return []
    const target = await fs.resolve(p)
    return await fs.listDir(target)
  } catch { return [] }
}

function homeOf(cwd) {
  if (typeof cwd !== 'string' || !cwd) return undefined
  // Windows form: C:\Users\<user>\... -> C:\Users\<user>
  const w = /^([A-Za-z]:[\\/]Users[\\/][^\\/]+)(?:[\\/].*)?$/i.exec(cwd)
  if (w) return w[1]
  // Unix form: /c/Users/<user>/... -> /c/Users/<user> ; /home/user/... -> /home/user
  if (cwd.startsWith('/')) {
    const parts = cwd.split('/').filter(Boolean)
    if (parts.length < 2) return undefined
    if (parts[0].length === 1 && parts[1].toLowerCase() === 'users') {
      return '/' + parts.slice(0, 3).join('/')
    }
    return '/' + parts[0] + '/' + parts[1]
  }
  // Windows non-standard drive layout fallback: drive + first folder
  const m = /^([A-Za-z]:[\\/][^\\/]+)(?:[\\/].*)?$/.exec(cwd)
  if (m) return m[1]
  return undefined
}

async function deriveHome(ctx, session) {
  // Session creation metadata moved from `session.meta` (DSH 0.1.x) to
  // `session.header` (DSH 0.2.x session format v4). Support both so the
  // plugin keeps working on old and current runtimes.
  const meta = session ? (session.header || session.meta) : undefined
  let home = meta ? homeOf(meta.cwd) : undefined
  if (!home) {
    try {
      const ws = ctx.get('workspaceRegistry')
      const list = ws && typeof ws.list === 'function' ? ws.list() : []
      const w = list.find((x) => x && typeof x.path === 'string')
      home = w ? homeOf(w.path) : undefined
    } catch {}
  }
  if (!home) {
    try { home = homedir() } catch {}
  }
  return home
}

// Claude Code encodes a project directory name from its cwd by replacing
// every non-alphanumeric character with '-'. Older code here only replaced
// path separators, which misses the dot in directories like \.dsh. Resolve
// the real directory by comparing both spellings against the listing.
function claudeProjectCandidates(cwd) {
  const raw = String(cwd || '')
  const variants = [
    raw.replace(/[\/:]/g, '-'),
    raw.replace(/[^A-Za-z0-9]/g, '-'),
  ]
  const out = []
  for (const v of variants) {
    out.push(v)
    if (v) out.push(v.charAt(0).toLowerCase() + v.slice(1))
  }
  return out.filter(Boolean)
}

async function resolveClaudeProjectDir(ctx, home, cwd) {
  const root = home + '/.claude/projects'
  const wanted = claudeProjectCandidates(cwd).map((x) => x.toLowerCase())
  try {
    const entries = await safeList(ctx, root)
    for (const entry of entries) {
      const name = entry && typeof entry.name === 'string' ? entry.name : ''
      if (name && wanted.indexOf(name.toLowerCase()) >= 0) return root + '/' + name
    }
  } catch {}
  return root + '/' + String(cwd || '').replace(/[\/:]/g, '-')
}

async function findPairs(ctx, home) {
  const root = home + STATE_DIR
  const entries = await safeList(ctx, root)
  const pairs = []
  for (const e of entries) {
    const name = e && typeof e.name === 'string' ? e.name : ''
    if (!name) continue
    const dir = root + '/' + name
    const ct = await safeRead(ctx, dir + '/current-thread.json')
    if (!ct) continue
    const meta = parseJson(ct.text)
    if (!meta) continue
    let t = 0
    try { t = new Date(meta.updatedAt || 0).getTime() } catch {}
    const stat = await safeStat(ctx, dir + '/current-thread.json')
    const mtime = statMtimeMs(stat)
    if (mtime > t) t = mtime

    const dm = await safeRead(ctx, dir + '/daemon.json')
    const daemon = dm ? parseJson(dm.text) : null
    const cf = await safeStat(ctx, dir + '/dsh-claude-feed.jsonl')
    // Claude Code stores each session under ~/.claude/projects/<encoded-cwd>/,
    // one JSONL per session; the newest one is this pair's live claude side.
    let claudeSession = null
    if (meta.cwd) {
      const dbg = { pair: meta.pairName || name, t }
      try {
        const projDir = await resolveClaudeProjectDir(ctx, home, meta.cwd)
        dbg.projDir = projDir
        const files = await safeList(ctx, projDir)
        dbg.fileCount = files.length
        dbg.files = files.map((fe) => fe && typeof fe.name === 'string' ? fe.name : String(fe))
        let bestF = null
        let bestMt = 0
        for (const fe of files) {
          const fn = fe && typeof fe.name === 'string' ? fe.name : ''
          if (!fn.endsWith('.jsonl')) continue
          const st = await safeStat(ctx, projDir + '/' + fn)
          const mt = statMtimeMs(st)
          if (mt <= 0) continue
          if (mt > bestMt) { bestMt = mt; bestF = projDir + '/' + fn }
        }
        dbg.bestF = bestF
        dbg.bestMt = bestMt
        // Newest session wins. Only treat it as live when it was modified in
        // the last 24h — an ancient session must not flip a codex-only pair
        // into 'both'.
        if (bestF) claudeSession = bestF // no freshness gate: newest claude session always shows
        dbg.claudeSession = claudeSession
      } catch (e) {
        dbg.error = String((e && e.message) || e)
      }
      lastDebug = dbg
    }
    pairs.push({
      name: meta.pairName || name,
      threadId: meta.threadId || null,
      cwd: meta.cwd || null,
      status: meta.status || null,
      phase: daemon && daemon.phase ? daemon.phase : null,
      turn: daemon ? !!daemon.turnInProgress : null,
      rolloutPath: meta.rolloutPath || null,
      claudeFeed: cf ? dir + '/dsh-claude-feed.jsonl' : null,
      claudeSession,
      updatedAt: meta.updatedAt || null,
      t,
    })
  }
  return pairs.sort((a, b) => b.t - a.t)
}

async function scanRollouts(ctx, dir, threadId, depth) {
  if (depth > 3 || scanBudget <= 0) return []
  const out = []
  const entries = await safeList(ctx, dir)
  for (const e of entries) {
    const name = e && typeof e.name === 'string' ? e.name : ''
    if (!name) continue
    scanBudget -= 1
    const p = dir + '/' + name
    if (name.startsWith('rollout-') && name.endsWith('.jsonl') && name.indexOf(threadId) >= 0) {
      const st = await safeStat(ctx, p)
      out.push({ p, m: statMtimeMs(st) })
    } else {
      out.push(...await scanRollouts(ctx, p, threadId, depth + 1))
    }
  }
  return out
}

async function findRollout(ctx, home, threadId) {
  if (!threadId) return null
  const cached = rolloutCache.get(threadId)
  if (cached) {
    const st = await safeStat(ctx, cached)
    if (st) return cached
    rolloutCache.delete(threadId)
  }
  scanBudget = 2000
  const found = await scanRollouts(ctx, home + CODEX_SESSIONS, threadId, 0)
  found.sort((a, b) => b.m - a.m)
  if (found.length > 0) {
    const p = found[0].p
    rolloutCache.set(threadId, p)
    return p
  }
  return null
}

// ── rollout fallback by cwd ────────────────────────────────────────────────
// agentbridge's current-thread.json can point at the daemon app-server's
// temporary thread while the Codex TUI writes a different thread. When the
// recorded thread has no rollout, match a rollout's session_meta.cwd against
// the pair cwd instead, so the panel still shows the live conversation.
const rolloutByCwdCache = new Map()

function sameCwd(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false
  const norm = (p) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

async function readFirstLine(ctx, p) {
  try {
    const fs = ctx.get('fs')
    if (!fs) return ''
    const target = await fs.resolve(p)
    const iter = await fs.streamText(target)
    let buf = ''
    for await (const chunk of iter) {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl >= 0) return buf.slice(0, nl)
      if (buf.length > 8192) break
    }
    return buf
  } catch {
    return ''
  }
}

async function scanAllRollouts(ctx, dir, depth) {
  if (depth > 3 || scanBudget <= 0) return []
  const out = []
  const entries = await safeList(ctx, dir)
  for (const e of entries) {
    const name = e && typeof e.name === 'string' ? e.name : ''
    if (!name) continue
    scanBudget -= 1
    const p = dir + '/' + name
    if (name.startsWith('rollout-') && name.endsWith('.jsonl')) {
      const st = await safeStat(ctx, p)
      out.push({ p, m: statMtimeMs(st) })
    } else {
      out.push(...await scanAllRollouts(ctx, p, depth + 1))
    }
  }
  return out
}

async function findRolloutByCwd(ctx, home, cwd) {
  if (!cwd) return null
  const cached = rolloutByCwdCache.get(cwd)
  if (cached && Date.now() - cached.at < 30000) {
    const st = await safeStat(ctx, cached.p)
    if (st) return cached.p
    rolloutByCwdCache.delete(cwd)
  }
  scanBudget = 3000
  const all = await scanAllRollouts(ctx, home + CODEX_SESSIONS, 0)
  all.sort((a, b) => b.m - a.m)
  for (const item of all.slice(0, 80)) {
    const line = await readFirstLine(ctx, item.p)
    if (!line) continue
    const rec = parseJson(line)
    const meta = rec && rec.payload && typeof rec.payload === 'object' ? rec.payload : null
    if (meta && sameCwd(meta.cwd, cwd)) {
      rolloutByCwdCache.set(cwd, { p: item.p, at: Date.now() })
      return item.p
    }
  }
  return null
}

// Extract the codex thread id from a rollout filename so the panel can show
// the thread that actually produced the feed.
function threadIdFromRollout(p) {
  const m = /rollout-[^\\/]*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(p || '')
  return m ? m[1] : null
}

async function dirExists(ctx, p) {
  if (typeof p !== 'string' || !p) return false
  try {
    const fs = ctx.get('fs')
    if (!fs) return false
    const target = await fs.resolve(p)
    const st = await fs.stat(target)
    return !!(st && (st.type === 'dir' || st.type === 'directory'))
  } catch {
    return false
  }
}

// Pick a launch directory for a pair whose recorded cwd no longer exists.
async function fallbackLaunchCwd(ctx) {
  try {
    const ws = ctx.get('workspaceRegistry')
    const list = ws && typeof ws.list === 'function' ? ws.list() : []
    for (const item of list) {
      if (item && typeof item.path === 'string' && await dirExists(ctx, item.path)) return item.path
    }
  } catch {}
  try {
    const session = resolveSession(ctx, '')
    const meta = session ? (session.header || session.meta) : undefined
    if (meta && typeof meta.cwd === 'string' && await dirExists(ctx, meta.cwd)) return meta.cwd
  } catch {}
  return null
}

async function tailLines(ctx, p, maxLines) {
  const st = await safeStat(ctx, p)
  const size = st && typeof st.size === 'number' ? st.size : -1
  const prev = lastSize.get(p)
  if (prev === size && lastLines.has(p)) return lastLines.get(p)
  lastSize.set(p, size)
  const lines = []
  try {
    const fs = ctx.get('fs')
    if (!fs) return lines
    const target = await fs.resolve(p)
    const iter = await fs.streamText(target)
    let carry = ''
    for await (const chunk of iter) {
      const text = carry + chunk
      const parts = text.split('\n')
      carry = parts.pop() || ''
      for (const part of parts) {
        if (part.trim()) lines.push(part)
      }
      if (lines.length > maxLines * 2) lines.splice(0, lines.length - maxLines)
    }
    if (carry.trim()) lines.push(carry)
    if (lines.length > maxLines) lines.splice(0, lines.length - maxLines)
  } catch {}
  lastLines.set(p, lines)
  return lines
}

function parseRecord(line) {
  const obj = parseJson(line)
  if (!obj) return null
  const ts = typeof obj.timestamp === 'string' ? obj.timestamp : null
  const t = obj.type
  const p = obj.payload && typeof obj.payload === 'object' ? obj.payload : {}
  if (t === 'response_item' && p.type === 'message') {
    let text = ''
    if (Array.isArray(p.content)) {
      for (const c of p.content) {
        if (c && typeof c.text === 'string') text += c.text
      }
    }
    return { ts, kind: 'message', role: p.role === 'user' ? 'user' : p.role === 'assistant' ? 'assistant' : 'other', text }
  }
  if (t === 'event_msg') {
    if (p.type === 'agent_message') {
      return { ts, kind: 'message', role: 'assistant', text: String(p.message || '') }
    }
    if (p.type === 'user_message') {
      return { ts, kind: 'message', role: 'user', text: String(p.message || '') }
    }
    if (p.type === 'token_count') {
      const info = p.info || {}
      // total_token_usage accumulates across every API call of the process;
      // last_token_usage is the current request's context usage.
      const usage = info.last_token_usage || info.total_token_usage || {}
      return {
        ts, kind: 'tokens',
        tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : null,
        window: typeof info.model_context_window === 'number' ? info.model_context_window : null,
      }
    }
    if (p.type === 'function_call') {
      return { ts, kind: 'tool', name: String(p.name || ''), text: String(p.arguments || '') }
    }
    if (p.type === 'function_call_output') {
      return { ts, kind: 'tool-out', text: String(p.output || '') }
    }
    if (p.type === 'task_complete') {
      return { ts, kind: 'task', text: String(p.last_agent_message || '') }
    }
  }
  return null
}

function dshContext(ctx, session) {
  try {
    if (!session) return null
    const meter = ctx.get('tokenMeter')
    if (!meter) return null
    const m = meter.measure(session)
    return {
      pressure: typeof m.totalTokens === 'number' ? m.totalTokens : null,
      surface: typeof m.surfaceTokens === 'number' ? m.surfaceTokens : null,
    }
  } catch { return null }
}

async function contextWindow(ctx) {
  try {
    const adm = ctx.get('agentDefaultModel')
    if (!adm) return null
    const sel = adm.currentSelection()
    if (!sel || !sel.provider || !sel.model) return null
    const key = sel.provider + '/' + sel.model
    const cached = windowCache.get(key)
    if (cached && Date.now() - cached.at < 300000) return cached.window
    const llm = ctx.get('llm')
    if (!llm) return null
    const info = await llm.resolveModelInfo(sel.provider, sel.model)
    const window = info && info.context && typeof info.context.contextWindow === 'number' ? info.context.contextWindow : null
    windowCache.set(key, { window, at: Date.now() })
    return window
  } catch { return null }
}

function resolveSession(ctx, sessionId) {
  try {
    if (sessionId) {
      const sessions = ctx.get('sessions')
      if (sessions && typeof sessions.get === 'function') {
        const s = sessions.get(String(sessionId))
        if (s) return s
      }
    }
    const agents = ctx.get('agents')
    if (agents && typeof agents.currentInitiator === 'function') {
      const agent = agents.currentInitiator()
      if (agent && agent.session) return agent.session
    }
    return undefined
  } catch { return undefined }
}

async function snapshot(ctx, sessionId, selectedName) {
  const session = resolveSession(ctx, sessionId)
  const home = await deriveHome(ctx, session)
  if (!home) return { ok: false, error: 'cannot derive home from session or workspace' }
  const allPairs = await findPairs(ctx, home)
  if (!allPairs.length) return { ok: false, error: 'no agentbridge pair state found under ' + home + STATE_DIR }
  const pair = (selectedName ? allPairs.find((p) => p.name === selectedName) : null) || allPairs[0]
  let rollout = pair.rolloutPath
  if (!rollout) rollout = await findRollout(ctx, home, pair.threadId)
  if (!rollout && pair.cwd) rollout = await findRolloutByCwd(ctx, home, pair.cwd)
  // The recorded thread id can disagree with the TUI-written rollout; report
  // the thread that actually owns the feed we show.
  const threadId = (rollout && threadIdFromRollout(rollout)) || pair.threadId
  const feed = []
  let codexTokens = null
  let codexWindow = null
  if (rollout) {
    const lines = await tailLines(ctx, rollout, 4000)
    // Codex rollouts record each message twice: once as response_item and
    // once as event_msg (user_message / agent_message), and task_complete
    // repeats last_agent_message a third time. Dedupe by (kind, text) within
    // a small lookback window so the feed shows each message once.
    const seen = []
    for (const line of lines) {
      const r = parseRecord(line)
      if (!r) continue
      if (r.kind === 'tokens') {
        if (r.tokens !== null) codexTokens = r.tokens
        if (r.window !== null) codexWindow = r.window
        continue
      }
      const text = r.text || null
      let dup = false
      for (let i = Math.max(0, seen.length - 4); i < seen.length; i++) {
        if (seen[i].kind === r.kind && seen[i].text === text) { dup = true; break }
      }
      if (!dup && r.kind === 'task' && seen.length) {
        const last = seen[seen.length - 1]
        if (last.kind === 'message' && last.text === text) dup = true
      }
      if (dup) continue
      seen.push({ ts: r.ts, kind: r.kind, role: r.role || null, name: r.name || null, text })
      feed.push(seen[seen.length - 1])
    }
  }
  let claude = null
  const claudeRecords = []
  if (pair.claudeFeed) {
    const lines = await tailLines(ctx, pair.claudeFeed, 4000)
    for (const line of lines) {
      const r = parseJson(line)
      if (!r || typeof r.text !== 'string') continue
      claudeRecords.push({ ts: r.ts, kind: 'message', role: r.role === 'assistant' ? 'assistant' : 'user', text: r.text })
    }
  }
  let claudeTokens = null
  if (pair.claudeSession) {
    const lines = await tailLines(ctx, pair.claudeSession, 4000)
    for (const line of lines) {
      const r = parseJson(line)
      if (!r || (r.type !== 'user' && r.type !== 'assistant')) continue
      const msg = r.message || {}
      // Context pressure: the latest assistant turn's context usage = the
      // non-cache input + cached read + newly cached tokens for that turn.
      if (r.type === 'assistant' && msg.usage) {
        const u = msg.usage
        const c = (Number(u.input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0)
        if (c > 0) claudeTokens = c
      }
      let text = null
      const content = msg.content
      if (typeof content === 'string') text = content
      else if (Array.isArray(content)) {
        let t = ''
        for (const b of content) if (b && b.type === 'text' && typeof b.text === 'string') t += (t ? '\n' : '') + b.text
        text = t || null
      }
      if (!text) continue
      claudeRecords.push({ ts: r.timestamp || null, kind: 'message', role: r.type === 'assistant' ? 'assistant' : 'user', text })
    }
  }
  if (claudeRecords.length) {
    claudeRecords.sort((a, b) => {
      const at = new Date(a.ts).getTime()
      const bt = new Date(b.ts).getTime()
      return (Number.isNaN(at) ? 0 : at) - (Number.isNaN(bt) ? 0 : bt)
    })
    const seen = []
    const cf = []
    for (const rec of claudeRecords) {
      const key = rec.kind + '\u0000' + rec.role + '\u0000' + rec.text
      let dup = false
      for (let i = Math.max(0, seen.length - 4); i < seen.length; i++) {
        if (seen[i] === key) { dup = true; break }
      }
      if (dup) continue
      seen.push(key)
      cf.push(rec)
    }
    claude = { feed: cf.slice(-2000), tokens: claudeTokens, window: null }
  }
  const hasClaude = !!(pair.claudeFeed || pair.claudeSession)
  const peer = hasClaude && rollout ? 'both' : hasClaude ? 'claude' : rollout ? 'codex' : 'none'
  const dsh = dshContext(ctx, session)
  // The DSH model's context window does not depend on a live session, so it
  // can be resolved even when the HTTP handler has no session boundary (which
  // is always the case for a webServer route). This keeps both peer gauges
  // rendering a percentage on current DSH.
  const window = await contextWindow(ctx)
  // Peer context windows are often unknown (codex token_count may carry no
  // model window, the claude side carries none at all). Fall back to the DSH
  // model's window so both gauges can still render a percent + progress bar.
  if (claudeTokens !== null && claude && claude.window === null) claude.window = window
  if (codexTokens !== null && codexWindow === null) codexWindow = window
  return {
    ok: true,
    at: Date.now(),
    peer,
    pairs: allPairs.map((p) => ({
      name: p.name,
      peer: p.claudeFeed || p.claudeSession ? (p.rolloutPath ? 'both' : 'claude') : p.rolloutPath ? 'codex' : 'none',
      updatedAt: p.updatedAt,
    })),
    pair: {
      name: pair.name,
      threadId,
      phase: pair.phase,
      turn: pair.turn,
      status: pair.status,
      updatedAt: pair.updatedAt,
    },
    codex: { tokens: codexTokens, window: codexWindow },
    claude,
    dsh: dsh ? { pressure: dsh.pressure, surface: dsh.surface, window } : null,
    feed: feed.slice(-2000),
  }
}

/** Service required before the snapshot route can be registered. */
export const inject = ["webServer"]

/** The agentbridge MCP adapter is only alive when the harness was launched
 * via `abg dsh`; a plain `dsh web` boot leaves this port dead. */
const ABG_MCP_URL = 'http://127.0.0.1:8765/mcp'

async function abgActive() {
  try {
    const r = await fetch(ABG_MCP_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      signal: AbortSignal.timeout(800),
    })
    return true
  } catch {
    return false
  }
}

// Push wake-up: agentbridge posts here when codex sends a message while no
// send_message call is waiting. We locate the live root agent of this DSH
// session and followup() its inbox so the agent is actually woken up by the
// codex reply (real push), not by get_messages polling.
const notifyDedup = new Map()
async function pushNotify(ctx, payload) {
  const id = typeof payload?.id === 'string' ? payload.id : ''
  if (id) {
    const last = notifyDedup.get(id)
    if (last && Date.now() - last < 15000) return
    notifyDedup.set(id, Date.now())
  }
  const content = typeof payload?.content === 'string' && payload.content.trim() ? payload.content.trim() : ''
  if (!content) return
  const agents = ctx.get('agents')
  if (!agents) return
  // Prefer the session/agent named by the poster (the adapter can know which
  // DSH session started it); otherwise fall back to the first live root agent.
  let agent
  try {
    const wanted = payload?.agentId || payload?.sessionId
    if (wanted && typeof agents.get === 'function') agent = agents.get(String(wanted))
    if (!agent && wanted && typeof agents.list === 'function') {
      agent = agents.list().find((candidate) => candidate && candidate.session && String(candidate.session.id) === String(wanted))
    }
  } catch {}
  if (!agent) {
    const roots = typeof agents.roots === 'function' ? agents.roots() : []
    agent = roots[0]
  }
  if (!agent || typeof agent.followup !== 'function') return
  try {
    // Must go through createUserMessage: DSH messages need a `source.kind`
    // tag; a bare {role,content} object crashes the loop with
    // "Cannot read properties of undefined (reading 'kind')".
    const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
    const message = createUserMessage({
      content: [{ type: 'text', text: `【Codex 对端消息】（agentbridge 推送，id=${id || '-'}）：\n${content.slice(0, 2000)}` }],
      // Session format v4 (DSH 0.2.x) retired the old `{kind:'plugin', plugin}`
      // wrapper: its encoder throws "format v4 message requires a
      // producer-owned source kind" and stalls the session log. The v4
      // convention for third-party plugin sources is `plugin:<plugin-name>`,
      // which is preserved as-is by native admission.
      source: { kind: 'plugin:ui-pair-panel' },
    })
    agent.followup(message)
  } catch (e) {
    // agent may be mid-turn; followup queues, that is fine
  }
}

// Launch a peer terminal: opens a new Windows Terminal tab (or a fallback
// `cmd /k` console window) cd'd into the pair's cwd, running the abg CLI for
// the requested side. Detached + stdio:'ignore' so the child console is
// fully independent of this server process.
let wtPathCache
function findWtExe() {
  if (wtPathCache !== undefined) return wtPathCache
  try {
    const r = spawnSync('where', ['wt.exe'], { encoding: 'utf8' })
    const out = r && !r.error && r.status === 0 ? String(r.stdout || '').split(/\r?\n/).find((l) => l.trim()) : null
    wtPathCache = out ? out.trim() : null
  } catch {
    wtPathCache = null
  }
  return wtPathCache
}

// cmd.exe has no reliable way to escape an embedded double quote inside a
// quoted argument, so reject names/paths carrying one rather than risk
// breaking out of the quoting and injecting extra commands.
function hasUnsafeChars(s) {
  return /["\r\n]/.test(String(s))
}

// Find the native codex.exe bin dir so the generated .cmd's PATH lets the
// agent-bridge daemon spawn 'codex' directly (node/bun spawn cannot run
// npm's .cmd shims). Order env override -> APPDATA npm package tree scan.
function findCodexNativeBin() {
  if (process.env.ABG_CODEX_NATIVE_BIN && existsSync(process.env.ABG_CODEX_NATIVE_BIN)) {
    return process.env.ABG_CODEX_NATIVE_BIN
  }
  try {
    const npmRoot = process.env.APPDATA ? join(process.env.APPDATA, 'npm') : null
    if (!npmRoot) return ''
    const codexPkg = join(npmRoot, 'node_modules', '@openai', 'codex', 'node_modules')
    if (!existsSync(codexPkg)) return ''
    const scan = (dir) => {
      for (const entry of readdirSync(dir)) {
        if (!/^codex-win32-/.test(entry)) continue
        const vendor = join(dir, entry, 'vendor')
        if (!existsSync(vendor)) continue
        for (const v of readdirSync(vendor)) {
          const bin = join(vendor, v, 'bin')
          if (existsSync(join(bin, 'codex.exe'))) return bin
        }
      }
      return ''
    }
    // The win32 build lives under a nested scope: .../codex/node_modules/@openai/codex-win32-*
    for (const entry of readdirSync(codexPkg)) {
      const found = scan(join(codexPkg, entry))
      if (found) return found
    }
  } catch {}
  return ''
}
// Build the PATH prefix for the launch .cmd from the machine's own env:
// ~/.bun/bin (shims), the native codex bin (so the daemon can spawn
// 'codex' as a real .exe), and the npm global dir. Only existing dirs are
// included, so the script stays portable.
function launchPathLine() {
  const parts = []
  const home = process.env.USERPROFILE || process.env.HOME || ''
  const npmRoot = process.env.APPDATA ? join(process.env.APPDATA, 'npm') : ''
  const codexBin = findCodexNativeBin()
  if (codexBin) parts.push(codexBin)
  if (home) parts.push(join(home, '.bun', 'bin'))
  if (npmRoot) parts.push(npmRoot)
  return parts.filter((p) => p && existsSync(p)).join(';')
}

function launchPeerTerminal(side, pair, fresh, cwd) {
  const launchCwd = typeof cwd === 'string' && cwd ? cwd : pair.cwd
  // pair names are validated by hasUnsafeChars (no quotes/newlines), so they
  // are safe to interpolate unquoted.
  const cmdText = side === 'claude'
    ? `abg claude --safe --pair ${pair.name}`
    : `abg codex --pair ${pair.name}${fresh ? ' --new' : ''}`
  if (findWtExe()) {
    const child = spawn('wt.exe', ['new-tab', '-d', launchCwd, 'powershell.exe', '-NoExit', '-Command', cmdText], { detached: true, stdio: 'ignore' })
    child.unref()
    return
  }
  // Fallback: write a tiny .cmd and hand it to `start`. The hidden dsh host
  // cannot hand a visible console to a plain spawn (stdio:'ignore' child
  // gets no window), but `cmd /c start "" file.cmd` allocates a brand-new
  // console window that stays open for the user.
  const scriptFile = join(tmpdir(), `pair-panel-launch-${side}-${Date.now()}.cmd`)
  try {
    const pathLine = launchPathLine()
    writeFileSync(scriptFile, `@echo off\r\nset PATH=${pathLine}${pathLine ? ';' : ''}%PATH%\r\ncd /d "${launchCwd}"\r\n${cmdText}\r\n`, 'utf8')
    const child = spawn('cmd.exe', ['/c', 'start', '', scriptFile], { detached: true, stdio: 'ignore' })
    child.unref()
  } catch (e) {
    // Last resort: bare powershell (may not show a window, but still runs).
    const child = spawn('powershell.exe', ['-NoExit', '-Command', cmdText], { detached: true, stdio: 'ignore', cwd: launchCwd })
    child.unref()
  }
}

export function apply(ctx) {
  const webServer = ctx.get('webServer')
  if (!webServer) return
  // Registrations are fiber-scoped: when DSH reloads the profile (HMR),
  // disables/re-enables the plugin, or replaces the webServer service, the
  // disposers remove the routes before apply() runs again. Registering
  // directly would throw `duplicate exact route` on the second apply.
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/agentbridge/notify',
    handler: async (req, res) => {
      let payload = null
      try {
        let body = ''
        for await (const chunk of req) body += chunk
        payload = body ? JSON.parse(body) : null
      } catch {}
      if (payload) await pushNotify(ctx, payload)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    },
  }), 'pair-panel: /agentbridge/notify route')
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/pair-panel/snapshot',
    handler: async (req, res) => {
      const url = req.url || ''
      const q = url.indexOf('?') >= 0 ? url.slice(url.indexOf('?') + 1) : ''
      let sessionId = ''
      let pairName = ''
      let debugFlag = false
      for (const part of q.split('&')) {
        if (part.startsWith('session=')) {
          try { sessionId = decodeURIComponent(part.slice(8)) } catch { sessionId = '' }
        }
        if (part.startsWith('pair=')) {
          try { pairName = decodeURIComponent(part.slice(5)) } catch { pairName = '' }
        }
        if (part === 'debug=1') debugFlag = true
      }
      let data
      try {
        const mode = await abgActive()
        data = await snapshot(ctx, sessionId, pairName)
        data.mode = mode ? 'abg' : 'plain'
        if (!mode) data.adapterDown = true
      } catch (e) {
        data = { ok: false, error: String((e && e.message) || e) }
      }
      if (debugFlag) data._debug = lastDebug
      const body = JSON.stringify(data)
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(body)
    },
  }), 'pair-panel: /pair-panel/snapshot route')
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/pair-panel/launch',
    handler: async (req, res) => {
      let data
      try {
        if (req.method !== 'POST') {
          data = { ok: false, error: 'method not allowed' }
        } else {
          let body = ''
          for await (const chunk of req) body += chunk
          const payload = body ? parseJson(body) : null
          const side = payload && payload.side === 'claude' ? 'claude' : 'codex'
          const pairName = payload && typeof payload.pair === 'string' ? payload.pair : ''
          const fresh = !!(payload && payload['new'] === true)
          if (!pairName || hasUnsafeChars(pairName)) {
            data = { ok: false, error: 'pair not found' }
          } else {
            const home = await deriveHome(ctx, resolveSession(ctx, ''))
            const pairs = home ? await findPairs(ctx, home) : []
            const pair = pairs.find((p) => p.name === pairName)
            if (!pair || !pair.cwd || hasUnsafeChars(pair.cwd)) {
              data = { ok: false, error: 'pair not found' }
            } else {
              // The pair may have been created in a directory that no longer
              // exists (common after moving the project). Launching there makes
              // `cd` fail silently and starts the peer in the wrong folder, so
              // fall back to a live workspace/session directory.
              let cwd = pair.cwd
              if (!await dirExists(ctx, cwd)) {
                const fallback = await fallbackLaunchCwd(ctx)
                if (!fallback) {
                  data = { ok: false, error: 'pair cwd not found: ' + pair.cwd }
                } else {
                  cwd = fallback
                }
              }
              if (!data) {
                launchPeerTerminal(side, pair, fresh, cwd)
                data = { ok: true, cwd }
              }
            }
          }
        }
      } catch (e) {
        data = { ok: false, error: String((e && e.message) || e) }
      }
      const bodyOut = JSON.stringify(data)
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(bodyOut)
    },
  }), 'pair-panel: /pair-panel/launch route')
}
