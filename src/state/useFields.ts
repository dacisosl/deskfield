import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import {
  DEFAULT_SETTINGS,
  MIN_H,
  MIN_W,
  type AppState,
  type Field,
  type FieldItem,
  type Settings,
  uid,
} from '../lib/types'

function isReal(item: Pick<FieldItem, 'path'>) {
  return !item.path.startsWith('shell:')
}

const EMPTY: AppState = { version: 1, fields: [], settings: DEFAULT_SETTINGS }

function basename(target: string) {
  const parts = target.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? target
}

function overlaps(a: Field, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/** 겹치지 않는 첫 자리를 왼쪽 위부터 찾는다. 다 차면 살짝 어긋나게 얹는다. */
export function findSlot(fields: Field[], w: number, h: number, bounds: { w: number; h: number }) {
  const step = 24
  const margin = 24
  // 딱 붙여 놓으면 이웃한 필드의 크기조절 손잡이끼리 겹쳐서 잡기 어렵다.
  const gap = 12
  for (let y = margin; y + h <= bounds.h - margin; y += step) {
    for (let x = margin; x + w <= bounds.w - margin; x += step) {
      const room = { x: x - gap, y: y - gap, w: w + gap * 2, h: h + gap * 2 }
      if (!fields.some((field) => overlaps(field, room))) return { x, y }
    }
  }
  const offset = (fields.length % 8) * 28
  return { x: margin + offset, y: margin + offset }
}

function migrate(raw: unknown): AppState {
  if (!raw || typeof raw !== 'object') return EMPTY
  const state = raw as Partial<AppState>
  return {
    version: 1,
    fields: Array.isArray(state.fields) ? state.fields.map(normalizeField) : [],
    settings: { ...DEFAULT_SETTINGS, ...(state.settings ?? {}) },
  }
}

function normalizeField(field: Field): Field {
  return {
    ...field,
    w: Math.max(MIN_W, field.w),
    h: Math.max(MIN_H, field.h),
    collapsed: !!field.collapsed,
    autoGrow: field.autoGrow ?? true,
    items: Array.isArray(field.items) ? field.items : [],
  }
}

export function useFields() {
  const [state, setState] = useState<AppState>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    let alive = true
    api.loadState().then(async (raw) => {
      if (!alive) return
      const next = migrate(raw)
      // 사라진 경로는 지우지 않고 표시만 해 둔다. 외장 드라이브가 빠진 것일 수도 있어서.
      const checked = await Promise.all(
        next.fields.map(async (field) => ({
          ...field,
          items: await Promise.all(
            field.items.map(async (item) => ({
              ...item,
              missing: isReal(item) ? !(await api.exists(item.path)) : false,
            })),
          ),
        })),
      )
      if (!alive) return
      setState({ ...next, fields: checked })
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [])

  // 저장은 묶어서. 크기조절 중에는 상태가 초당 수십 번 바뀐다.
  useEffect(() => {
    if (!loaded) return
    const timer = setTimeout(() => {
      void api.saveState({
        ...state,
        fields: state.fields.map((field) => ({
          ...field,
          items: field.items.map(({ missing: _missing, ...item }) => item),
        })),
      })
    }, 400)
    return () => clearTimeout(timer)
  }, [state, loaded])

  const patchField = useCallback((id: string, patch: Partial<Field>) => {
    setState((prev) => ({
      ...prev,
      fields: prev.fields.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    }))
  }, [])

  /**
   * 자리 계산을 상태 갱신 안에서 한다. 자동 정리처럼 한 번에 여러 개를 만들 때도
   * 직전에 놓인 필드를 보고 빈 곳을 고르게 하려고.
   */
  const addField = useCallback(
    (init: Partial<Field>, bounds: { w: number; h: number }) => {
      const id = uid()
      setState((prev) => {
        const w = init.w ?? 320
        const h = init.h ?? 220
        const slot =
          init.x !== undefined && init.y !== undefined
            ? { x: init.x, y: init.y }
            : findSlot(prev.fields, w, h, bounds)
        return {
          ...prev,
          fields: [
            ...prev.fields,
            {
              id,
              title: '새 필드',
              collapsed: false,
              autoGrow: true,
              items: [],
              color: 'white',
              ...init,
              w,
              h,
              x: slot.x,
              y: slot.y,
            },
          ],
        }
      })
      return id
    },
    [],
  )

  const removeField = useCallback((id: string) => {
    const target = stateRef.current.fields.find((field) => field.id === id)
    target?.items.filter(isReal).forEach((item) => void api.setHidden(item.path, false))
    setState((prev) => ({ ...prev, fields: prev.fields.filter((field) => field.id !== id) }))
  }, [])

  /** 항목을 비우면 바탕화면 원본도 다시 보여준다. */
  const clearField = useCallback((id: string) => {
    const target = stateRef.current.fields.find((field) => field.id === id)
    target?.items.filter(isReal).forEach((item) => void api.setHidden(item.path, false))
    setState((prev) => ({
      ...prev,
      fields: prev.fields.map((field) => (field.id === id ? { ...field, items: [] } : field)),
    }))
  }, [])

  /** 휴지통처럼 파일 경로가 없는 특수 타일 */
  const addSpecial = useCallback((fieldId: string, item: Omit<FieldItem, 'id'>) => {
    setState((prev) => {
      // 같은 특수 타일이 이미 있으면 중복으로 만들지 않는다.
      if (prev.fields.some((field) => field.items.some((it) => it.path === item.path))) return prev
      return {
        ...prev,
        fields: prev.fields.map((field) =>
          field.id === fieldId ? { ...field, items: [...field.items, { ...item, id: uid() }] } : field,
        ),
      }
    })
  }, [])

  const updateItem = useCallback((itemId: string, patch: Partial<FieldItem>) => {
    setState((prev) => ({
      ...prev,
      fields: prev.fields.map((field) => ({
        ...field,
        items: field.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
      })),
    }))
  }, [])

  /** 경로들을 필드에 넣는다. 다른 필드에 있던 항목은 옮겨온다(복제하지 않는다). */
  const addPaths = useCallback(async (fieldId: string, paths: string[], index?: number) => {
    const resolved: FieldItem[] = []
    for (const target of paths) {
      if (!target) continue
      const stat = await api.stat(target)
      resolved.push({
        id: uid(),
        path: target,
        name: basename(target),
        kind: stat?.isDirectory ? 'folder' : 'file',
        missing: stat === null,
      })
    }
    if (resolved.length === 0) return

    if (stateRef.current.settings.hideOriginals) {
      resolved.filter(isReal).forEach((item) => void api.setHidden(item.path, true))
    }

    setState((prev) => {
      const keys = new Set(resolved.map((item) => item.path.toLowerCase()))
      const fields = prev.fields.map((field) => ({
        ...field,
        items: field.items.filter((item) => !keys.has(item.path.toLowerCase())),
      }))
      return {
        ...prev,
        fields: fields.map((field) => {
          if (field.id !== fieldId) return field
          const items = [...field.items]
          const at = index === undefined ? items.length : Math.max(0, Math.min(index, items.length))
          items.splice(at, 0, ...resolved)
          return { ...field, items }
        }),
      }
    })
  }, [])

  /** 필드 안 순서 변경 + 필드 간 이동을 한 번에 처리한다. */
  const moveItem = useCallback((itemId: string, toFieldId: string, index: number) => {
    setState((prev) => {
      const from = prev.fields.find((field) => field.items.some((item) => item.id === itemId))
      const item = from?.items.find((entry) => entry.id === itemId)
      if (!from || !item) return prev

      const sameField = from.id === toFieldId
      const fromIndex = from.items.findIndex((entry) => entry.id === itemId)

      return {
        ...prev,
        fields: prev.fields.map((field) => {
          if (field.id === from.id && field.id === toFieldId) {
            const items = [...field.items]
            items.splice(fromIndex, 1)
            const at = Math.max(0, Math.min(index > fromIndex ? index - 1 : index, items.length))
            items.splice(at, 0, item)
            return { ...field, items }
          }
          if (field.id === from.id) {
            return { ...field, items: field.items.filter((entry) => entry.id !== itemId) }
          }
          if (field.id === toFieldId && !sameField) {
            const items = [...field.items]
            items.splice(Math.max(0, Math.min(index, items.length)), 0, item)
            return { ...field, items }
          }
          return field
        }),
      }
    })
  }, [])

  const removeItems = useCallback((ids: string[]) => {
    const drop = new Set(ids)
    for (const field of stateRef.current.fields) {
      for (const item of field.items) {
        if (drop.has(item.id) && isReal(item)) void api.setHidden(item.path, false)
      }
    }
    setState((prev) => ({
      ...prev,
      fields: prev.fields.map((field) => ({
        ...field,
        items: field.items.filter((item) => !drop.has(item.id)),
      })),
    }))
  }, [])

  const sortField = useCallback((id: string, mode: 'name' | 'kind') => {
    setState((prev) => ({
      ...prev,
      fields: prev.fields.map((field) => {
        if (field.id !== id) return field
        const items = [...field.items].sort((a, b) => {
          if (mode === 'kind' && a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
          return a.name.localeCompare(b.name, 'ko')
        })
        return { ...field, items }
      }),
    }))
  }, [])

  const setSettings = useCallback((patch: Partial<Settings>) => {
    setState((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }))
  }, [])

  const replaceFields = useCallback((updater: (fields: Field[]) => Field[]) => {
    setState((prev) => ({ ...prev, fields: updater(prev.fields) }))
  }, [])

  return {
    state,
    stateRef,
    loaded,
    addField,
    patchField,
    removeField,
    clearField,
    addSpecial,
    updateItem,
    addPaths,
    moveItem,
    removeItems,
    sortField,
    setSettings,
    replaceFields,
  }
}
