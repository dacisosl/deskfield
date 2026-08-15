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
import { appendFileSync, mkdirSync, promises as fs } from 'node:fs'
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

async function scanDesktop(): Promise<ScanEntry[]> {
  const out: ScanEntry[] = []
  const seen = new Set<string>()

  for (const root of desktopRoots()) {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(root, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.toLowerCase() === 'desktop.ini') continue
      const full = path.join(root, entry.name)
      const key = full.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)

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
  }

  return out
}

/* ------------------------------------------------------------------ IPC */

function registerIpc() {
  ipcMain.handle('state:load', () => readState())
  ipcMain.handle('state:save', (_e, state: unknown) => writeState(state))

  ipcMain.handle('desktop:scan', () => scanDesktop())

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
      const image = await app.getFileIcon(target, { size: 'large' })
      const url = image.toDataURL()
      iconCache.set(target, url)
      return url
    } catch {
      return null
    }
  })

  ipcMain.handle('shell:open', async (_e, target: string) => {
    const error = await shell.openPath(target)
    return error || null
  })

  ipcMain.handle('shell:reveal', (_e, target: string) => {
    shell.showItemInFolder(target)
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

  ipcMain.on('app:quit', () => {
    quitting = true
    app.quit()
  })
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

  screen.on('display-metrics-changed', syncWorkArea)
  screen.on('display-added', syncWorkArea)
  screen.on('display-removed', syncWorkArea)
})

app.on('window-all-closed', () => {
  // 트레이에 남는 앱이라 창이 닫혀도 종료하지 않는다.
})

app.on('before-quit', () => {
  quitting = true
})

app.on('will-quit', () => globalShortcut.unregisterAll())
