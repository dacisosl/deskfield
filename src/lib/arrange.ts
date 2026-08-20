/**
 * 필드 배치 계산.
 *
 * 화면이 바뀌는 순간(보조 모니터를 꽂거나 뽑을 때, 해상도가 바뀔 때)에도 쓰고,
 * '필드 반듯하게 배치'에서도 같은 걸 쓴다. 순수 함수라 화면 없이도 확인할 수 있다.
 */
import { HEADER_H, type Field, type LayoutSnapshot, type Spot } from './types'

export interface Size {
  w: number
  h: number
}

/** 배치가 실제로 달라졌는가 — 달라지지 않았으면 저장도 안내도 하지 않는다. */
export function sameLayout(a: Field[], b: Field[]) {
  if (a.length !== b.length) return false
  return a.every((field, i) => {
    const other = b[i]
    return (
      field.id === other.id &&
      field.x === other.x &&
      field.y === other.y &&
      field.w === other.w &&
      field.h === other.h
    )
  })
}

/** 기억해 둘 화면 수. 이보다 오래된 건 버린다. */
export const MAX_LAYOUTS = 8

export function screenKey(bounds: Size) {
  return `${Math.round(bounds.w)}x${Math.round(bounds.h)}`
}

/** 접힌 필드는 머리글만 남으므로 자리도 그만큼만 차지한다. */
function heightOf(field: Field) {
  return field.collapsed ? HEADER_H : field.h
}

function hits(a: Spot, b: Spot) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function spotOf(field: Field): Spot {
  return { x: field.x, y: field.y, w: field.w, h: heightOf(field) }
}

/** 화면 안에 들어오고 서로 겹치지도 않는가. */
export function layoutIsFine(fields: Field[], bounds: Size) {
  const spots = fields.map(spotOf)
  for (let i = 0; i < spots.length; i += 1) {
    const spot = spots[i]
    if (spot.x < 0 || spot.y < 0) return false
    if (spot.x + spot.w > bounds.w || spot.y + spot.h > bounds.h) return false
    for (let j = i + 1; j < spots.length; j += 1) {
      if (hits(spot, spots[j])) return false
    }
  }
  return true
}

/** 화면보다 큰 필드를 화면에 맞게 줄인다. 자리는 건드리지 않는다. */
export function fitSizes(fields: Field[], bounds: Size): Field[] {
  return fields.map((field) => {
    const w = Math.min(field.w, bounds.w)
    const h = Math.min(field.h, bounds.h)
    return w === field.w && h === field.h ? field : { ...field, w, h }
  })
}

/**
 * 왼쪽 위부터 줄 단위로 채워 넣는다.
 * 한 줄에 다 못 넣으면 다음 줄로 내리고, 세로로도 넘치면 마지막 줄에 눌러 담는다
 * (화면 밖으로 내보내는 것보다는 낫다).
 */
export function packFields(fields: Field[], bounds: Size, gap: number): Field[] {
  let x = gap
  let y = gap
  let rowH = 0
  return fields.map((field) => {
    if (x + field.w > bounds.w - gap && x > gap) {
      x = gap
      y += rowH + gap
      rowH = 0
    }
    const placed = {
      ...field,
      x: Math.max(0, Math.min(x, bounds.w - field.w)),
      y: Math.max(0, Math.min(y, bounds.h - heightOf(field))),
    }
    x += field.w + gap
    rowH = Math.max(rowH, heightOf(field))
    return placed
  })
}

/** 기억해 둔 자리 중 겹치지 않는 빈 곳을 왼쪽 위부터 찾는다. */
function freeSpot(taken: Spot[], w: number, h: number, bounds: Size, gap: number) {
  const step = 24
  for (let y = gap; y + h <= bounds.h; y += step) {
    for (let x = gap; x + w <= bounds.w; x += step) {
      const room = { x, y, w: w + gap, h: h + gap }
      if (!taken.some((spot) => hits(spot, room))) return { x, y }
    }
  }
  return null
}

/**
 * 이 화면에서 쓰던 배치로 되돌린다.
 * 그 사이 새로 만든 필드는 빈 자리에 놓고, 그래도 엉키면 통째로 다시 채워 넣는다.
 */
export function applySnapshot(
  fields: Field[],
  snapshot: LayoutSnapshot,
  bounds: Size,
  gap: number,
): Field[] {
  const taken: Spot[] = []
  const pending: Field[] = []

  const restored = fields.map((field) => {
    const spot = snapshot.spots[field.id]
    if (!spot) {
      pending.push(field)
      return field
    }
    const placed = { ...field, ...spot }
    taken.push(spotOf(placed))
    return placed
  })

  const placements = new Map<string, Spot>()
  for (const field of pending) {
    const w = Math.min(field.w, bounds.w)
    const h = Math.min(heightOf(field), bounds.h)
    const spot = freeSpot(taken, w, h, bounds, gap)
    if (!spot) return packFields(fitSizes(fields, bounds), bounds, gap)
    placements.set(field.id, { ...spot, w, h })
    taken.push({ ...spot, w, h })
  }

  const result = restored.map((field) => {
    const spot = placements.get(field.id)
    return spot ? { ...field, x: spot.x, y: spot.y } : field
  })

  const fitted = fitSizes(result, bounds)
  return layoutIsFine(fitted, bounds) ? fitted : packFields(fitted, bounds, gap)
}

/** 지금 배치를 화면 크기와 함께 기억해 둔다. 오래된 것부터 버린다. */
export function rememberLayout(
  layouts: LayoutSnapshot[],
  key: string,
  fields: Field[],
): LayoutSnapshot[] {
  const spots: Record<string, Spot> = {}
  for (const field of fields) spots[field.id] = { x: field.x, y: field.y, w: field.w, h: field.h }
  const rest = layouts.filter((entry) => entry.key !== key)
  return [{ key, spots }, ...rest].slice(0, MAX_LAYOUTS)
}
