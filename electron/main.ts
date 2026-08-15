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
import { appendFileSync, existsSync, mkdirSync, readFileSync, watch, promises as fs } from 'node:fs'
import path from 'node:path'

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

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

/** 아이콘은 경로+수정시각 기준으로만 다시 뽑는다. 바탕화면 항목이 많으면 추출 비용이 커서. */
const iconCache = new Map<string, string>()

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
    if (!quitting) {
      e.preventDefault()
      win?.hide()
    }
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

  // 어떤 이벤트도 오지 않는 경우를 대비한 마지막 방어선.
  setTimeout(() => {
    if (!win?.isVisible()) {
      log('이벤트가 오지 않아 강제로 창을 띄운다')
      reveal()
    }
  }, 5000)
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

  ipcMain.handle('icon:get', async (_e, target: string) => {
    const cached = iconCache.get(target)
    if (cached) return cached
    try {
      // 바로가기는 자기 자신이 아니라 가리키는 대상의 아이콘을 써야 자연스럽다.
      let source = target
      if (process.platform === 'win32' && target.toLowerCase().endsWith('.lnk')) {
        try {
          const link = shell.readShortcutLink(target)
          if (link.target) source = link.target
        } catch {
          // 해석 못 하면 원본으로
        }
      }
      const image = await app.getFileIcon(source, { size: 'large' })
      const url = image.toDataURL()
      iconCache.set(target, url)
      return url
    } catch {
      return null
    }
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
      return { ok: false, error: '휴지통으로 보내지 못했어요' }
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

  ipcMain.on('mouse:ignore', (_e, ignore: boolean) => {
    win?.setIgnoreMouseEvents(ignore, { forward: true })
  })

  // 이름 입력처럼 키보드가 필요한 순간에만 잠깐 포커스를 받는다.
  ipcMain.on('focus:set', (_e, focusable: boolean) => {
    if (!win) return
    win.setFocusable(focusable)
    if (focusable) win.focus()
  })

  ipcMain.handle('autostart:get', () => app.getLoginItemSettings().openAtLogin)

  ipcMain.handle('autostart:set', (_e, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
    return app.getLoginItemSettings().openAtLogin
  })

  ipcMain.handle('app:workarea', () => screen.getPrimaryDisplay().workArea)

  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('update:check', () => checkForUpdate(true))
  ipcMain.handle('update:apply', () => applyUpdate())

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
      win?.webContents.send('update:available', latest)
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

async function applyUpdate(): Promise<boolean> {
  if (!updateInfo || updating) return false
  updating = true
  try {
    const workDir = path.join(app.getPath('temp'), 'deskfield-update')
    await fs.rm(workDir, { recursive: true, force: true })
    await fs.mkdir(workDir, { recursive: true })

    log(`업데이트 내려받는 중: v${updateInfo.version}`)
    const res = await fetch(updateInfo.url)
    if (!res.ok) throw new Error(`다운로드 HTTP ${res.status}`)
    const zipPath = path.join(workDir, 'update.zip')
    await fs.writeFile(zipPath, Buffer.from(await res.arrayBuffer()))

    const extracted = path.join(workDir, 'app')
    await new Promise<void>((resolve, reject) => {
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extracted}' -Force`,
        ],
        (error) => (error ? reject(error) : resolve()),
      )
    })

    const appDir = await findAppDir(extracted)
    if (!appDir) throw new Error('압축 안에서 DeskField.exe를 찾지 못했다')

    // 실행 중인 파일은 덮어쓸 수 없으니, 앱을 끄고 나서 스크립트가 교체·재실행한다.
    const dest = path.dirname(app.getPath('exe'))
    const script = path.join(workDir, 'apply.cmd')
    await fs.writeFile(
      script,
      [
        '@echo off',
        'chcp 65001 >nul',
        'ping -n 4 127.0.0.1 >nul',
        `robocopy "${appDir}" "${dest}" /E /NFL /NDL /NJH /NJS /R:3 /W:1`,
        `start "" "${path.join(dest, 'DeskField.exe')}"`,
      ].join('\r\n'),
      'utf8',
    )
    log(`업데이트 적용: ${dest} 교체 후 재시작`)
    spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    quitting = true
    app.quit()
    return true
  } catch (error) {
    log(`업데이트 적용 실패: ${error}`)
    updating = false
    // 자동 적용이 막힌 환경이면 릴리스 페이지라도 열어준다.
    void shell.openExternal(`https://github.com/${UPDATE_REPO}/releases/latest`)
    return false
  }
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
    { label: '편집 모드 켜기/끄기  (Ctrl+Alt+D)', click: () => win?.webContents.send('cmd:toggle-edit') },
    { label: '필드 보이기/숨기기  (Ctrl+Alt+H)', click: toggleVisible },
    { type: 'separator' },
    { label: '새 필드 만들기', click: () => win?.webContents.send('cmd:new-field') },
    { label: '바탕화면 자동 정리…', click: () => win?.webContents.send('cmd:scan') },
    { label: '도구 막대 보이기/숨기기', click: () => win?.webContents.send('cmd:toggle-bar') },
    { label: '업데이트 확인', click: () => void checkForUpdate(true) },
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
  tray.on('click', () => win?.webContents.send('cmd:toggle-edit'))
}

function toggleVisible() {
  if (!win) return createWindow()
  if (win.isVisible()) win.hide()
  else win.showInactive()
}

/* ------------------------------------------------------------------ 수명 주기 */

app.whenReady().then(() => {
  app.setAppUserModelId('com.dacisosl.deskfield')

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

  globalShortcut.register('Control+Alt+D', () => win?.webContents.send('cmd:toggle-edit'))
  globalShortcut.register('Control+Alt+H', toggleVisible)

  setTimeout(() => void checkForUpdate(), 8000)
  setInterval(() => void checkForUpdate(), 6 * 60 * 60 * 1000)

  screen.on('display-metrics-changed', syncWorkArea)
  screen.on('display-added', syncWorkArea)
  screen.on('display-removed', syncWorkArea)
})

app.on('window-all-closed', () => {
  // 트레이에 남는 앱이라 창이 닫혀도 종료하지 않는다.
})

/**
 * 종료할 때 숨겨둔 바탕화면 원본을 전부 되살린다.
 * 숨김은 '앱이 켜져 있는 동안'만 유지되는 상태다 — 앱이 없으면 바탕화면은
 * 원래 모습이어야 하고, 다시 켜면 마지막 배치 기준으로 다시 숨긴다.
 * 동기로 처리하는 이유: 종료 직전이라 비동기 작업은 완료를 보장 못 한다.
 */
function unhideAllSync() {
  if (process.platform !== 'win32') return
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as {
      fields?: { items?: { path?: string }[] }[]
    }
    const roots = desktopRoots().map((root) => root.toLowerCase())
    let count = 0
    for (const field of raw?.fields ?? []) {
      for (const item of field?.items ?? []) {
        const target = item?.path
        if (typeof target !== 'string' || target.startsWith('shell:')) continue
        if (!roots.includes(path.dirname(target).toLowerCase())) continue
        try {
          execFileSync('attrib', ['-h', target], { stdio: 'ignore' })
          count += 1
        } catch {
          // 이미 지워진 파일 등 — 다음 항목으로
        }
      }
    }
    log(`종료: 숨겨둔 원본 ${count}개 다시 표시`)
  } catch {
    // 상태 파일이 없으면 되살릴 것도 없다
  }
}

app.on('before-quit', () => {
  quitting = true
  unhideAllSync()
})

app.on('will-quit', () => globalShortcut.unregisterAll())
