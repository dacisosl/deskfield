import type { DeskFieldApi } from '../../electron/preload'

declare global {
  interface Window {
    deskfield: DeskFieldApi
  }
}

export const api = window.deskfield

export type { ScanEntry, Rect, Command } from '../../electron/preload'
