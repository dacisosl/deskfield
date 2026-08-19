import { GRID, HEADER_H, type Settings } from './types'

export const PAD = 10

export function tileHeight(settings: Settings) {
  return settings.labels ? Math.round(settings.tile * 0.94) : Math.round(settings.tile * 0.66)
}

/** 필드 너비에서 몇 칸이 들어가는지 — CSS의 auto-fill과 같은 계산. */
export function columns(width: number, settings: Settings) {
  const gap = settings.iconGap
  return Math.max(1, Math.floor((width - PAD * 2 + gap) / (settings.tile + gap)))
}

/** 항목을 모두 보여주려면 필요한 필드 높이 */
export function neededHeight(count: number, width: number, settings: Settings) {
  const rows = Math.max(1, Math.ceil(count / columns(width, settings)))
  return HEADER_H + PAD * 2 + rows * tileHeight(settings) + (rows - 1) * settings.iconGap
}

export function snapTo(value: number, snap: boolean) {
  return snap ? Math.round(value / GRID) * GRID : Math.round(value)
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
