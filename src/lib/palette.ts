import type { Theme } from './types'

export interface Tone {
  /** 필드 배경 */
  base: string
  /** 제목·아이콘 글자색 */
  ink: string
}

/** 필드 디자인은 두 가지뿐이다 — 모든 필드가 같은 톤을 써서 바탕화면이 정돈돼 보이게. */
export const THEMES: Record<Theme, Tone & { label: string }> = {
  dark: { label: '어둡게', base: '#161824', ink: '#EEF0F6' },
  light: { label: '밝게', base: '#F7F7FA', ink: '#2A2C37' },
}

export function tone(theme: Theme): Tone {
  return THEMES[theme] ?? THEMES.dark
}

export function rgba(hex: string, alpha: number) {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
