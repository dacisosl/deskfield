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
] as const

export type Command = (typeof commands)[number]

const api = {
  loadState: () => ipcRenderer.invoke('state:load') as Promise<unknown | null>,
  saveState: (state: unknown) => ipcRenderer.invoke('state:save', state) as Promise<void>,

  scanDesktop: () => ipcRenderer.invoke('desktop:scan') as Promise<ScanEntry[]>,
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
  quit: () => ipcRenderer.send('app:quit'),

  checkUpdate: () => ipcRenderer.invoke('update:check') as Promise<void>,
  applyUpdate: () => ipcRenderer.invoke('update:apply') as Promise<boolean>,
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
