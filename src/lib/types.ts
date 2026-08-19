export type ItemKind = 'folder' | 'file'

export interface FieldItem {
  id: string
  path: string
  name: string
  kind: ItemKind
  /** 사용자가 고른 아이콘(이모지). 있으면 OS 아이콘 대신 이걸 그린다. */
  emoji?: string
  /** 아이콘을 단순한 흑백 그림으로 표시 */
  mono?: boolean
  /** 경로가 사라진 항목. 지우지 않고 흐리게 표시해서 사용자가 직접 정리하게 둔다. */
  missing?: boolean
}

export interface Field {
  id: string
  title: string
  x: number
  y: number
  w: number
  h: number
  color: string
  collapsed: boolean
  /** 항목이 늘어나면 높이를 자동으로 키운다. */
  autoGrow: boolean
  /** 포털: 이 폴더의 실제 내용을 실시간으로 비춘다. items는 파생 상태. */
  portal?: string
  items: FieldItem[]
}

export type Theme = 'pastel' | 'glass'

export interface Settings {
  /** 필드 외형 — 파스텔 단색 / 바탕화면을 흐리게 비추는 유리 */
  theme: Theme
  /** 유리 모드 배경 이미지 직접 지정 (없으면 현재 바탕화면을 쓴다) */
  glassImage?: string
  /** 필드 배경 불투명도 0.2 ~ 0.9 */
  opacity: number
  /** 타일 한 칸 최소 너비(px) — 필드를 줄이면 이 값 기준으로 열 수가 바뀐다. */
  tile: number
  /** 잠금: 이동·크기조절을 막아 실수로 흐트러지지 않게 한다. */
  locked: boolean
  /** 8px 격자에 맞춰 정렬 */
  snap: boolean
  /** 필드 안 아이콘 사이 여백(px) */
  iconGap: number
  /** 자동 배치·반듯하게 배치에서 필드 사이 여백(px) */
  fieldGap: number
  /** 항목 이름 표시 */
  labels: boolean
  /** 필드에 담은 항목의 바탕화면 원본을 숨겨 '이동'처럼 보이게 한다 */
  hideOriginals: boolean
  /** 마우스가 필드에서 벗어나 있으면 흐려진다 (다른 일 할 때 방해되지 않게) */
  dimIdle: boolean
  /** 흐려졌을 때의 진하기 0.15 ~ 1 */
  dimLevel: number
  /** 오른쪽 아래 도구 막대 표시 여부 — 꺼도 트레이 메뉴로 전부 가능 */
  showBar: boolean
}

export interface AppState {
  version: number
  fields: Field[]
  settings: Settings
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'pastel',
  opacity: 0.55,
  tile: 92,
  locked: false,
  snap: true,
  iconGap: 8,
  fieldGap: 24,
  labels: true,
  hideOriginals: true,
  showBar: true,
  dimIdle: true,
  dimLevel: 0.45,
}

export const MIN_W = 200
export const MIN_H = 130
export const HEADER_H = 38
export const GRID = 8

export function uid() {
  return Math.random().toString(36).slice(2, 10)
}
