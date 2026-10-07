import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell,
} from 'electron'
import { execFile, execFileSync, spawn } from 'node:child_process'
import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
  promises as fs,
} from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { clearIconCache, getIcon, setIconLogger } from './icons'
import { extractZip } from './unzip'

// CommonJS로 번들된다. Windows에서 asar 안의 ESM 진입점을 읽지 못하는 문제가 있어
// 메인 프로세스는 CJS로 고정한다 (__dirname을 그대로 쓸 수 있다).
const dirname = __dirname
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

// 이름을 먼저 못 박는다. 이걸 빼면 설정/캐시가 사용자 폴더에 그대로 흩어진다.
app.setName('DeskField')

/** 필드 배치는 여기에 저장된다 (Windows: %APPDATA%\DeskField\state.json). */
const STATE_FILE = path.join(app.getPath('userData'), 'state.json')

/**
 * 시작 과정을 파일에 남긴다. 창이 안 뜨는 상황은 화면에 아무것도 없어서
 * 사용자 쪽에서 원인을 알 방법이 이 로그밖에 없다.
 */
const LOG_FILE = path.join(app.getPath('userData'), 'startup.log')

function log(message: string) {
  const line = `${new Date().toISOString()}  ${message}`
  try {
    mkdirSync(path.dirname(LOG_FILE), { recursive: true })
    appendFileSync(LOG_FILE, `${line}\n`)
  } catch {
    // 로그를 못 써도 앱은 계속 떠야 한다.
  }
  console.log(line)
}

// 조용히 죽지 않게 — 무슨 일이 있었는지 남기고 사용자에게도 알린다.
process.on('uncaughtException', (error: Error) => {
  log(`치명적 오류: ${error?.stack ?? error}`)
  try {
    dialog.showErrorBox('바탕 필드 오류', `${error?.message ?? error}\n\n로그: ${LOG_FILE}`)
  } catch {
    // 창을 띄울 수 없는 단계면 로그만 남는다.
  }
})

process.on('unhandledRejection', (reason) => log(`처리되지 않은 거부: ${reason}`))

log(`--- 시작 (electron ${process.versions.electron}, ${process.platform} ${process.arch}) ---`)
log(`실행 파일: ${app.getPath('exe')}`)
setIconLogger(log)

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

// 단일 인스턴스 — 두 번 실행하면 기존 창을 다시 띄우고 종료한다.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
}

function resolveIndex() {
  return path.join(dirname, '../renderer/index.html')
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay()

  win = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    // 포커스를 뺏지 않는 건 창을 띄운 뒤에 건다. Windows에서는 focusable:false로
    // 만든 창이 show()에 반응하지 않고 그대로 숨어 있는 경우가 있다.
    focusable: true,
    show: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.setAlwaysOnTop(false)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
  // 시작은 통과 모드. 커서가 필드 위로 오면 렌더러가 꺼준다.
  win.setIgnoreMouseEvents(true, { forward: true })

  win.on('close', (e) => {
    // 종료·로그오프 중에는 절대 막지 않는다. 막으면 Windows 종료가 지연되고
    // 정리 작업이 끝나기 전에 프로세스가 강제로 죽는다.
    if (!quitting) {
      e.preventDefault()
      win?.hide()
    }
  })

  // Windows 종료·재시작·로그오프. before-quit이 오지 않는 경로라서 이걸 놓치면
  // 숨긴 파일이 숨겨진 채로 다음 부팅을 맞는다 — 부팅 후 앱이 뜨기 전까지
  // 바탕화면에서 파일이 사라진 것처럼 보인다.
  win.on('query-session-end', () => {
    quitting = true
    unhideAllSync('세션 종료 예고')
  })

  win.on('session-end', () => {
    quitting = true
    unhideAllSync('세션 종료')
  })

  if (DEV_SERVER_URL) {
    win.loadURL(DEV_SERVER_URL)
  } else {
    win.loadFile(resolveIndex())
  }

  win.webContents.on('did-finish-load', () => {
    log('렌더러 로드 완료')
    reveal()
  })

  win.webContents.on('did-fail-load', (_e, code, description, url) => {
    log(`렌더러 로드 실패: ${code} ${description} (${url})`)
    dialog.showErrorBox('바탕 필드', `화면을 불러오지 못했습니다.\n${description}\n\n로그: ${LOG_FILE}`)
  })

  win.webContents.on('render-process-gone', (_e, details) => {
    log(`렌더러 프로세스 종료: ${details.reason}`)
  })

  win.once('ready-to-show', () => {
    log('ready-to-show')
    reveal()
  })

  // 첫 페인트 전에 띄우면 그 시간만큼 흰 화면이 보인다 — 특히 첫 설치 직후는
  // 보안 검사 때문에 로딩이 수십 초까지 늘어질 수 있다. ready-to-show(첫 페인트)를
  // 기다리고, 마지막 방어선도 로딩이 끝났을 때만 작동시킨다.
  setTimeout(() => {
    if (!win || win.isDestroyed() || win.isVisible()) return
    if (win.webContents.isLoading()) {
      log('아직 로딩 중 — 페인트를 기다린다')
      win.webContents.once('did-finish-load', reveal)
      return
    }
    log('이벤트가 오지 않아 강제로 창을 띄운다')
    reveal()
  }, 12000)
}

/** 창을 띄우고 나서 포커스를 받지 않도록 바꾼다 (순서가 중요하다). */
function reveal() {
  if (!win || win.isDestroyed() || win.isVisible()) return
  win.showInactive()
  win.setFocusable(false)
  log(`창 표시됨 visible=${win.isVisible()} bounds=${JSON.stringify(win.getBounds())}`)
}

function showWindow() {
  if (!win) return createWindow()
  if (!win.isVisible()) win.showInactive()
}

function syncWorkArea() {
  if (!win) return
  const { workArea } = screen.getPrimaryDisplay()
  win.setBounds(workArea)
  win.webContents.send('workarea:changed', workArea)
}

/**
 * 모니터를 꽂거나 뽑으면 Windows가 이 신호를 여러 번, 그것도 작업 표시줄이
 * 자리를 잡기 전 크기로 보낸다. 잠잠해진 뒤의 한 번만 렌더러에 전한다 —
 * 중간 크기에 맞춰 필드를 배치해 버리면 그게 그대로 남는다.
 */
let workAreaTimer: NodeJS.Timeout | null = null
function scheduleWorkAreaSync() {
  if (workAreaTimer) clearTimeout(workAreaTimer)
  workAreaTimer = setTimeout(() => {
    workAreaTimer = null
    syncWorkArea()
  }, 700)
}

/* ------------------------------------------------------------------ 상태 저장 */

async function readState(): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf8'))
  } catch {
    return null
  }
}

async function writeState(state: unknown) {
  const tmp = `${STATE_FILE}.tmp`
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8')
  // 저장 도중 앱이 죽어도 기존 파일이 깨지지 않도록 교체 방식으로 쓴다.
  await fs.rename(tmp, STATE_FILE)
  scheduleSearchLinks(state)
}

/* ------------------------------------------------------------------ 검색용 바로가기 */

/**
 * 숨김 속성이 걸린 파일은 윈도우 검색·탐색기·파일 열기 창에서 전부 빠진다.
 * 그래서 사용자 폴더 아래 '바탕 필드' 폴더에 필드별로 바로가기(.lnk)를 만들어 둔다.
 * 이 폴더는 숨기지 않으므로 시작 메뉴 검색이 이름으로 찾아주고, 파일 열기 창에서도
 * 바로가기를 고르면 숨겨진 원본이 그대로 열린다. 원본은 건드리지 않는다.
 */
const LINK_ROOT = path.join(app.getPath('home'), '바탕 필드')
const LINK_MARK = '.deskfield'
const QUICK_ACCESS = 'shell:::{679f85cb-0220-4080-b29b-5540cc05aab6}'

let linkTimer: ReturnType<typeof setTimeout> | null = null
let linkPending: unknown = null
let linkRunning: Promise<void> = Promise.resolve()
/** 마지막으로 반영한 모양 — 필드를 옮기기만 했으면 다시 쓸 게 없다. */
let linkApplied: string | null = null

function scheduleSearchLinks(state: unknown) {
  if (process.platform !== 'win32') return
  linkPending = state
  if (linkTimer) clearTimeout(linkTimer)
  linkTimer = setTimeout(() => {
    linkTimer = null
    // 앞선 갱신이 끝난 뒤에 돈다 — 둘이 겹치면 같은 파일을 동시에 지우고 쓴다.
    linkRunning = linkRunning
      .then(() => syncSearchLinks(linkPending))
      .catch((error) => log(`검색용 바로가기 갱신 실패: ${error}`))
  }, 1500)
}

function safeName(name: string, max: number) {
  let clean = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, max).replace(/[. ]+$/, '')
  // 윈도우가 예약한 이름(CON, NUL…)은 확장자가 붙어도 만들 수 없다.
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(clean)) clean = `_${clean}`
  return clean || '이름 없음'
}

type LinkSpec = { name: string; details: Electron.ShortcutDetails }

/** 바로가기를 바로가기로 한 번 더 감싸지 않는다 — 원래 바로가기의 대상을 그대로 옮겨 적는다. */
function linkSpec(target: string): { stem: string; details: Electron.ShortcutDetails } {
  const base = path.basename(target)
  if (/\.lnk$/i.test(base)) {
    const stem = safeName(base.slice(0, -4), 100)
    try {
      const details = shell.readShortcutLink(target)
      if (details.target) return { stem, details }
    } catch {
      /* 대상을 읽을 수 없는 바로가기(스토어 앱 등)는 그 파일 자체를 가리킨다 */
    }
    return { stem, details: { target } }
  }
  return { stem: safeName(base, 100), details: { target, description: '바탕 필드에 담긴 항목' } }
}

function sameLink(file: string, details: Electron.ShortcutDetails) {
  try {
    const current = shell.readShortcutLink(file)
    return norm(current.target) === norm(details.target ?? '') && (current.args ?? '') === (details.args ?? '')
  } catch {
    return false
  }
}

async function syncSearchLinks(raw: unknown) {
  const state = raw as {
    settings?: { searchLinks?: boolean; hideOriginals?: boolean }
    fields?: { title?: string; portal?: string; items?: { path?: string }[] }[]
  } | null
  const marked = existsSync(path.join(LINK_ROOT, LINK_MARK))

  if (state?.settings?.searchLinks === false) {
    // 끄면 폴더째 치운다 — 우리가 만든 폴더일 때만. 빠른 액세스에 죽은 고정이 남지 않게 먼저 푼다.
    if (marked) {
      await unpinFromQuickAccess(LINK_ROOT)
      await fs.rm(LINK_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
      log('검색용 바로가기 폴더 삭제')
    }
    linkApplied = null
    return
  }

  // 원본을 숨기지 않으면 원본이 그대로 검색된다 — 바로가기는 중복일 뿐이라 비운다.
  const needed = state?.settings?.hideOriginals !== false

  // 소문자 이름 → 필드 폴더. 윈도우 파일 이름은 대소문자를 가리지 않는다.
  const wanted = new Map<string, { name: string; links: Map<string, LinkSpec> }>()
  for (const field of needed ? state?.fields ?? [] : []) {
    if (field?.portal) continue
    const links = new Map<string, LinkSpec>()
    for (const item of field?.items ?? []) {
      const target = item?.path
      if (typeof target !== 'string' || target.startsWith('shell:') || !existsSync(target)) continue
      const { stem, details } = linkSpec(target)
      let name = `${stem}.lnk`
      for (let n = 2; links.has(name.toLowerCase()); n++) name = `${stem} (${n}).lnk`
      links.set(name.toLowerCase(), { name, details })
    }
    if (links.size === 0) continue
    const base = safeName(field?.title ?? '', 60)
    let folder = base
    for (let n = 2; wanted.has(folder.toLowerCase()); n++) folder = `${base} (${n})`
    wanted.set(folder.toLowerCase(), { name: folder, links })
  }

  const signature = JSON.stringify(
    [...wanted.values()].map((folder) => [
      folder.name,
      [...folder.links.values()].map((link) => [link.name, link.details.target, link.details.args]),
    ]),
  )
  if (signature === linkApplied) return

  if (!marked) {
    if (wanted.size === 0) return
    if (existsSync(LINK_ROOT)) {
      // 사용자가 직접 만든 같은 이름의 폴더는 건드리지 않는다.
      log(`검색용 바로가기: ${LINK_ROOT}가 이미 있어 건너뜀`)
      return
    }
    await fs.mkdir(LINK_ROOT, { recursive: true })
    const mark = path.join(LINK_ROOT, LINK_MARK)
    await fs.writeFile(mark, '바탕 필드가 자동으로 관리하는 폴더입니다.\n')
    execFile('attrib', ['+h', mark], { windowsHide: true }, () => {})
    void pinToQuickAccess(LINK_ROOT)
  }

  // 없어진 필드의 폴더 정리 — 바로가기만 든 폴더만 지운다.
  for (const entry of await fs.readdir(LINK_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || wanted.has(entry.name.toLowerCase())) continue
    const dir = path.join(LINK_ROOT, entry.name)
    const inside = await fs.readdir(dir).catch(() => [] as string[])
    if (inside.every((name) => name.toLowerCase().endsWith('.lnk'))) {
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
    }
  }

  let failed = 0
  for (const folder of wanted.values()) {
    const dir = path.join(LINK_ROOT, folder.name)
    await fs.mkdir(dir, { recursive: true })
    for (const name of await fs.readdir(dir)) {
      if (name.toLowerCase().endsWith('.lnk') && !folder.links.has(name.toLowerCase())) {
        await fs.rm(path.join(dir, name), { force: true })
      }
    }
    for (const link of folder.links.values()) {
      const file = path.join(dir, link.name)
      if (sameLink(file, link.details)) continue
      // 하나가 실패해도 나머지는 계속 만든다.
      try {
        if (!shell.writeShortcutLink(file, 'create', link.details)) failed++
      } catch {
        failed++
      }
    }
  }
  if (failed > 0) log(`검색용 바로가기 ${failed}개를 만들지 못함`)
  else linkApplied = signature
}

function powershell(command: string) {
  return new Promise<boolean>((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='SilentlyContinue';${command}`],
      { windowsHide: true, timeout: 15000 },
      (error) => resolve(!error),
    )
  })
}

const psQuote = (text: string) => `'${text.replace(/'/g, "''")}'`

/** 파일 열기 창 왼쪽 목록에도 나오게 빠른 액세스에 한 번 고정한다. */
async function pinToQuickAccess(dir: string) {
  const ok = await powershell(
    `(New-Object -ComObject Shell.Application).Namespace(${psQuote(dir)}).Self.InvokeVerb('pintohome')`,
  )
  log(`빠른 액세스 고정 ${ok ? '완료' : '실패'}`)
}

async function unpinFromQuickAccess(dir: string) {
  await powershell(
    `(New-Object -ComObject Shell.Application).Namespace(${psQuote(QUICK_ACCESS)}).Items() | ` +
      `Where-Object { $_.Path -eq ${psQuote(dir)} } | ForEach-Object { $_.InvokeVerb('unpinfromhome') }`,
  )
}

/* ------------------------------------------------------------------ 바탕화면 스캔 */

type ScanEntry = {
  path: string
  name: string
  isDirectory: boolean
  ext: string
  size: number
  mtime: number
}

function desktopRoots() {
  const roots = [app.getPath('desktop')]
  if (process.platform === 'win32' && process.env.PUBLIC) {
    roots.push(path.join(process.env.PUBLIC, 'Desktop'))
  }
  return roots
}

/** 폴더 하나의 내용 나열 — 바탕화면 스캔과 포털이 함께 쓴다. */
async function listDir(root: string): Promise<ScanEntry[]> {
  const out: ScanEntry[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return out
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.toLowerCase() === 'desktop.ini') continue
    const full = path.join(root, entry.name)

    let size = 0
    let mtime = 0
    try {
      const stat = await fs.stat(full)
      size = stat.size
      mtime = stat.mtimeMs
    } catch {
      // 끊어진 바로가기 등 — 항목 자체는 살려두고 크기/시각만 비운다.
    }

    out.push({
      path: full,
      name: entry.name,
      isDirectory: entry.isDirectory(),
      ext: entry.isDirectory() ? '' : path.extname(entry.name).slice(1).toLowerCase(),
      size,
      mtime,
    })
  }
  return out
}

async function scanDesktop(): Promise<ScanEntry[]> {
  const out: ScanEntry[] = []
  const seen = new Set<string>()
  for (const root of desktopRoots()) {
    for (const entry of await listDir(root)) {
      const key = entry.path.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(entry)
    }
  }
  return out
}

/* ------------------------------------------------------------------ 폴더 감시 (포털) */

const dirWatchers = new Map<string, { count: number; close: () => void }>()

function watchDir(dir: string) {
  const existing = dirWatchers.get(dir)
  if (existing) {
    existing.count += 1
    return
  }
  let timer: NodeJS.Timeout | null = null
  try {
    const watcher = watch(dir, { persistent: false }, () => {
      // 파일 하나 옮겨도 이벤트가 여러 번 온다 — 묶어서 한 번만 알린다.
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => win?.webContents.send('dir:changed', dir), 250)
    })
    watcher.on('error', (error) => log(`폴더 감시 오류: ${dir}: ${error}`))
    dirWatchers.set(dir, { count: 1, close: () => watcher.close() })
  } catch (error) {
    log(`폴더 감시 실패: ${dir}: ${error}`)
  }
}

function unwatchDir(dir: string) {
  const existing = dirWatchers.get(dir)
  if (!existing) return
  existing.count -= 1
  if (existing.count <= 0) {
    existing.close()
    dirWatchers.delete(dir)
  }
}

/* ------------------------------------------------------------------ 파일 조작 */

/** dir 안에서 겹치지 않는 이름을 찾는다 — 바탕화면과 같은 "이름 (2)" 규칙. */
async function uniqueDest(dir: string, name: string) {
  const ext = path.extname(name)
  const stem = path.basename(name, ext)
  let candidate = path.join(dir, name)
  for (let i = 2; ; i += 1) {
    try {
      await fs.access(candidate)
    } catch {
      return candidate
    }
    candidate = path.join(dir, `${stem} (${i})${ext}`)
  }
}

const norm = (p: string) => path.resolve(p).toLowerCase()

/** src를 destDir 안으로 실제 이동한다. 성공하면 새 경로를 준다. */
async function moveInto(src: string, destDir: string): Promise<{ ok: boolean; newPath?: string; error?: string }> {
  try {
    const srcStat = await fs.stat(src)
    const destStat = await fs.stat(destDir)
    if (!destStat.isDirectory()) return { ok: false, error: '대상이 폴더가 아니에요' }
    if (norm(src) === norm(destDir)) return { ok: false, error: '자기 자신이에요' }
    if (srcStat.isDirectory() && (norm(destDir) + path.sep).startsWith(norm(src) + path.sep)) {
      return { ok: false, error: '자기 자신 안으로는 옮길 수 없어요' }
    }
    if (norm(path.dirname(src)) === norm(destDir)) return { ok: false, error: '이미 그 폴더에 있어요' }

    const target = await uniqueDest(destDir, path.basename(src))
    try {
      await fs.rename(src, target)
    } catch (error) {
      // 다른 드라이브로는 rename이 안 된다 — 복사 후 원본 삭제로 폴백
      if ((error as NodeJS.ErrnoException)?.code === 'EXDEV') {
        await fs.cp(src, target, { recursive: true })
        await fs.rm(src, { recursive: true, force: true })
      } else {
        throw error
      }
    }
    // 필드에 담겨 숨김 속성이 걸린 채 이동하면 폴더 안에서 안 보인다. 반드시 해제.
    if (process.platform === 'win32') {
      try {
        execFileSync('attrib', ['-h', target], { stdio: 'ignore' })
      } catch {
        /* 속성 해제 실패는 치명적이지 않다 */
      }
    }
    log(`이동: ${src} → ${target}`)
    return { ok: true, newPath: target }
  } catch (error) {
    log(`이동 실패: ${src} → ${destDir}: ${error}`)
    return { ok: false, error: '옮기지 못했어요 (사용 중이거나 권한 없음)' }
  }
}

/* ------------------------------------------------------------------ 배경 이미지 */

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/** 파일을 data URL로. 유리 모드가 바탕화면을 흐리게 깔 때 쓴다. */
async function readImageDataUrl(target: string): Promise<string | null> {
  try {
    const buffer = await fs.readFile(target)
    // 확장자가 없는 TranscodedWallpaper는 JPEG다.
    const mime = MIME[path.extname(target).toLowerCase()] ?? 'image/jpeg'
    return `data:${mime};base64,${buffer.toString('base64')}`
  } catch (error) {
    log(`배경 이미지 읽기 실패: ${target}: ${error}`)
    return null
  }
}

/** 현재 바탕화면 그림의 경로 */
async function wallpaperPath(): Promise<string | null> {
  if (process.platform !== 'win32') return null

  const fromRegistry = await new Promise<string | null>((resolve) => {
    execFile('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallPaper'], (error, stdout) => {
      if (error) return resolve(null)
      const match = stdout.match(/WallPaper\s+REG_SZ\s+(.+)/)
      resolve(match ? match[1].trim() : null)
    })
  })
  if (fromRegistry && existsSync(fromRegistry)) return fromRegistry

  // 테마·슬라이드쇼를 쓰면 레지스트리 경로가 비거나 낡아 있다. 실제로 그려지는
  // 그림은 항상 여기에 복사되어 있다.
  const transcoded = path.join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Themes',
    'TranscodedWallpaper',
  )
  return existsSync(transcoded) ? transcoded : null
}

/* ------------------------------------------------------------------ IPC */

function registerIpc() {
  ipcMain.handle('state:load', () => readState())
  ipcMain.handle('state:save', (_e, state: unknown) => writeState(state))

  ipcMain.handle('desktop:scan', () => scanDesktop())
  ipcMain.handle('dir:list', (_e, dir: string) => listDir(dir))
  ipcMain.on('dir:watch', (_e, dir: string) => watchDir(dir))
  ipcMain.on('dir:unwatch', (_e, dir: string) => unwatchDir(dir))

  ipcMain.handle('fs:exists', async (_e, target: string) => {
    try {
      await fs.access(target)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('fs:stat', async (_e, target: string) => {
    try {
      const stat = await fs.stat(target)
      return { isDirectory: stat.isDirectory(), size: stat.size, mtime: stat.mtimeMs }
    } catch {
      return null
    }
  })

  // 바로가기(.lnk)도 경로 그대로 넘긴다 — 셸이 알아서 대상 아이콘을 내주고,
  // 바탕화면에 보이는 모습과 같아진다.
  ipcMain.handle('icon:get', (_e, target: string) => getIcon(target))

  ipcMain.handle('icon:refresh', async () => {
    await clearIconCache()
    return true
  })

  ipcMain.handle('shell:open', async (_e, target: string) => {
    // 휴지통 같은 가상 개체는 파일 경로가 없어 탐색기에 맡긴다.
    if (target.startsWith('shell:')) {
      if (process.platform === 'win32') {
        spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' }).unref()
      }
      return null
    }
    const error = await shell.openPath(target)
    return error || null
  })

  /**
   * 바탕화면 원본 숨기기/보이기 — '이동처럼 보이기'의 실체.
   * 파일을 옮기지 않고 숨김 속성만 걸어서, 무슨 일이 생겨도 파일은 제자리에 있다.
   * 안전장치로 바탕화면 바로 아래 항목에만 적용한다.
   */
  ipcMain.handle('fs:setHidden', async (_e, target: string, hidden: boolean) => {
    if (process.platform !== 'win32' || target.startsWith('shell:')) return false
    const parent = path.dirname(target).toLowerCase()
    if (!desktopRoots().some((root) => root.toLowerCase() === parent)) return false
    return await new Promise<boolean>((resolve) => {
      execFile('attrib', [hidden ? '+h' : '-h', target], (error) => resolve(!error))
    })
  })

  ipcMain.handle('shell:reveal', (_e, target: string) => {
    shell.showItemInFolder(target)
  })

  ipcMain.handle('fs:moveInto', (_e, src: string, destDir: string) => moveInto(src, destDir))

  ipcMain.handle('fs:rename', async (_e, target: string, newName: string) => {
    try {
      const clean = newName.trim()
      if (!clean || /[\\/:*?"<>|]/.test(clean)) return { ok: false, error: '쓸 수 없는 이름이에요' }
      const next = path.join(path.dirname(target), clean)
      if (norm(next) === norm(target)) return { ok: true, newPath: target }
      try {
        await fs.access(next)
        return { ok: false, error: '같은 이름이 이미 있어요' }
      } catch {
        /* 비어 있음 — 진행 */
      }
      await fs.rename(target, next)
      log(`이름 변경: ${target} → ${next}`)
      return { ok: true, newPath: next }
    } catch (error) {
      log(`이름 변경 실패: ${target}: ${error}`)
      return { ok: false, error: '이름을 바꾸지 못했어요 (사용 중일 수 있어요)' }
    }
  })

  ipcMain.handle('fs:trash', async (_e, target: string) => {
    try {
      // 숨김 상태로 휴지통에 들어가면 복원했을 때도 안 보인다. 먼저 해제.
      if (process.platform === 'win32') {
        try {
          execFileSync('attrib', ['-h', target], { stdio: 'ignore' })
        } catch {
          /* 계속 진행 */
        }
      }
      await shell.trashItem(target)
      log(`휴지통으로: ${target}`)
      return { ok: true }
    } catch (error) {
      log(`휴지통 실패: ${target}: ${error}`)
      const parseFail = `${error}`.includes('parse path')
      return {
        ok: false,
        error: parseFail
          ? '이 위치는 휴지통을 지원하지 않아요 (클라우드·네트워크 드라이브)'
          : '휴지통으로 보내지 못했어요 (사용 중일 수 있어요)',
      }
    }
  })

  ipcMain.handle('fs:newFolder', async () => {
    try {
      const target = await uniqueDest(app.getPath('desktop'), '새 폴더')
      await fs.mkdir(target)
      log(`새 폴더: ${target}`)
      return { ok: true, newPath: target }
    } catch (error) {
      return { ok: false, error: `폴더를 만들지 못했어요: ${error}` }
    }
  })

  ipcMain.handle('dialog:pick', async (_e, mode: 'file' | 'folder') => {
    const result = await dialog.showOpenDialog({
      title: mode === 'folder' ? '필드에 넣을 폴더 선택' : '필드에 넣을 파일 선택',
      properties: [mode === 'folder' ? 'openDirectory' : 'openFile', 'multiSelections'],
    })
    return result.canceled ? [] : result.filePaths
  })

  // 통과 여부를 마우스 이벤트가 아니라 좌표로 판정한다.
  // 이벤트 기반은 '통과 상태에서는 이벤트 자체가 안 온다'는 자기모순이 있어서,
  // 바탕화면에서 파일을 끌어오면 창이 드롭 대상이 되지 못해 금지 표시가 떴다.
  ipcMain.on('mouse:capture', (_e, capture: boolean) => {
    rendererCapture = capture
    applyMouseState()
  })

  ipcMain.on('rects:update', (_e, rects: SolidRect[]) => {
    solidRects = Array.isArray(rects) ? rects : []
    applyMouseState()
  })

  // 이름 입력처럼 키보드가 필요한 순간에만 잠깐 포커스를 받는다.
  ipcMain.on('focus:set', (_e, focusable: boolean) => {
    if (!win) return
    win.setFocusable(focusable)
    if (focusable) win.focus()
  })

  ipcMain.handle('fs:setHiddenBatch', (_e, paths: string[], hidden: boolean) => {
    const roots = desktopRoots().map((root) => root.toLowerCase())
    const safe = (Array.isArray(paths) ? paths : []).filter(
      (target) =>
        typeof target === 'string' &&
        !target.startsWith('shell:') &&
        roots.includes(path.dirname(target).toLowerCase()),
    )
    if (hidden) restored = false
    return setHiddenBatchAsync(safe, hidden)
  })

  // 인자를 붙여 등록하면 조회할 때도 같은 인자를 줘야 매칭된다. 애초에
  // 인자가 필요 없으므로 양쪽 다 붙이지 않는다 — 안 그러면 항상 '꺼짐'으로 읽힌다.
  ipcMain.handle('autostart:get', () => getAutostart())

  ipcMain.handle('autostart:set', (_e, enabled: boolean) => setAutostart(enabled))

  ipcMain.handle('links:open', async () => {
    if (!existsSync(LINK_ROOT)) return false
    return (await shell.openPath(LINK_ROOT)) === ''
  })

  ipcMain.handle('app:workarea', () => screen.getPrimaryDisplay().workArea)

  ipcMain.on('watch:foreground', (_e, enabled: boolean) => {
    if (enabled) startForegroundWatch()
    else stopForegroundWatch()
  })

  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('wallpaper:get', async () => {
    const target = await wallpaperPath()
    return target ? readImageDataUrl(target) : null
  })

  ipcMain.handle('image:read', (_e, target: string) => readImageDataUrl(target))

  ipcMain.handle('dialog:pickImage', async () => {
    const result = await dialog.showOpenDialog({
      title: '유리 모드 배경으로 쓸 이미지 선택',
      filters: [{ name: '이미지', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp'] }],
      properties: ['openFile'],
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('update:check', () => checkForUpdate(true))
  ipcMain.handle('update:install', () => installUpdate())
  ipcMain.handle('update:openFolder', () => shell.openPath(path.dirname(app.getPath('exe'))))
  ipcMain.handle('update:openPage', () =>
    shell.openExternal(`https://github.com/${UPDATE_REPO}/releases/latest`),
  )

  ipcMain.on('app:quit', () => {
    quitting = true
    app.quit()
  })
}

/* ------------------------------------------------------------------ 자동 업데이트 */

/**
 * zip 배포용 자체 업데이트. electron-updater는 NSIS 설치판 전용인데
 * 이 앱은 보안 프로그램이 NSIS를 차단하는 환경 때문에 zip으로 배포한다.
 * 릴리스 확인 → zip 내려받기 → 압축 해제 → 앱 종료 후 파일 교체 → 재실행.
 */
const UPDATE_REPO = 'dacisosl/deskfield'
let updateInfo: { version: string; url: string } | null = null
let updating = false

/**
 * 압축 폴더 안에서 바로 실행했는지 판별한다.
 * Windows는 zip 안의 exe를 더블클릭하면 임시 폴더에 몰래 풀어서 실행하는데,
 * 그 폴더는 앱이 꺼지면 사라진다 — 업데이트를 덮어써도 남지 않는다.
 */
function runningFromTemp() {
  if (process.platform !== 'win32') return false
  const dir = path.dirname(app.getPath('exe')).toLowerCase()
  const temp = app.getPath('temp').toLowerCase()
  return dir.startsWith(temp) || /\.zip|\\temp\d*_/.test(dir)
}

/** 설치 폴더에 쓸 수 있는지 (Program Files 등 권한이 없는 곳 확인) */
async function canWriteAppDir() {
  const probe = path.join(path.dirname(app.getPath('exe')), '.deskfield-write-test')
  try {
    await fs.writeFile(probe, 'x')
    await fs.rm(probe, { force: true })
    return true
  } catch {
    return false
  }
}

/** a > b 이면 1 */
function cmpVersion(a: string, b: string) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

async function checkForUpdate(manual = false) {
  // 개발 모드/다른 OS에서는 확인만 건너뛴다 (zip 교체 스크립트가 Windows 전용).
  if (process.platform !== 'win32' || !app.isPackaged) return
  try {
    const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as {
      tag_name?: string
      assets?: { name: string; browser_download_url: string }[]
    }
    const latest = (data.tag_name ?? '').replace(/^v/, '')
    const asset = data.assets?.find((a) => /^DeskField-.*-win\.zip$/i.test(a.name))
    if (!latest || !asset) return

    if (cmpVersion(latest, app.getVersion()) > 0) {
      updateInfo = { version: latest, url: asset.browser_download_url }
      log(`업데이트 발견: v${latest}`)

      if (runningFromTemp()) {
        // 여기서 받아봐야 앱이 꺼지면 사라진다. 받지 말고 사실대로 알린다.
        log(`업데이트 불가: 임시 폴더에서 실행 중 (${path.dirname(app.getPath('exe'))})`)
        win?.webContents.send('update:blocked', {
          version: latest,
          reason: 'temp',
          dir: path.dirname(app.getPath('exe')),
        })
        return
      }

      win?.webContents.send('update:available', latest)
      // 사용자가 뭘 누르길 기다리지 않는다 — 바로 받아둔다.
      void prepareUpdate()
    } else if (manual) {
      win?.webContents.send('update:none', app.getVersion())
    }
  } catch (error) {
    log(`업데이트 확인 실패: ${error}`)
  }
}

/** zip 루트 또는 한 단계 아래에서 실행 파일이 있는 폴더를 찾는다. */
async function findAppDir(extracted: string): Promise<string | null> {
  if (existsSync(path.join(extracted, 'DeskField.exe'))) return extracted
  for (const entry of await fs.readdir(extracted, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(path.join(extracted, entry.name, 'DeskField.exe'))) {
      return path.join(extracted, entry.name)
    }
  }
  return null
}

/**
 * Electron은 fs를 가로채 .asar 파일을 폴더처럼 다룬다. 그래서 스테이징 폴더의
 * app.asar를 지우려는 순간 아카이브를 열어 스스로 잠가버리고, 잠긴 파일은
 * 지울 수 없어 EBUSY로 실패한다 — 업데이트가 계속 실패하던 실제 원인.
 * 업데이트 파일을 만지는 동안은 이 특수 처리를 꺼야 한다.
 */
async function withoutAsar<T>(fn: () => Promise<T>): Promise<T> {
  const proc = process as NodeJS.Process & { noAsar?: boolean }
  const prev = proc.noAsar
  proc.noAsar = true
  try {
    return await fn()
  } finally {
    proc.noAsar = prev ?? false
  }
}

/** 받아서 풀어둔 새 버전 폴더 (설치 준비 완료 상태) */
let staged: { version: string; dir: string; work: string } | null = null

/** 재시작을 미뤘을 때 다음 실행에서 이어받기 위한 표시 */
const PENDING_FILE = path.join(app.getPath('userData'), 'pending-update.json')

function readPending(): { version: string; dir: string; work: string } | null {
  try {
    const data = JSON.parse(readFileSync(PENDING_FILE, 'utf8'))
    return typeof data?.version === 'string' && typeof data?.dir === 'string'
      ? { ...data, work: typeof data?.work === 'string' ? data.work : path.dirname(data.dir) }
      : null
  } catch {
    return null
  }
}

function clearPending() {
  try {
    unlinkSync(PENDING_FILE)
  } catch {
    /* 없으면 그만 */
  }
}

/**
 * 미뤄둔 업데이트가 있으면 창을 띄우기 전에 적용한다.
 * '나중에'를 누른 사용자는 다음에 켤 때 새 버전으로 시작하게 된다.
 */
function applyPendingUpdate(): boolean {
  const pending = readPending()
  if (!pending) return false
  if (cmpVersion(pending.version, app.getVersion()) <= 0 || !existsSync(pending.dir)) {
    // 이미 적용됐거나 임시 폴더가 청소됐다.
    clearPending()
    return false
  }
  staged = pending
  log(`미뤄둔 업데이트 적용: v${pending.version}`)
  return installUpdate()
}

/**
 * 새 버전을 내려받아 압축을 풀어둔다. 여기까지는 실행 중인 앱에 영향이 없다.
 * 실제 교체는 앱을 끄고 나서(installUpdate) 이뤄진다.
 */
async function prepareUpdate(): Promise<boolean> {
  if (!updateInfo || updating || staged?.version === updateInfo.version) return false
  updating = true
  const info = updateInfo
  try {
    if (!(await canWriteAppDir())) {
      const dir = path.dirname(app.getPath('exe'))
      log(`업데이트 불가: 설치 폴더에 쓸 수 없음 (${dir})`)
      win?.webContents.send('update:blocked', { version: info.version, reason: 'readonly', dir })
      return false
    }

    win?.webContents.send('update:progress', { version: info.version, phase: 'download' })

    const workDir = await withoutAsar(async () => {
      let dir = path.join(app.getPath('temp'), 'deskfield-update')
      try {
        await fs.rm(dir, { recursive: true, force: true })
      } catch (error) {
        // 어떤 이유로든 못 지우면 싸우지 말고 새 폴더로 간다.
        log(`이전 스테이징 정리 실패(${error}) — 새 폴더로 우회`)
        dir = path.join(app.getPath('temp'), `deskfield-update-${Date.now()}`)
      }
      await fs.mkdir(dir, { recursive: true })
      return dir
    })

    log(`업데이트 내려받는 중: v${info.version} (${info.url})`)
    const started = Date.now()
    const res = await fetch(info.url)
    if (!res.ok) throw new Error(`다운로드 HTTP ${res.status}`)
    if (!res.body) throw new Error('다운로드 응답이 비어 있습니다')

    // 통째로 메모리에 올리지 않고 흘려 쓴다 (130MB짜리라 차이가 크다).
    const zipPath = path.join(workDir, 'update.zip')
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(zipPath))
    const zipBytes = statSync(zipPath).size
    log(`내려받기 완료: ${(zipBytes / 1048576).toFixed(1)}MB, ${Date.now() - started}ms`)
    if (zipBytes < 1_000_000) throw new Error(`받은 파일이 너무 작습니다 (${zipBytes} bytes)`)

    win?.webContents.send('update:progress', { version: info.version, phase: 'extract' })
    const extracted = path.join(workDir, 'app')
    const unzipStarted = Date.now()
    // asar 특수 처리를 끈 채로 — 안 그러면 app.asar를 쓰고 지우는 데서 꼬인다.
    const appDir = await withoutAsar(async () => {
      await extractZip(zipPath, extracted)
      return findAppDir(extracted)
    })
    log(`압축 해제 완료: ${Date.now() - unzipStarted}ms`)
    if (!appDir) throw new Error('압축 안에서 DeskField.exe를 찾지 못했습니다')

    staged = { version: info.version, dir: appDir, work: workDir }
    try {
      writeFileSync(PENDING_FILE, JSON.stringify(staged), 'utf8')
    } catch (error) {
      log(`업데이트 표시 저장 실패: ${error}`)
    }
    log(`업데이트 준비 완료: v${info.version}`)
    win?.webContents.send('update:ready', info.version)
    return true
  } catch (error) {
    log(`업데이트 준비 실패: ${error}`)
    win?.webContents.send('update:failed', `${error}`)
    return false
  } finally {
    updating = false
  }
}

/**
 * 받아둔 버전으로 교체하고 다시 실행한다. 실행 중인 파일은 덮어쓸 수 없어서
 * 앱을 끈 뒤 스크립트가 교체·재실행을 맡는다.
 */
function installUpdate(): boolean {
  if (!staged) return false
  try {
    const dest = path.dirname(app.getPath('exe'))
    // 스크립트를 스테이징 밖에 둔다 — 마지막 줄에서 스테이징을 스스로 지우기 때문.
    // 이 청소가 빠지면 남은 app.asar가 다음 업데이트의 정리 단계를 계속 실패시킨다.
    const script = path.join(app.getPath('temp'), `deskfield-apply-${Date.now()}.cmd`)
    const swapLog = path.join(app.getPath('userData'), 'update-swap.log')
    writeFileSync(
      script,
      [
        '@echo off',
        'chcp 65001 >nul',
        'ping -n 4 127.0.0.1 >nul',
        `robocopy "${staged.dir}" "${dest}" /E /NFL /NDL /NJH /NJS /R:3 /W:1 >> "${swapLog}" 2>&1`,
        `echo robocopy exit=%errorlevel% >> "${swapLog}"`,
        // 교체가 실패해도 앱은 반드시 다시 띄운다 — 실패했다고 앱이 사라지면 안 된다.
        `start "" "${path.join(dest, 'DeskField.exe')}"`,
        `rmdir /s /q "${staged.work}"`,
        `del "%~f0"`,
      ].join('\r\n'),
      'utf8',
    )
    log(`업데이트 설치: v${staged.version} → ${dest}`)
    clearPending()
    spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    quitting = true
    unhideAllSync('업데이트 재시작')
    app.quit()
    return true
  } catch (error) {
    log(`업데이트 설치 실패: ${error}`)
    win?.webContents.send('update:failed', `${error}`)
    return false
  }
}

/* ------------------------------------------------------------------ 마우스 통과 판정 */

type SolidRect = { x: number; y: number; w: number; h: number }

let solidRects: SolidRect[] = []
let rendererCapture = false
let ignoreNow = true

function cursorInSolid() {
  if (!win) return false
  const bounds = win.getBounds()
  const point = screen.getCursorScreenPoint()
  const x = point.x - bounds.x
  const y = point.y - bounds.y
  return solidRects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)
}

function applyMouseState() {
  if (!win || win.isDestroyed()) return
  const ignore = !rendererCapture && !cursorInSolid()
  if (ignore === ignoreNow) return
  ignoreNow = ignore
  win.setIgnoreMouseEvents(ignore, { forward: true })
}

/* ------------------------------------------------------------------ 포그라운드 감시 */

/**
 * 지금 맨 앞에 있는 창이 바탕화면인지(=우리 필드를 봐야 하는 상황인지) 알려준다.
 * Electron에는 다른 앱의 포커스를 알 방법이 없어서 PowerShell을 하나 띄워 감시한다.
 * 기능을 켠 동안에만 돌고, 0.7초마다 한 번 확인하며 바뀔 때만 한 줄 뱉는다.
 */
let watcher: ReturnType<typeof spawn> | null = null
let desktopActive = true

const DESKTOP_CLASSES = new Set(['Progman', 'WorkerW'])

const WATCH_SCRIPT = `$ErrorActionPreference='SilentlyContinue'
Add-Type -Namespace DF -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint id);
[DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder s, int max);
public delegate bool EnumProc(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc fn, IntPtr l);
public static bool HasShellView(IntPtr top) {
  bool found = false;
  EnumChildWindows(top, delegate(IntPtr h, IntPtr l) {
    var sb = new System.Text.StringBuilder(64);
    GetClassName(h, sb, 64);
    if (sb.ToString() == "SHELLDLL_DefView") { found = true; return false; }
    return true;
  }, IntPtr.Zero);
  return found;
}
'@
$shell = New-Object -ComObject Shell.Application
$desks = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'))
$last = ''
while ($true) {
  $h = [DF.Win]::GetForegroundWindow()
  $owner = 0
  [void][DF.Win]::GetWindowThreadProcessId($h, [ref]$owner)
  $sb = New-Object System.Text.StringBuilder 256
  [void][DF.Win]::GetClassName($h, $sb, 256)
  $cls = $sb.ToString()
  # 파일 열기·저장 창(폴더 보기가 든 대화상자)이거나 바탕화면 폴더를 연 탐색기면 1
  $files = 0
  if ($cls -eq '#32770') {
    if ([DF.Win]::HasShellView($h)) { $files = 1 }
  } elseif ($cls -eq 'CabinetWClass') {
    foreach ($w in @($shell.Windows())) {
      if ($w.HWND -eq $h.ToInt64() -and $desks -contains $w.Document.Folder.Self.Path) { $files = 1; break }
    }
  }
  $line = "$owner|$cls|$files"
  if ($line -ne $last) { $last = $line; Write-Output $line }
  Start-Sleep -Milliseconds 700
}`

function startForegroundWatch() {
  if (watcher || process.platform !== 'win32') return
  try {
    // 스크립트 파일(-File)은 실행 정책(윈도우 기본값 Restricted)에 막혀 바로 죽는다.
    // 명령을 직접 넘기는 방식은 실행 정책의 대상이 아니다.
    const encoded = Buffer.from(WATCH_SCRIPT, 'utf16le').toString('base64')
    watcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
    watcher.stdout?.setEncoding('utf8')
    watcher.stdout?.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.trim()) continue
        const [owner, cls, files] = line.trim().split('|')
        setFilesOpen(files === '1')
        // 우리 창이거나 바탕화면이면 '보는 중', 그 밖의 앱이면 '다른 일 하는 중'.
        const active = Number(owner) === process.pid || DESKTOP_CLASSES.has(cls)
        if (active === desktopActive) continue
        desktopActive = active
        win?.webContents.send('desktop:active', active)
      }
    })
    const self = watcher
    watcher.on('exit', (code) => {
      // 일부러 멈춘 게 아니면 남긴다 — 예전에는 실행 정책에 막혀 조용히 죽어도 알 길이 없었다.
      if (watcher === self) {
        watcher = null
        log(`포그라운드 감시가 멈춤 (code ${code})`)
      }
    })
    log('포그라운드 감시 시작')
  } catch (error) {
    log(`포그라운드 감시 실패: ${error}`)
    watcher = null
  }
}

function stopForegroundWatch() {
  if (!watcher) return
  try {
    watcher.kill()
  } catch {
    /* 이미 죽었으면 그만 */
  }
  watcher = null
  desktopActive = true
  win?.webContents.send('desktop:active', true)
  rehideOriginals()
  log('포그라운드 감시 중지')
}

/* ------------------------------------------------------------------ 파일 창에서 원본 보이기 */

/**
 * 숨김 속성은 바탕화면과 파일 열기 창이 똑같이 따른다 — 둘 다 같은 바탕화면 폴더를
 * 보여주기 때문이다. 그래서 파일 열기·저장 창(또는 바탕화면 폴더를 연 탐색기)이 앞에
 * 있는 동안만 원본을 잠깐 보이게 하고, 창이 닫히면 다시 숨긴다. 업로드·첨부할 때
 * 바탕화면에서 그대로 고를 수 있다.
 */
let revealed = false
let revealTimer: ReturnType<typeof setTimeout> | null = null
/** 보이기·숨기기가 뒤섞여 끝나지 않게 한 줄로 세운다. */
let revealQueue: Promise<unknown> = Promise.resolve()

function setFilesOpen(open: boolean) {
  if (quitting) return
  if (revealTimer) {
    clearTimeout(revealTimer)
    revealTimer = null
  }
  if (!open) {
    // 파일 창 위에 '바꿀까요?' 같은 작은 창이 잠깐 떠도 깜빡이지 않게 조금 기다린다.
    if (revealed) revealTimer = setTimeout(rehideOriginals, 1500)
    return
  }
  if (revealed) return
  const state = readStateSync()
  if (state?.settings?.hideOriginals === false || state?.settings?.revealInDialogs === false) return
  const targets = hiddenCandidates(state)
  if (targets.length === 0) return
  revealed = true
  revealQueue = revealQueue.then(() => setHiddenBatchAsync(targets, false))
  log(`파일 창 — 숨긴 원본 ${targets.length}개를 잠시 보임`)
}

function rehideOriginals() {
  if (revealTimer) {
    clearTimeout(revealTimer)
    revealTimer = null
  }
  // 종료 중이면 숨기지 않는다 — 종료 정리가 전부 되살린 뒤에 다시 숨겨 버린다.
  if (!revealed || quitting) return
  revealed = false
  const state = readStateSync()
  if (state?.settings?.hideOriginals === false) return
  const targets = hiddenCandidates(state)
  if (targets.length === 0) return
  restored = false
  revealQueue = revealQueue.then(() => setHiddenBatchAsync(targets, true))
  log(`파일 창 닫힘 — 원본 ${targets.length}개 다시 숨김`)
}

/* ------------------------------------------------------------------ 트레이 */

function trayImage() {
  const file = path.join(dirname, '../../build/icon.png')
  const image = nativeImage.createFromPath(file)
  return image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 })
}

function buildTray() {
  tray = new Tray(trayImage())
  tray.setToolTip('바탕 필드')

  const menu = Menu.buildFromTemplate([
    { label: '필드 보이기/숨기기  (Ctrl+Alt+H)', click: toggleVisible },
    { type: 'separator' },
    { label: '새 필드 만들기', click: () => win?.webContents.send('cmd:new-field') },
    { label: '바탕화면 자동 정리…', click: () => win?.webContents.send('cmd:scan') },
    { label: '도구 막대 보이기/숨기기', click: () => win?.webContents.send('cmd:toggle-bar') },
    { label: '업데이트 확인', click: () => void checkForUpdate(true) },
    { label: '숨긴 원본 모두 보이기', click: () => win?.webContents.send('cmd:unhide-all') },
    { label: '설정 열기', click: () => win?.webContents.send('cmd:settings') },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        quitting = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(menu)
  tray.on('click', toggleVisible)
}

function toggleVisible() {
  if (!win) return createWindow()
  if (win.isVisible()) win.hide()
  else win.showInactive()
}

/* ------------------------------------------------------------------ 자동 시작 */

/**
 * 시작 프로그램(Run 레지스트리)은 윈도우가 로그인 후 일부러 늦게, 다른 앱들과
 * 한꺼번에 띄운다. 그동안 바탕화면에는 숨겨야 할 아이콘이 다 보인다.
 * 작업 스케줄러의 '로그온 시' 작업은 그 지연 없이 바로 실행되므로 이걸 먼저 쓰고,
 * 등록이 막힌 컴퓨터에서만 시작 프로그램으로 물러난다.
 */
const TASK_NAME = 'DeskField Autostart'

/** 포터블 실행 파일은 임시 폴더로 풀려서 돌아간다 — 원래 exe 경로를 등록해야 한다. */
function launcherPath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe')
}

function run(command: string, args: string[]) {
  return new Promise<boolean>((resolve) => {
    execFile(command, args, { windowsHide: true }, (error) => resolve(!error))
  })
}

const hasStartupTask = () => run('schtasks', ['/query', '/tn', TASK_NAME])

/** 마지막으로 작업에 등록한 실행 파일 경로 — 그대로면 켤 때마다 다시 등록하지 않는다. */
const TASK_STAMP = path.join(app.getPath('userData'), 'autostart-task.txt')

function xmlEscape(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function registerStartupTask() {
  const user = xmlEscape(
    process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : `${process.env.USERNAME}`,
  )
  // 배터리 조건·실행 시간 제한(기본 72시간)·낮은 우선순위(기본 7)는 상주 앱에 맞지 않아 전부 푼다.
  const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>바탕 필드 — 로그인하자마자 바로 실행</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${user}</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>${user}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>4</Priority>
  </Settings>
  <Actions Context="Author"><Exec><Command>${xmlEscape(launcherPath())}</Command></Exec></Actions>
</Task>
`
  const file = path.join(app.getPath('temp'), `deskfield-task-${process.pid}.xml`)
  try {
    // schtasks는 UTF-16 XML만 제대로 읽는다.
    await fs.writeFile(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]))
    const ok = await run('schtasks', ['/create', '/tn', TASK_NAME, '/xml', file, '/f'])
    if (ok) await fs.writeFile(TASK_STAMP, launcherPath(), 'utf8')
    else log('작업 스케줄러 등록 실패')
    return ok
  } catch (error) {
    log(`작업 스케줄러 등록 실패: ${error}`)
    return false
  } finally {
    await fs.rm(file, { force: true }).catch(() => {})
  }
}

async function getAutostart() {
  if (process.platform !== 'win32') return app.getLoginItemSettings().openAtLogin
  return (await hasStartupTask()) || app.getLoginItemSettings().openAtLogin
}

async function setAutostart(enabled: boolean) {
  if (process.platform !== 'win32') {
    app.setLoginItemSettings({ openAtLogin: enabled })
    return app.getLoginItemSettings().openAtLogin
  }
  if (enabled) {
    const viaTask = await registerStartupTask()
    // 작업이 잡히면 늦게 뜨는 시작 프로그램 등록은 지운다 — 두 번 뜰 이유가 없다.
    app.setLoginItemSettings({ openAtLogin: !viaTask })
    log(`자동 시작 켬 (${viaTask ? '작업 스케줄러' : '시작 프로그램'})`)
  } else {
    if ((await hasStartupTask()) && !(await run('schtasks', ['/delete', '/tn', TASK_NAME, '/f']))) {
      log('작업 스케줄러 삭제 실패')
    }
    await fs.rm(TASK_STAMP, { force: true }).catch(() => {})
    app.setLoginItemSettings({ openAtLogin: false })
    log('자동 시작 끔')
  }
  return getAutostart()
}

/**
 * 예전 버전은 시작 프로그램으로만 등록했다 — 켜 둔 사용자는 더 빨리 뜨는 작업으로 옮긴다.
 * 실행 파일 위치가 바뀌었으면(압축을 다른 곳에 다시 푼 경우 등) 작업의 경로도 새로 맞춘다.
 */
async function refreshAutostart() {
  const legacy = app.getLoginItemSettings().openAtLogin
  const task = await hasStartupTask()
  if (!legacy && !task) return
  const stamp = await fs.readFile(TASK_STAMP, 'utf8').catch(() => '')
  if (task && !legacy && stamp === launcherPath()) return
  await setAutostart(true)
}

/* ------------------------------------------------------------------ 수명 주기 */

app.whenReady().then(() => {
  app.setAppUserModelId('com.dacisosl.deskfield')

  // 이 앱은 켜져 있어야 필드가 보이고 숨긴 원본도 관리된다.
  // 그래서 첫 실행에는 자동 시작을 기본으로 켠다 (설정에서 끌 수 있다).
  // 개발 실행(electron.exe)은 등록하지 않는다 — 로그인할 때마다 빈 Electron이 뜬다.
  if (process.platform === 'win32' && app.isPackaged) {
    if (!existsSync(STATE_FILE)) {
      void setAutostart(true).then(
        () => log('첫 실행 — 자동 시작 켬'),
        (error) => log(`자동 시작 설정 실패: ${error}`),
      )
    } else {
      // 시작 직후의 바쁜 순간은 피한다.
      setTimeout(() => void refreshAutostart().catch((error) => log(`자동 시작 점검 실패: ${error}`)), 5000)
    }
  }

  // 예전 버전이 남긴 스테이징 잔재를 치운다 — 이게 남아 있으면
  // 업데이트 정리 단계가 EBUSY로 계속 실패한다 (기존 사용자 구제).
  void withoutAsar(async () => {
    const temp = app.getPath('temp')
    for (const entry of await fs.readdir(temp).catch(() => [] as string[])) {
      if (!entry.startsWith('deskfield-update')) continue
      const target = path.join(temp, entry)
      // 방금 미뤄둔 업데이트의 스테이징은 남겨야 한다
      if (readPending()?.work === target) continue
      await fs.rm(target, { recursive: true, force: true }).then(
        () => log(`스테이징 잔재 정리: ${target}`),
        (error) => log(`스테이징 잔재 정리 실패: ${target}: ${error}`),
      )
    }
  })

  // 미뤄둔 업데이트가 있으면 창을 만들기 전에 적용하고 재시작한다.
  if (applyPendingUpdate()) return

  registerIpc()
  log('IPC 등록 완료')

  createWindow()
  log('창 생성 완료')

  // 트레이는 아이콘 로드 실패로 예외를 던질 수 있다. 여기서 죽으면 단축키가 안 걸린다.
  try {
    buildTray()
    log('트레이 등록 완료')
  } catch (error) {
    log(`트레이 등록 실패: ${error}`)
  }

  globalShortcut.register('Control+Alt+H', toggleVisible)

  // 드래그 중에는 mousemove가 오지 않아도 커서는 움직인다 — 주기적으로 판정.
  setInterval(applyMouseState, 90)

  setTimeout(() => void checkForUpdate(), 8000)
  setInterval(() => void checkForUpdate(), 6 * 60 * 60 * 1000)

  screen.on('display-metrics-changed', scheduleWorkAreaSync)
  screen.on('display-added', scheduleWorkAreaSync)
  screen.on('display-removed', scheduleWorkAreaSync)
})

app.on('window-all-closed', () => {
  // 트레이에 남는 앱이라 창이 닫혀도 종료하지 않는다.
})

/**
 * 숨김 속성을 한 번에 바꾼다. 파일마다 attrib를 띄우면 수십 번의 프로세스
 * 생성이 되어 종료 제한 시간(수 초) 안에 못 끝낼 수 있다. PowerShell 한 번으로
 * 처리하고, 경로는 파일로 넘겨 인용부호·특수문자 문제를 피한다.
 */
function setHiddenBatchSync(paths: string[], hidden: boolean) {
  if (process.platform !== 'win32' || paths.length === 0) return 0
  const listFile = path.join(app.getPath('temp'), `deskfield-attrib-${process.pid}.txt`)
  try {
    writeFileSync(listFile, paths.join('\n'), 'utf8')
    const op = hidden
      ? '$i.Attributes = $i.Attributes -bor [IO.FileAttributes]::Hidden'
      : '$i.Attributes = $i.Attributes -band -bnot [IO.FileAttributes]::Hidden'
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$ErrorActionPreference='SilentlyContinue';` +
          `Get-Content -LiteralPath '${listFile}' -Encoding UTF8 | ForEach-Object {` +
          `if ($_ -ne '') { $i = Get-Item -LiteralPath $_ -Force; if ($i) { ${op} } } }`,
      ],
      { stdio: 'ignore', windowsHide: true, timeout: 8000 },
    )
    return paths.length
  } catch (error) {
    log(`숨김 일괄 처리 실패(${hidden ? '숨김' : '복원'}): ${error}`)
    return 0
  } finally {
    try {
      unlinkSync(listFile)
    } catch {
      /* 임시 파일 정리 실패는 무시 */
    }
  }
}

/**
 * 상호작용 중 숨김/복원 — 절대 메인을 막지 않는다.
 * 소량은 attrib를 병렬로(시작이 빠르다), 대량은 PowerShell 한 번을 비동기로.
 * 동기 버전(setHiddenBatchSync)은 종료 직전 전용이다.
 */
async function setHiddenBatchAsync(paths: string[], hidden: boolean): Promise<number> {
  if (process.platform !== 'win32' || paths.length === 0) return 0
  if (paths.length <= 8) {
    await Promise.all(
      paths.map(
        (target) =>
          new Promise<void>((resolve) => {
            execFile('attrib', [hidden ? '+h' : '-h', target], { windowsHide: true }, () =>
              resolve(),
            )
          }),
      ),
    )
    return paths.length
  }
  return new Promise<number>((resolve) => {
    const listFile = path.join(app.getPath('temp'), `deskfield-attrib-${Date.now()}.txt`)
    try {
      writeFileSync(listFile, paths.join('\n'), 'utf8')
    } catch {
      resolve(0)
      return
    }
    const op = hidden
      ? '$i.Attributes = $i.Attributes -bor [IO.FileAttributes]::Hidden'
      : '$i.Attributes = $i.Attributes -band -bnot [IO.FileAttributes]::Hidden'
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$ErrorActionPreference='SilentlyContinue';` +
          `Get-Content -LiteralPath '${listFile}' -Encoding UTF8 | ForEach-Object {` +
          `if ($_ -ne '') { $i = Get-Item -LiteralPath $_ -Force; if ($i) { ${op} } } }`,
      ],
      { windowsHide: true, timeout: 15000 },
      () => {
        try {
          unlinkSync(listFile)
        } catch {
          /* 정리 실패는 무시 */
        }
        resolve(paths.length)
      },
    )
  })
}

type SavedState = {
  settings?: { hideOriginals?: boolean; revealInDialogs?: boolean }
  fields?: { portal?: string; items?: { path?: string }[] }[]
}

function readStateSync(): SavedState | null {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as SavedState
  } catch {
    return null
  }
}

/** 상태 파일에 담긴, 바탕화면 바로 아래의 실제 경로들 */
function hiddenCandidates(raw: SavedState | null = readStateSync()): string[] {
  const roots = desktopRoots().map((root) => root.toLowerCase())
  const out: string[] = []
  for (const field of raw?.fields ?? []) {
    // 포털 필드는 폴더를 비추기만 할 뿐 숨기지 않는다
    if (field?.portal) continue
    for (const item of field?.items ?? []) {
      const target = item?.path
      if (typeof target !== 'string' || target.startsWith('shell:')) continue
      if (!roots.includes(path.dirname(target).toLowerCase())) continue
      out.push(target)
    }
  }
  return out
}

/**
 * 종료할 때 숨겨둔 바탕화면 원본을 전부 되살린다.
 * 숨김은 '앱이 켜져 있는 동안'만 유지되는 상태다 — 앱이 없으면 바탕화면은
 * 원래 모습이어야 하고, 다시 켜면 마지막 배치 기준으로 다시 숨긴다.
 * 동기로 처리하는 이유: 종료 직전이라 비동기 작업은 완료를 보장 못 한다.
 */
let restored = false

function unhideAllSync(reason: string) {
  if (process.platform !== 'win32' || restored) return
  restored = true
  const targets = hiddenCandidates()
  const count = setHiddenBatchSync(targets, false)
  log(`${reason}: 숨겨둔 원본 ${count}/${targets.length}개 다시 표시`)
}

app.on('before-quit', () => {
  quitting = true
  unhideAllSync('종료')
})


app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopForegroundWatch()
})
