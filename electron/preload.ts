import { contextBridge, ipcRenderer, webUtils } from 'electron'

export type ScanEntry = {
  path: string
  name: string
  isDirectory: boolean
  ext: string
  size: number
  mtime: number
}

export type Rect = { x: number; y: number; width: number; height: number }

const commands = [
  'cmd:toggle-edit',
  'cmd:new-field',
  'cmd:scan',
  'cmd:settings',
  'cmd:toggle-bar',
  'cmd:unhide-all',
] as const

export type Command = (typeof commands)[number]

const api = {
  loadState: () => ipcRenderer.invoke('state:load') as Promise<unknown | null>,
  saveState: (state: unknown) => ipcRenderer.invoke('state:save', state) as Promise<void>,

  scanDesktop: () => ipcRenderer.invoke('desktop:scan') as Promise<ScanEntry[]>,
  listDir: (dir: string) => ipcRenderer.invoke('dir:list', dir) as Promise<ScanEntry[]>,
  watchDir: (dir: string) => ipcRenderer.send('dir:watch', dir),
  unwatchDir: (dir: string) => ipcRenderer.send('dir:unwatch', dir),
  onDirChanged: (handler: (dir: string) => void) => {
    const listener = (_e: unknown, dir: string) => handler(dir)
    ipcRenderer.on('dir:changed', listener)
    return () => {
      ipcRenderer.off('dir:changed', listener)
    }
  },
  exists: (target: string) => ipcRenderer.invoke('fs:exists', target) as Promise<boolean>,
  stat: (target: string) =>
    ipcRenderer.invoke('fs:stat', target) as Promise<{
      isDirectory: boolean
      size: number
      mtime: number
    } | null>,
  getIcon: (target: string) => ipcRenderer.invoke('icon:get', target) as Promise<string | null>,

  open: (target: string) => ipcRenderer.invoke('shell:open', target) as Promise<string | null>,
  setHidden: (target: string, hidden: boolean) =>
    ipcRenderer.invoke('fs:setHidden', target, hidden) as Promise<boolean>,
  setHiddenBatch: (paths: string[], hidden: boolean) =>
    ipcRenderer.invoke('fs:setHiddenBatch', paths, hidden) as Promise<number>,

  moveInto: (src: string, destDir: string) =>
    ipcRenderer.invoke('fs:moveInto', src, destDir) as Promise<{
      ok: boolean
      newPath?: string
      error?: string
    }>,
  renameItem: (target: string, newName: string) =>
    ipcRenderer.invoke('fs:rename', target, newName) as Promise<{
      ok: boolean
      newPath?: string
      error?: string
    }>,
  trashItem: (target: string) =>
    ipcRenderer.invoke('fs:trash', target) as Promise<{ ok: boolean; error?: string }>,
  newFolder: () =>
    ipcRenderer.invoke('fs:newFolder') as Promise<{ ok: boolean; newPath?: string; error?: string }>,
  reveal: (target: string) => ipcRenderer.invoke('shell:reveal', target) as Promise<void>,
  pick: (mode: 'file' | 'folder') => ipcRenderer.invoke('dialog:pick', mode) as Promise<string[]>,

  // 드래그로 들어온 File 객체에서 실제 경로를 얻는 유일한 통로 (Electron 32+).
  pathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },

  setIgnoreMouse: (ignore: boolean) => ipcRenderer.send('mouse:ignore', ignore),
  setFocusable: (focusable: boolean) => ipcRenderer.send('focus:set', focusable),

  getAutostart: () => ipcRenderer.invoke('autostart:get') as Promise<boolean>,
  setAutostart: (enabled: boolean) => ipcRenderer.invoke('autostart:set', enabled) as Promise<boolean>,

  getWorkArea: () => ipcRenderer.invoke('app:workarea') as Promise<Rect>,
  getVersion: () => ipcRenderer.invoke('app:version') as Promise<string>,

  getWallpaper: () => ipcRenderer.invoke('wallpaper:get') as Promise<string | null>,
  readImage: (target: string) => ipcRenderer.invoke('image:read', target) as Promise<string | null>,
  pickImage: () => ipcRenderer.invoke('dialog:pickImage') as Promise<string | null>,
  quit: () => ipcRenderer.send('app:quit'),

  checkUpdate: () => ipcRenderer.invoke('update:check') as Promise<void>,
  installUpdate: () => ipcRenderer.invoke('update:install') as Promise<boolean>,
  openReleasePage: () => ipcRenderer.invoke('update:openPage') as Promise<void>,
  onUpdateAvailable: (handler: (version: string) => void) => {
    const listener = (_e: unknown, version: string) => handler(version)
    ipcRenderer.on('update:available', listener)
    return () => {
      ipcRenderer.off('update:available', listener)
    }
  },
  onUpdateNone: (handler: (version: string) => void) => {
    const listener = (_e: unknown, version: string) => handler(version)
    ipcRenderer.on('update:none', listener)
    return () => {
      ipcRenderer.off('update:none', listener)
    }
  },
  onUpdateProgress: (handler: (info: { version: string; phase: 'download' | 'extract' }) => void) => {
    const listener = (_e: unknown, info: { version: string; phase: 'download' | 'extract' }) =>
      handler(info)
    ipcRenderer.on('update:progress', listener)
    return () => {
      ipcRenderer.off('update:progress', listener)
    }
  },
  onUpdateReady: (handler: (version: string) => void) => {
    const listener = (_e: unknown, version: string) => handler(version)
    ipcRenderer.on('update:ready', listener)
    return () => {
      ipcRenderer.off('update:ready', listener)
    }
  },
  onUpdateFailed: (handler: (reason: string) => void) => {
    const listener = (_e: unknown, reason: string) => handler(reason)
    ipcRenderer.on('update:failed', listener)
    return () => {
      ipcRenderer.off('update:failed', listener)
    }
  },

  onCommand: (handler: (command: Command) => void) => {
    const listeners = commands.map((command) => {
      const listener = () => handler(command)
      ipcRenderer.on(command, listener)
      return () => ipcRenderer.off(command, listener)
    })
    return () => listeners.forEach((off) => off())
  },

  onWorkAreaChange: (handler: (rect: Rect) => void) => {
    const listener = (_e: unknown, rect: Rect) => handler(rect)
    ipcRenderer.on('workarea:changed', listener)
    return () => {
      ipcRenderer.off('workarea:changed', listener)
    }
  },
}

export type DeskFieldApi = typeof api

contextBridge.exposeInMainWorld('deskfield', api)
