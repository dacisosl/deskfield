export interface Pastel {
  key: string
  label: string
  /** 필드 배경 */
  base: string
  /** 제목·아이콘 글자색 — 파스텔 위에서 대비가 확보되는 짙은 톤 */
  ink: string
}

export const PALETTE: Pastel[] = [
  { key: 'lavender', label: '라벤더', base: '#DCD6F2', ink: '#453C63' },
  { key: 'mint', label: '민트', base: '#CFE9DE', ink: '#2F5449' },
  { key: 'sky', label: '스카이', base: '#D4E4F4', ink: '#2E4A63' },
  { key: 'peach', label: '피치', base: '#F6DCCB', ink: '#6A4632' },
  { key: 'lemon', label: '레몬', base: '#F3E9C4', ink: '#5F5326' },
  { key: 'rose', label: '로즈', base: '#F3D7E0', ink: '#653847' },
  { key: 'sage', label: '세이지', base: '#DEE7D3', ink: '#43522F' },
  { key: 'clay', label: '클레이', base: '#E7DED6', ink: '#544639' },
]

const byKey = new Map(PALETTE.map((p) => [p.key, p]))

export function pastel(key: string): Pastel {
  return byKey.get(key) ?? PALETTE[0]
}

export function rgba(hex: string, alpha: number) {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 필드를 새로 만들 때 이미 쓰인 색은 피해서 고른다. */
export function nextColor(used: string[]) {
  const counts = PALETTE.map((p) => ({
    key: p.key,
    count: used.filter((u) => u === p.key).length,
  }))
  counts.sort((a, b) => a.count - b.count)
  return counts[0].key
}
