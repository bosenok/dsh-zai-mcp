#!/usr/bin/env node
/**
 * Reproducible setup for the Z.AI MCP servers in DeepSeek Harness.
 *
 *   node bin/install.mjs                  # install the Z.AI agent preset
 *   node bin/install.mjs --force          # replace an existing preset block
 *   node bin/install.mjs --global         # mount the rows at profile level instead
 *   node bin/install.mjs --dry-run        # print the block, write nothing
 *   node bin/install.mjs --check          # verify the current state, write nothing
 *   node bin/install.mjs --key <token>    # provision ZAI_API_KEY from an argument
 *   node bin/install.mjs --no-key         # skip key provisioning (already handled)
 *
 * What it does (default, preset mode):
 *   1. reads templates/standard-<ver>.plugins.yml — the standard agent preset's
 *      plugin list, copied verbatim from the installed DSH (or from --standard);
 *   2. appends templates/zai-mcp-rows.yml — the four @deepseek-ai/dsh-mcp-client
 *      rows (zread, web reader, web search, stdio vision);
 *   3. writes one `preset-zai` declaration into the profile's cordis.patch.yml
 *      between managed markers, so a run is idempotent and reversible.
 *
 * The preset mode keeps the servers out of every session that is not created
 * with the `Z.AI (GLM)` preset (sessions store their preset id in the header).
 * The --global mode mounts them for the whole profile instead.
 *
 * Zero dependencies: plain node builtins, no YAML library. The optional
 * verification step shells out to the installed `dsh` CLI (`--dump-config` on a
 * throwaway copy of the profile, because the CLI refuses the reserved `desktop`
 * profile name by design).
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}
const flag = (name) => args.includes(`--${name}`)

const dshHome = resolve(opt('dsh-home', process.env.DSH_HOME ?? join(homedir(), '.dsh')))
const profile = opt('profile', process.env.DSH_PROFILE ?? 'desktop')
const patchPath = join(dshHome, 'profiles', profile, 'cordis.patch.yml')
const globalMode = flag('global')
const dryRun = flag('dry-run')
const check = flag('check')
const force = flag('force')
const pruneGlobal = flag('prune-global') || (!globalMode && flag('force'))
const presetId = opt('preset-id', 'zai')
const presetName = opt('preset-name', 'Z.AI (GLM)')

const PRESET_START = '# ── Z.AI preset (managed by dsh-zai-mcp · bin/install.mjs) ──'
const PRESET_END = '# ── end Z.AI preset ──'
const GLOBAL_START = '# ── Z.AI MCP servers — global mount (managed by dsh-zai-mcp) ──'
const GLOBAL_END = '# ── end Z.AI MCP servers ──'

const fail = (message) => { console.error(`install: ${message}`); process.exit(1) }
const say = (message) => console.log(message)

const envFile = join(dshHome, '.env')

/** The key already present in the Harness-home env layer, if any. */
function envKey() {
  if (!existsSync(envFile)) return ''
  const match = readFileSync(envFile, 'utf8').match(/^ZAI_API_KEY=['"]?([^'"\n]+)/mu)
  return match === null ? '' : match[1]
}

/** The key DSH already stores for the configured Z.AI provider. */
function credentialKey() {
  const store = join(dshHome, '.credentials.yaml')
  if (!existsSync(store)) return ''
  const match = readFileSync(store, 'utf8').match(/^\s*ZAI_API_KEY:\s*['"]?([^\s'"]+)['"]?\s*$/mu)
  return match === null ? '' : match[1]
}

/**
 * Make sure ZAI_API_KEY is available to the launcher's env layer.
 * Sources, in order: the profile's existing .env, --key, the DSH credential
 * store (a configured Z.AI provider), the ambient environment.
 */
function ensureKey() {
  if (flag('no-key')) return
  const key = envKey() || opt('key', '') || credentialKey() || (process.env.ZAI_API_KEY ?? '')
  if (key === '') {
    fail('no ZAI_API_KEY found. Configure the Z.AI provider in DSH (the key lands in ' +
      `${join(dshHome, '.credentials.yaml')}), pass --key <value>, or put ZAI_API_KEY into ${envFile}. ` +
      'The key comes from the Z.AI console (Personal Coding Plan): https://z.ai/manage-apikey/apikey-list')
  }
  if (envKey() !== '') {
    say(`key: ZAI_API_KEY present in ${envFile}`)
    return
  }
  if (dryRun) {
    say(`key: would write ZAI_API_KEY to ${envFile} (0600)`)
    return
  }
  const current = existsSync(envFile) ? readFileSync(envFile, 'utf8') : ''
  const next = (current === '' || current.endsWith('\n') ? current : `${current}\n`) + `ZAI_API_KEY='${key}'\n`
  writeFileSync(envFile, next, { mode: 0o600 })
  say(`key: ZAI_API_KEY written to ${envFile} (0600)`)
}

function findNpx() {
  const explicit = opt('npx')
  if (explicit !== undefined) return explicit
  const candidates = [
    join(homedir(), '.volta', 'bin', 'npx'),
    '/opt/homebrew/bin/npx',
    '/usr/local/bin/npx',
    '/usr/bin/npx'
  ]
  return candidates.find((path) => existsSync(path))
}

function findDsh() {
  const explicit = opt('dsh')
  if (explicit !== undefined) return explicit
  const candidates = [
    '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'
  ]
  return candidates.find((path) => existsSync(path))
}

function rowsText() {
  const npx = findNpx()
  if (npx === undefined) fail('npx not found; pass --npx /absolute/path/to/npx')
  return readFileSync(join(repo, 'templates', 'zai-mcp-rows.yml'), 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .replace('__NPX__', npx)
    .trimEnd() + '\n'
}

/** The standard plugin list: the committed snapshot, or --standard's plugins body. */
function standardPlugins() {
  const standard = opt('standard')
  if (standard === undefined) {
    const snapshot = join(repo, 'templates', 'standard-0.2.1-rc.2.plugins.yml')
    return readFileSync(snapshot, 'utf8').split('\n').filter((line) => !line.startsWith('#')).join('\n').trimEnd() + '\n'
  }
  const lines = readFileSync(resolve(standard), 'utf8').split('\n')
  const start = lines.findIndex((line) => line === '        plugins:')
  if (start === -1) fail(`${standard}: no "        plugins:" line found`)
  return lines.slice(start + 1).filter((line) => !line.startsWith('#')).join('\n').trimEnd() + '\n'
}

function presetBlock() {
  const standard = standardPlugins()
  return [
    PRESET_START,
    '- insert:',
    `    - id: preset-${presetId}`,
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    `        id: ${presetId}`,
    '        order: 50',
    `        name: ${presetName}`,
    '        description: GLM Coding Plan tools — ZRead, Vision, Web Reader, Web Search',
    '        plugins:',
    standard.trimEnd(),
    rowsText().trimEnd(),
    PRESET_END
  ].join('\n') + '\n'
}

function globalBlock() {
  return [
    GLOBAL_START,
    '- insert:',
    rowsText().replace(/^ {10}/gmu, '    ').trimEnd(),
    GLOBAL_END
  ].join('\n') + '\n'
}

/** Remove one managed region (including its markers) or an unmanaged top-level block. */
function removeRegion(text, startMarker, endMarker, idPattern) {
  if (text.includes(startMarker)) {
    const from = text.indexOf(startMarker)
    const end = text.indexOf(endMarker, from)
    if (end === -1) fail(`marker pair is incomplete: ${startMarker}`)
    return text.slice(0, from) + text.slice(end + endMarker.length).replace(/^\n/u, '')
  }
  // unmanaged legacy block: locate the row id, walk back to the top-level `- insert:`,
  // then forward to the next top-level entry (a line beginning with "- ").
  const lines = text.split('\n')
  const idIndex = lines.findIndex((line) => new RegExp(`^\\s*(?:- )?id: ${idPattern}\\s*$`, 'u').test(line))
  if (idIndex === -1) return text
  let start = idIndex
  while (start >= 0 && !/^- /u.test(lines[start])) start -= 1
  if (start === -1) fail(`cannot locate the insert block of ${idPattern}`)
  while (start > 0 && /^#/u.test(lines[start - 1])) start -= 1
  let end = start + 1
  while (end < lines.length && !/^- /u.test(lines[end])) end += 1
  lines.splice(start, end - start)
  return lines.join('\n')
}

function manage(mode) {
  if (!existsSync(patchPath)) {
    fail(`profile patch not found: ${patchPath}. Launch DeepSeek Harness once with --profile ${profile} first`)
  }
  ensureKey()
  const patch = readFileSync(patchPath, 'utf8')
  let text = patch
  if (mode === 'preset') {
    if (pruneGlobal) text = removeRegion(text, GLOBAL_START, GLOBAL_END, 'mcp-zai-[a-z]+')
    text = removeRegion(text, PRESET_START, PRESET_END, `preset-${presetId}`)
    text = text.replace(/\s+$/u, '') + '\n\n' + presetBlock()
    const legacyGlobal = /^# ── Z\.AI MCP servers|^# ── Z\.AI Web Search/mu.test(patch)
    if ((patch.includes(GLOBAL_START) || legacyGlobal) && !pruneGlobal) {
      say('warning: profile-level mcp-zai rows are still mounted; pass --prune-global to remove them')
    }
  } else {
    text = removeRegion(text, GLOBAL_START, GLOBAL_END, 'mcp-zai-[a-z]+')
    if (text.includes('id: preset-' + presetId)) {
      text = removeRegion(text, PRESET_START, PRESET_END, `preset-${presetId}`)
    }
    text = text.replace(/\s+$/u, '') + '\n\n' + globalBlock()
  }
  if (text === patch && !force) {
    say('nothing to change (managed block already present; use --force to rewrite)')
    return
  }
  if (dryRun) {
    say(`--- would write ${patchPath} ---`)
    say(mode === 'preset' ? presetBlock() : globalBlock())
    return
  }
  writeFileSync(patchPath, text)
  say(`wrote ${patchPath} (${mode} mode)`)
}

function verify() {
  const problems = []
  const envFile = join(dshHome, '.env')
  if (!existsSync(envFile)) problems.push(`${envFile} is missing (ZAI_API_KEY lives there)`)
  else {
    try {
      const sandbox = spawnSync(process.execPath, ['-e', 'process.loadEnvFile(process.argv[1]); process.stdout.write(String((process.env.ZAI_API_KEY ?? "").length))', envFile], { encoding: 'utf8' })
      const length = Number(sandbox.stdout.trim())
      if (!(length > 0)) problems.push(`${envFile} does not define a non-empty ZAI_API_KEY`)
    } catch (error) { problems.push(`cannot read ${envFile}: ${String(error)}`) }
  }
  if (!existsSync(patchPath)) problems.push(`${patchPath} is missing`)
  else {
    const patch = readFileSync(patchPath, 'utf8')
    const rows = (patch.match(/id: mcp-zai-[a-z]+/gu) ?? []).length
    if (presetModeWanted()) {
      if (!patch.includes(`id: preset-${presetId}`)) problems.push(`preset-${presetId} is not declared in the profile patch`)
      if (rows !== 4) problems.push(`expected 4 mcp-zai rows inside the preset, found ${rows}`)
      if (patch.includes(GLOBAL_START)) problems.push('a global mount block is still present')
    } else {
      if (!patch.includes(GLOBAL_START)) problems.push("no managed global mount; rerun without --check to create it")
      if (rows !== 4) problems.push(`expected 4 global mcp-zai rows, found ${rows}`)
    }
  }
  const dsh = findDsh()
  if (dsh !== undefined && !problems.length) {
    const temp = mkdtempSync(join(tmpdir(), 'zai-mcp-verify-'))
    try {
      mkdirSync(join(temp, 'profiles'), { recursive: true })
      const source = join(dshHome, 'profiles', profile)
      cpSync(source, join(temp, 'profiles', 'profile-verify'), { recursive: true })
      const run = spawnSync(dsh, ['--profile', 'profile-verify', '--dump-config'], {
        encoding: 'utf8', env: { ...process.env, DSH_HOME: temp }
      })
      if (run.status !== 0) problems.push(`dump-config failed: ${(run.stderr ?? '').trim().slice(-300)}`)
      else {
        const presetRows = (run.stdout.match(/id: mcp-zai-/gu) ?? []).length
        if (presetRows !== 4) problems.push(`composed profile has ${presetRows} mcp-zai rows, expected 4`)
        if (presetModeWanted() && !run.stdout.includes(`id: preset-${presetId}`)) problems.push('composed profile does not declare the preset')
      }
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }
  if (problems.length) {
    for (const problem of problems) console.error(`check: ${problem}`)
    process.exit(1)
  }
  say(`check: ok (${dsh === undefined ? 'composed-profile dump skipped: dsh CLI not found' : 'composed profile verified'})`)
}

const presetModeWanted = () => !flag('global')

if (check) verify()
else manage(presetModeWanted() ? 'preset' : 'global')
