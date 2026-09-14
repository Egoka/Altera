// Синтетический fixture/MCP клиент: без модели, credentials и внешних HTTP destinations.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'

// Эти же builders используются реальным flow и no-browser schema fixture.
const clickArgs = (target, element) => ({ element, target })
const typeArgs = (target, element, text) => ({ element, target, text })
const screenshotArgs = (filename) => ({ type: 'png', scale: 'css', ...(filename ? { filename } : {}) })
function pathDenial(result, expectedPath) {
  const detail = (result.content || []).filter((item) => item.type === 'text').map((item) => item.text).join('\n')
  return result.isError === true && detail.includes(expectedPath) &&
    !/invalid.*(?:argument|input)|required|unrecognized|additional propert|validation/i.test(detail) &&
    /EROFS|EACCES|EPERM|read-only file system|permission denied|access denied|outside.*(?:workspace|allowed|root)/i.test(detail)
}

// Logical root неизменен; physicalRoot задаёт только offline fixture, не данные MCP.
const text = (r) => (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
function snapshotObservation(result, physicalRoot = '/runtime/evidence/playwright') {
  let fd
  try {
    const body = text(result), limit = 1024 * 1024
    if (Buffer.byteLength(body) > limit || body.includes('\0')) throw new Error()
    const mentions = [...body.matchAll(/\[Snapshot\]/g)]
    if (!mentions.length) return result
    const links = [...body.matchAll(/^- \[Snapshot\]\(([^)\r\n]+)\)$/gm)]
    if (mentions.length !== 1 || links.length !== 1) throw new Error()
    const link = links[0][1], logicalRoot = '/runtime/evidence/playwright'
    const resolved = path.posix.resolve('/source', link), filename = path.posix.basename(resolved)
    if (path.posix.dirname(resolved) !== logicalRoot || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.yml$/.test(filename) ||
        ![resolved, path.posix.relative('/source', resolved)].includes(link) ||
        !path.isAbsolute(physicalRoot) || path.resolve(physicalRoot) !== physicalRoot) throw new Error()
    const identity = (st) => [st.dev, st.ino, st.mode, st.nlink, st.uid, st.gid, st.size, st.mtimeNs, st.ctimeNs].join(':')
    const parents = []
    let current = path.parse(physicalRoot).root
    for (const part of physicalRoot.slice(current.length).split(path.sep)) {
      current = path.join(current, part)
      const st = fs.lstatSync(current, { bigint: true })
      if (!st.isDirectory() || st.isSymbolicLink()) throw new Error()
      parents.push([current, [st.dev, st.ino, st.mode, st.uid, st.gid].join(':')])
    }
    const file = path.join(physicalRoot, filename), before = fs.lstatSync(file, { bigint: true })
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size <= 0n || before.size > BigInt(limit)) throw new Error()
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
    const unchanged = () => {
      if (identity(fs.fstatSync(fd, { bigint: true })) !== identity(before) ||
          identity(fs.lstatSync(file, { bigint: true })) !== identity(before)) throw new Error()
      for (const [directory, expected] of parents) {
        const st = fs.lstatSync(directory, { bigint: true })
        if (!st.isDirectory() || st.isSymbolicLink() || [st.dev, st.ino, st.mode, st.uid, st.gid].join(':') !== expected) throw new Error()
      }
    }
    unchanged()
    const bytes = Buffer.alloc(Number(before.size))
    let size = 0
    while (size < bytes.length) {
      const count = fs.readSync(fd, bytes, size, bytes.length - size, size)
      if (!count) break
      size += count
    }
    unchanged()
    if (size !== Number(before.size) || size > limit) throw new Error()
    const snapshot = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))
    if (snapshot.includes('\0')) throw new Error()
    return { ...result, content: [...result.content, { type: 'text', text: snapshot }] }
  } catch {
    throw new Error('SNAPSHOT_OBSERVATION_INVALID')
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

const requiredTools = ['browser_navigate', 'browser_click', 'browser_type', 'browser_snapshot', 'browser_take_screenshot', 'browser_close']
// Успех действия не обещает snapshot: новая observation всегда запрашивается отдельно.
async function actionObservation(call, name, args, observe = snapshotObservation) {
  const action = await call(name, args)
  if (action.isError === true) throw new Error('MCP_ACTION_FAILED')
  const snapshot = await call('browser_snapshot', {})
  if (snapshot.isError === true) throw new Error('MCP_SNAPSHOT_FAILED')
  return { action, snapshot: observe(snapshot) }
}
function completedPage(page) {
  return text(page.snapshot).includes('FORM_COMPLETE_ADA') &&
    [page.action, page.snapshot].some((result) => text(result).includes('/done?name=Ada'))
}

// Только фиксированные proc-поля browser/observer; чтение не меняет namespace или права.
function collectBrowserProcesses(procRoot = '/proc', binary) {
  const executable = (file, name) => {
    const st = fs.statSync(file, { bigint: true })
    return { path: name, dev: String(st.dev), ino: String(st.ino), regular: st.isFile(),
      mode: String(st.mode), size: String(st.size), mtimeNs: String(st.mtimeNs), ctimeNs: String(st.ctimeNs) }
  }
  const kernelExecutable = (pid) => {
    const file = `${procRoot}/${pid}/exe`
    return executable(file, fs.readlinkSync(file))
  }
  const selected = ['Uid', 'Gid', 'CapEff', 'CapPrm', 'CapInh', 'CapAmb', 'CapBnd', 'NoNewPrivs', 'Seccomp', 'Seccomp_filters', 'NSpid']
  const read = (file, limit = 65536) => {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)
    try {
      const bytes = Buffer.alloc(limit + 1)
      const length = fs.readSync(fd, bytes, 0, bytes.length, 0)
      if (length > limit) throw new Error('PROC_LIMIT')
      return bytes.subarray(0, length).toString('utf8')
    } finally { fs.closeSync(fd) }
  }
  const fields = (pid) => {
    const result = {}
    for (const line of read(`${procRoot}/${pid}/status`).split('\n')) {
      const at = line.indexOf(':'), key = line.slice(0, at)
      if (!selected.includes(key)) continue
      if (key in result) throw new Error('PROC_DUPLICATE')
      result[key] = line.slice(at + 1).trim()
    }
    return result
  }
  const start = (pid) => read(`${procRoot}/${pid}/stat`, 4096).split(') ').slice(1).join(') ').split(/\s+/)[19]
  const collect = (pid, argv, rawCmdline = null) => {
    const row = { pid, argv, raw_cmdline: rawCmdline, command_format: argv.length === 1 && argv[0] !== binary ? 'rewritten-title' : 'nul-argv', errors: [] }
    if (pid !== 'self') {
      try { row.exe = kernelExecutable(pid) }
      catch (error) { row.errors.push('executable:' + (error.code || 'INVALID')) }
    }
    for (const [key, get] of [
      ['starttime', () => start(pid)], ['fields', () => fields(pid)],
      ['uid_map', () => read(`${procRoot}/${pid}/uid_map`, 4096)],
      ['gid_map', () => read(`${procRoot}/${pid}/gid_map`, 4096)],
    ]) {
      try { row[key] = get() } catch (error) { row.errors.push(key + ':' + (error.code || 'INVALID')) }
    }
    try { row.user_namespace = { value: fs.readlinkSync(`${procRoot}/${pid}/ns/user`) } }
    catch (error) { row.user_namespace = { error: error.code || 'INVALID' } }
    try {
      let namespace
      try { namespace = { value: fs.readlinkSync(`${procRoot}/${pid}/ns/user`) } }
      catch (error) { namespace = { error: error.code || 'INVALID' } }
      if (start(pid) !== row.starttime || JSON.stringify(fields(pid)) !== JSON.stringify(row.fields) ||
          JSON.stringify(namespace) !== JSON.stringify(row.user_namespace) ||
          read(`${procRoot}/${pid}/uid_map`, 4096) !== row.uid_map || read(`${procRoot}/${pid}/gid_map`, 4096) !== row.gid_map ||
          pid !== 'self' && (read(`${procRoot}/${pid}/cmdline`, 16384) !== rawCmdline ||
            JSON.stringify(kernelExecutable(pid)) !== JSON.stringify(row.exe)))
        row.errors.push('ROW_CHANGED')
    } catch (error) { row.errors.push('recheck:' + (error.code || 'INVALID')) }
    return row
  }
  const result = { observer: collect('self', []), rows: [], scanErrors: [] }
  try { result.executable = executable(binary, binary) }
  catch (error) { result.scanErrors.push('fixed_executable:' + (error.code || 'INVALID')) }
  try {
    const pids = fs.readdirSync(procRoot).filter((pid) => /^\d+$/.test(pid))
    if (pids.length > 128) result.scanErrors.push('PID_LIMIT')
    for (const pid of pids.slice(0, 128)) {
      try {
        const rawCmdline = read(`${procRoot}/${pid}/cmdline`, 16384)
        const argv = rawCmdline.split('\0').filter(Boolean)
        if (!argv[0]?.includes('chrome-headless-shell')) continue
        result.rows.push(collect(pid, argv, rawCmdline))
      } catch (error) { if (error.code !== 'ENOENT') result.scanErrors.push(pid + ':' + (error.code || 'INVALID')) }
    }
  } catch (error) { result.scanErrors.push(error.code || 'INVALID') }
  try {
    if (JSON.stringify(executable(binary, binary)) !== JSON.stringify(result.executable)) result.scanErrors.push('FIXED_EXE_CHANGED')
  } catch (error) { result.scanErrors.push('fixed_executable_recheck:' + (error.code || 'INVALID')) }
  return result
}

// Title — только наблюдаемый prefix/role, не реконструкция полного argv.
function browserCommand(row, binary) {
  const fail = () => { throw new Error('BROWSER_COMMAND_UNPROVEN') }
  if (!Array.isArray(row.argv) || !row.argv.length || row.argv.some((a) => typeof a !== 'string')) fail()
  const known = ['zygote', 'renderer', 'gpu-process', 'utility']
  if (row.argv[0] === binary) {
    if (row.argv.some((a) => a === '--no-sandbox' || a.startsWith('--no-sandbox='))) fail()
    const types = row.argv.filter((a) => a.startsWith('--type'))
    if (types.length > 1 || types.length && !known.some((role) => types[0] === '--type=' + role)) fail()
    return { format: 'nul-argv', role: types[0]?.slice(7) || 'browser', complete_argv: true }
  }
  const title = row.argv[0]
  if (row.argv.length !== 1 || !title.startsWith(binary + ' --type=') || /[\x00-\x1f]/.test(title)) fail()
  const tail = title.slice(binary.length + 1), type = /^--type=(zygote|renderer|gpu-process|utility)(?: |$)/.exec(tail)
  if (!type || [...tail.matchAll(/(?:^|\s)--type(?:=|\s|$)/g)].length !== 1 || /(?:^|\s)--no-sandbox(?:=|\s|$)/.test(tail)) fail()
  return { format: 'rewritten-title', role: type[1], complete_argv: false, title }
}

function validateBrowserProcesses(diagnostic, binary) {
  const fail = () => { throw new Error('BROWSER_ISOLATION_UNPROVEN') }
  const caps = ['CapEff', 'CapPrm', 'CapInh', 'CapAmb', 'CapBnd']
  const map = (value) => {
    if (typeof value !== 'string' || value.length > 4096) fail()
    const rows = value.trim().split('\n').map((line) => line.trim().split(/\s+/))
    if (!rows.length || rows.length > 32 || rows.some((row) => row.length !== 3 || row.some((v) => !/^\d+$/.test(v)))) fail()
    const parsed = rows.map((row) => row.map(Number))
    if (parsed.some(([inner, outer, length]) => length < 1 || inner + length > 4294967296 || outer + length > 4294967296)) fail()
    return JSON.stringify(parsed)
  }
  const identity = (row) => /^user:\[\d+\]$/.test(row.user_namespace?.value || '') ? row.user_namespace.value : null
  const common = (row) => {
    if (!row || !Array.isArray(row.errors) || row.errors.length || !/^\d+$/.test(row.starttime || '')) fail()
    const f = row.fields || {}
    for (const key of ['Uid', 'Gid']) if (!/^1000\s+1000\s+1000\s+1000$/.test(f[key] || '')) fail()
    for (const key of caps) if (!/^[0-9a-f]{16}$/.test(f[key] || '')) fail()
    if (f.NoNewPrivs !== '1' || f.Seccomp !== '2' || !/^[1-9]\d*$/.test(f.Seccomp_filters || '') ||
        !/^\d+(?:\s+\d+)*$/.test(f.NSpid || '')) fail()
    return f
  }
  if (!Array.isArray(diagnostic.scanErrors) || diagnostic.scanErrors.length || !Array.isArray(diagnostic.rows)) fail()
  const observer = diagnostic.observer, outer = common(observer), outerNS = identity(observer)
  if (!outerNS || caps.some((key) => outer[key] !== '0000000000000000')) fail()
  const observerUID = map(observer.uid_map), observerGID = map(observer.gid_map), narrow = '[[1000,1000,1]]'
  const expectedExe = diagnostic.executable
  if (!expectedExe || expectedExe.path !== binary || expectedExe.regular !== true ||
      !/^\d+$/.test(expectedExe.dev || '') || !/^\d+$/.test(expectedExe.ino || '')) fail()
  let renderer = false, mainBrowser = false
  for (const row of diagnostic.rows) {
    const f = common(row), uid = map(row.uid_map), gid = map(row.gid_map), ns = identity(row)
    if (!row.exe || row.exe.path !== binary || row.exe.regular !== true ||
        row.exe.dev !== expectedExe.dev || row.exe.ino !== expectedExe.ino) fail()
    const command = browserCommand(row, binary), role = command.role
    if (role === 'browser' && command.format === 'nul-argv' && row.argv.length > 1) mainBrowser = true
    const same = ns === outerNS
    const mapProof = uid === narrow && gid === narrow && uid !== observerUID && gid !== observerGID
    const inner = !same && uid === narrow && gid === narrow &&
      (ns !== null || row.user_namespace?.error === 'EACCES' && mapProof)
    if (!ns && row.user_namespace?.error !== 'EACCES') fail()
    if (same && (uid !== observerUID || gid !== observerGID)) fail()
    if (!inner) {
      if (uid !== observerUID || gid !== observerGID || caps.some((key) => f[key] !== '0000000000000000')) fail()
    } else {
      if (f.CapInh !== '0000000000000000' || f.CapAmb !== '0000000000000000') fail()
      const expected = role === 'zygote' && f.CapEff !== '0000000000000000' ? '0000000000200000' : '0000000000000000'
      if (f.CapEff !== expected || f.CapPrm !== expected) fail()
    }
    if (role === 'renderer') renderer = true
  }
  if (!renderer || !mainBrowser) fail()
}

function inspectBrowserProcesses(report, binary, procRoot = '/proc', persist = (rows) =>
  fs.writeFileSync('/runtime/evidence/browser-processes.json', JSON.stringify(rows, null, 2) + '\n')) {
  report.browser_processes = collectBrowserProcesses(procRoot, binary)
  persist(report.browser_processes)
  validateBrowserProcesses(report.browser_processes, binary)
}

const mode = process.argv[2]
if (mode === 'contract') {
  const error = (text, isError = true) => ({ isError, content: [{ type: 'text', text }] })
  console.log(JSON.stringify({ requests: [
    { name: 'browser_click', arguments: clickArgs('e1', 'Continue') },
    { name: 'browser_type', arguments: typeArgs('e2', 'Name', 'Ada') },
    { name: 'browser_click', arguments: clickArgs('e3', 'Submit') },
    ...[undefined, '/source/forbidden.png', '../../../source/relative.png', '/runtime/policy/forbidden.png'].map((filename) =>
      ({ name: 'browser_take_screenshot', arguments: screenshotArgs(filename) })),
  ], denials: {
    readonly: pathDenial(error("EROFS: read-only file system, open '/source/forbidden.png'"), '/source/forbidden.png'),
    policy_path: pathDenial(error('Access denied: /runtime/policy/forbidden.png is outside workspace roots'), '/runtime/policy/forbidden.png'),
    schema_error: pathDenial(error('Invalid arguments: scale is required'), '/source/forbidden.png'),
    schema_with_errno: pathDenial(error('Invalid arguments EROFS /source/forbidden.png'), '/source/forbidden.png'),
    generic_failure: pathDenial(error('Browser closed /source/forbidden.png'), '/source/forbidden.png'),
    other_path: pathDenial(error('EACCES /other/path'), '/source/forbidden.png'),
    not_error: pathDenial(error('EROFS /source/forbidden.png', false), '/source/forbidden.png'),
  } }))
} else if (mode === 'process-title-contract') {
  const inputs = JSON.parse(fs.readFileSync(0, 'utf8'))
  const cases = inputs.map((item) => {
    try { validateBrowserProcesses(item.diagnostic, process.argv[4]); return { name: item.name, ok: true } }
    catch { return { name: item.name, ok: false } }
  })
  const formats = inputs[0].diagnostic.rows.map((row) => browserCommand(row, process.argv[4]).format)
  console.log(JSON.stringify({ cases, formats }))
} else if (mode === 'process-contract') {
  const cases = JSON.parse(fs.readFileSync(0, 'utf8')).map((item) => {
    try { validateBrowserProcesses(item.diagnostic, process.argv[4]); return { name: item.name, ok: true } }
    catch { return { name: item.name, ok: false } }
  })
  const report = {}; let persisted, ok = true
  try { inspectBrowserProcesses(report, process.argv[4], process.argv[3], (rows) => { persisted = JSON.parse(JSON.stringify(rows)) }) }
  catch { ok = false }
  console.log(JSON.stringify({ cases, capture: { ok, persisted, report } }))
} else if (mode === 'action-contract') {
  const observations = []
  for (const item of JSON.parse(fs.readFileSync(0, 'utf8'))) {
    const calls = [], events = []
    let observed = 0
    const call = async (name, args) => {
      calls.push({ name, args })
      if (name === 'browser_snapshot') { events.push('snapshot'); return item.snapshot }
      events.push('action-start')
      await new Promise((resolve) => setImmediate(resolve))
      if (item.rejectAction) throw new Error('SYNTHETIC_ACTION_REJECTED')
      events.push('action-complete'); return item.action
    }
    try {
      const result = await actionObservation(call, item.method, { synthetic: true }, (snapshot) => {
        observed++; return snapshotObservation(snapshot, process.argv[3])
      })
      observations.push({ name: item.name, ok: true, text: text(result.snapshot), actionText: text(result.action), completed: completedPage(result), calls, events, observed })
    } catch (error) { observations.push({ name: item.name, ok: false, error: error.message, calls, events, observed }) }
  }
  console.log(JSON.stringify({ requiredTools, observations }))
} else if (mode === 'snapshot-contract') {
  const cases = JSON.parse(fs.readFileSync(0, 'utf8'))
  console.log(JSON.stringify(cases.map((item) => {
    try { return { name: item.name, ok: true, text: text(snapshotObservation(item.result, process.argv[3])) } }
    catch (error) { return { name: item.name, ok: false, error: error.message } }
  })))
} else if (mode === 'web' || mode === 'sink') {
  let hits = 0
  http.createServer((req, res) => {
    if (mode === 'sink') {
      if (req.url !== '/count') hits++
      res.end(req.url === '/count' ? JSON.stringify({ hits }) : 'FORBIDDEN_SYNTHETIC_SINK')
      return
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: 'http://forbidden-sink:3001/target' }); res.end(); return
    }
    res.setHeader('Content-Type', 'text/html')
    if (req.url.startsWith('/done')) res.end('<title>Complete</title><h1>FORM_COMPLETE_ADA</h1>')
    else if (req.url === '/form') res.end('<title>Form</title><form action="/done"><label>Name<input name="name"></label><button>Submit</button></form>')
    else res.end('<title>Altera synthetic</title><h1>ALTERA_PLAYWRIGHT_CANARY</h1><a href="/form">Continue</a>')
  }).listen(mode === 'sink' ? 3001 : 3000, '0.0.0.0', () => console.log('FIXTURE_READY'))
} else {
  const output = '/runtime/evidence/playwright'
  fs.mkdirSync(output, { recursive: true })
  fs.mkdirSync('/runtime/cache/playwright-home', { recursive: true })
  const vector = JSON.parse(fs.readFileSync('/runtime/policy/vector.json'))
  const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
  function tree(root) {
    const entries = []
    function walk(dir) {
      for (const entry of fs.readdirSync(dir).sort()) {
        const file = path.join(dir, entry), st = fs.lstatSync(file)
        const relative = path.relative(root, file)
        if (st.isSymbolicLink()) entries.push([relative, 'link', fs.readlinkSync(file)])
        else if (st.isDirectory()) walk(file)
        else entries.push([relative, st.mode & 0o777, hash(fs.readFileSync(file))])
      }
    }
    walk(root)
    return hash(JSON.stringify(entries))
  }
  function inventory() {
    const browser = vector.find((a) => a.startsWith('--executable-path=')).split('=')[1]
    const descriptor = JSON.parse(fs.readFileSync('/opt/playwright-mcp/node_modules/playwright-core/browsers.json'))
    const selected = descriptor.browsers.find((b) => b.name === 'chromium-headless-shell')
    assert.equal(selected.revision, '1243'); assert.equal(selected.browserVersion, '153.0.8010.12')
    assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'arm64'); assert.equal(process.version, 'v24.12.0')
    assert.match(fs.readFileSync('/etc/os-release', 'utf8'), /VERSION_ID="12"/)
    const packages = {}
    for (const name of ['@playwright/mcp', 'playwright', 'playwright-core', '@playwright/browser-chromium']) {
      const data = JSON.parse(fs.readFileSync('/opt/playwright-mcp/node_modules/' + name + '/package.json'))
      assert.equal(data.version, name === '@playwright/mcp' ? '0.0.80' : '1.63.0-alpha-2026-08-31')
      packages[name] = { version: data.version, sha256: hash(fs.readFileSync('/opt/playwright-mcp/node_modules/' + name + '/package.json')) }
    }
    assert.equal(fs.realpathSync(browser), browser)
    assert.ok(fs.statSync(browser).isFile()); assert.ok(fs.statSync(browser).mode & 0o111)
    assert.ok(!fs.readdirSync('/ms-playwright').some((name) => /^(chromium-|chromium_|firefox|webkit)/.test(name) && !name.startsWith('chromium_headless_shell-')))
    return { selected, browser, packages, uid: process.getuid(), gid: process.getgid(),
      browser_sha256: hash(fs.readFileSync(browser)), env_sha256: hash(fs.readFileSync('/usr/bin/env')),
      descriptor_sha256: hash(fs.readFileSync('/opt/playwright-mcp/node_modules/playwright-core/browsers.json')),
      packages_tree: tree('/opt/playwright-mcp'), browsers_tree: tree('/ms-playwright') }
  }
  const poison = { ...process.env, NODE_OPTIONS: '--require=/runtime/policy/poison.cjs',
    PWDEBUG: '1', SELENIUM_REMOTE_URL: 'http://forbidden-sink:3001', PLAYWRIGHT_MCP_BROWSER: 'firefox',
    PLAYWRIGHT_MCP_CDP_ENDPOINT: 'http://forbidden-sink:3001', PLAYWRIGHT_MCP_EXECUTABLE_PATH: '/missing', PLAYWRIGHT_MCP_SANDBOX: 'false' }
  async function envProof() {
    const script = `process.stdout.write(JSON.stringify(process.env)+'\\n');process.stdin.once('data',b=>process.stdout.write(b));process.on('SIGTERM',()=>process.exit(23))`
    const child = spawn(vector[0], [...vector.slice(1, 10), '-e', script], { env: poison, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', (b) => { stdout += b }); child.stderr.on('data', (b) => { stderr += b })
    const done = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })))
    for (let n = 0; n < 100 && !stdout.includes('\n'); n++) await new Promise((r) => setTimeout(r, 20))
    const observed = JSON.parse(stdout.split('\n')[0])
    assert.deepEqual(observed, Object.fromEntries(vector.slice(2, 9).map((s) => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)])))
    child.stdin.write('STDIO_CANARY\n')
    for (let n = 0; n < 100 && !stdout.includes('STDIO_CANARY'); n++) await new Promise((r) => setTimeout(r, 20))
    assert.ok(stdout.includes('STDIO_CANARY')); child.kill('SIGTERM')
    const exit = await done; assert.deepEqual(exit, { code: 23, signal: null }); assert.equal(stderr, '')
    assert.equal(fs.existsSync('/runtime/evidence/poison-executed'), false)
    return { names: Object.keys(observed).sort(), values: observed, exit, poisonPreloadExecuted: false, stdinEcho: true }
  }
  function client(argv = vector) {
    const child = spawn(argv[0], argv.slice(1), { env: poison, stdio: ['pipe', 'pipe', 'pipe'] })
    let next = 0, pending = '', stderr = '', raw = ''
    const awaiting = new Map()
    const close = new Promise((resolve) => child.once('close', (code, signal) => {
      for (const { reject } of awaiting.values()) reject(new Error('MCP_CHILD_CLOSED'))
      resolve({ code, signal })
    }))
    child.stderr.on('data', (b) => { stderr += b; assert.ok(stderr.length < 1024 * 1024) })
    child.stdout.on('data', (b) => {
      pending += b; raw += b; assert.ok(pending.length < 4 * 1024 * 1024)
      while (pending.includes('\n')) {
        const end = pending.indexOf('\n'), line = pending.slice(0, end); pending = pending.slice(end + 1)
        if (!line) continue
        const message = JSON.parse(line)
        if (awaiting.has(message.id)) {
          const waiter = awaiting.get(message.id); awaiting.delete(message.id); clearTimeout(waiter.timer)
          if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
          else waiter.resolve(message.result)
        }
      }
    })
    function send(method, params, notification = false) {
      const message = { jsonrpc: '2.0', method, params }
      if (notification) { child.stdin.write(JSON.stringify(message) + '\n'); return }
      const id = ++next; message.id = id
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { awaiting.delete(id); reject(new Error('MCP_TIMEOUT:' + method)) }, 30000)
        awaiting.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify(message) + '\n')
      })
    }
    return { child, send, async stop(label) {
      child.stdin.end(); child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000)
      const exit = await close; clearTimeout(timer)
      fs.writeFileSync('/runtime/evidence/' + label + '-protocol.jsonl', raw)
      fs.writeFileSync('/runtime/evidence/' + label + '-stderr.log', stderr)
      return exit
    } }
  }
  async function initialize(c) {
    const init = await c.send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'altera-static-canary', version: '1' } })
    c.send('notifications/initialized', {}, true)
    const list = await c.send('tools/list', {})
    for (const tool of requiredTools) assert.ok(list.tools.some((t) => t.name === tool))
    return { init, tools: list.tools }
  }
  function ref(result, label) {
    const line = text(result).split('\n').find((l) => l.includes('"' + label + '"') && l.includes('[ref='))
    assert.ok(line, 'missing accessible reference:' + label)
    return line.match(/\[ref=([^\]]+)\]/)[1]
  }
  async function unreachable(host, port) {
    return new Promise((resolve) => {
      const socket = net.connect({ host, port }); socket.setTimeout(1500)
      socket.on('connect', () => { socket.destroy(); resolve(false) })
      socket.on('error', () => resolve(true)); socket.on('timeout', () => { socket.destroy(); resolve(true) })
    })
  }
  const report = { mode, accepted: false }
  const watchdog = setTimeout(() => { console.error('CANARY_WATCHDOG'); process.exit(78) }, 180000)
  try {
    report.inventory = inventory(); assert.notEqual(report.inventory.uid, 0)
    report.environment = await envProof()
    const c = client()
    try {
      report.protocol = await initialize(c)
      const call = async (name, args = {}, allowedError = false) => {
        const result = await c.send('tools/call', { name, arguments: args })
        if (!allowedError) assert.notEqual(result.isError, true, text(result))
        return result
      }
      let page = await actionObservation(call, 'browser_navigate', { url: 'http://altera-web:3000' })
      assert.ok(text(page.snapshot).includes('ALTERA_PLAYWRIGHT_CANARY'))
      page = await actionObservation(call, 'browser_click', clickArgs(ref(page.snapshot, 'Continue'), 'Continue'))
      page = await actionObservation(call, 'browser_type', typeArgs(ref(page.snapshot, 'Name'), 'Name', 'Ada'))
      page = await actionObservation(call, 'browser_click', clickArgs(ref(page.snapshot, 'Submit'), 'Submit'))
      assert.ok(completedPage(page))
      inspectBrowserProcesses(report, report.inventory.browser)
      const oldOutput = path.join(output, 'synthetic-old-output.bin')
      fs.writeFileSync(oldOutput, Buffer.alloc(17 * 1024 * 1024)); fs.utimesSync(oldOutput, 1, 1)
      report.screenshot = await call('browser_take_screenshot', screenshotArgs())
      assert.equal(fs.existsSync(oldOutput), false); report.outputEviction = true
      const images = fs.readdirSync(output).filter((p) => p.endsWith('.png'))
      assert.ok(images.length > 0); for (const image of images) assert.equal(fs.readFileSync(path.join(output, image)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
      report.sourceScreenshot = await call('browser_take_screenshot', screenshotArgs('/source/forbidden.png'), true)
      report.relativeScreenshot = await call('browser_take_screenshot', screenshotArgs('../../../source/relative.png'), true)
      assert.ok(pathDenial(report.relativeScreenshot, '/source/relative.png'), text(report.relativeScreenshot))
      report.policyScreenshot = await call('browser_take_screenshot', screenshotArgs('/runtime/policy/forbidden.png'), true)
      assert.ok(pathDenial(report.sourceScreenshot, '/source/forbidden.png'), text(report.sourceScreenshot))
      assert.ok(pathDenial(report.policyScreenshot, '/runtime/policy/forbidden.png'), text(report.policyScreenshot))
      assert.ok(!fs.existsSync('/source/forbidden.png')); assert.ok(!fs.existsSync('/runtime/policy/forbidden.png'))
      report.redirect = await call('browser_navigate', { url: 'http://altera-web:3000/redirect' }, true)
      if (mode === 'control') {
        report.sink = await fetch('http://forbidden-sink:3001/count').then((r) => r.json())
        report.sinkReachable = true
      } else {
        assert.equal(report.redirect.isError, true)
        assert.ok(await unreachable('forbidden-sink', 3001))
      }
      await call('browser_close')
      report.tools = true
    } finally { report.exit = await c.stop('main') }
    const missing = [...vector]; missing[13] += '-missing'
    const d = client(missing)
    try {
      await initialize(d)
      const result = await d.send('tools/call', { name: 'browser_navigate', arguments: { url: 'http://altera-web:3000' } })
      assert.equal(result.isError, true); assert.match(text(result), /executable.*(exist|missing)|doesn.t exist/i)
      report.missingBrowser = true
    } finally { await d.stop('missing') }
    report.denials = {}
    for (const file of ['/source/write-denial', '/runtime/policy/write-denial', '/opt/playwright-mcp/write-denial', '/ms-playwright/write-denial', '/write-denial']) {
      try { fs.writeFileSync(file, 'DENIAL'); assert.fail('write allowed:' + file) }
      catch (error) { assert.ok(['EROFS', 'EACCES'].includes(error.code)); report.denials[file] = error.code }
    }
    for (const [host, port] of [['192.0.2.1', 80], ['host.docker.internal', Number(process.argv[3])], ['172.17.0.1', Number(process.argv[3])]]) {
      assert.ok(await unreachable(host, port)); report.denials[host + ':' + port] = 'unreachable'
    }
    report.after = inventory()
    assert.equal(report.after.packages_tree, report.inventory.packages_tree)
    assert.equal(report.after.browsers_tree, report.inventory.browsers_tree)
    report.outputBytes = fs.readdirSync(output).reduce((total, name) => total + fs.statSync(path.join(output, name)).size, 0)
    assert.ok(report.outputBytes <= 16777216)
    report.profileResidue = fs.readdirSync('/runtime/tmp').filter((p) => p.startsWith('playwright_chromiumdev_profile-'))
    assert.deepEqual(report.profileResidue, [])
    assert.ok(!fs.existsSync('/runtime/evidence/poison-executed'))
    report.accepted = true
  } catch (error) { report.failure = { name: error.name, message: error.message, stack: error.stack }; process.exitCode = 1 }
  finally {
    clearTimeout(watchdog)
    fs.writeFileSync('/runtime/evidence/canary-report.json', JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify({ accepted: report.accepted, mode, failure: report.failure?.message }))
  }
}
