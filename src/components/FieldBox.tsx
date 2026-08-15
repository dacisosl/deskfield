import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { api } from '../lib/api'
import { GAP, PAD, clamp, columns, neededHeight, snapTo, tileHeight } from '../lib/layout'
import { pastel, rgba } from '../lib/palette'
import { HEADER_H, MIN_H, MIN_W, type Field, type FieldItem, type Settings } from '../lib/types'
import { ItemTile } from './ItemTile'

type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const DIRS: Dir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

interface Gesture {
  mode: 'move' | 'resize'
  dir: Dir | null
  startX: number
  startY: number
  x: number
  y: number
  w: number
  h: number
}

interface Props {
  field: Field
  settings: Settings
  bounds: { w: number; h: number }
  onPatch: (id: string, patch: Partial<Field>) => void
  onOpen: (item: FieldItem) => void
  onItemMenu: (item: FieldItem, x: number, y: number) => void
  onFieldMenu: (field: Field, x: number, y: number) => void
  onDropPaths: (id: string, paths: string[], index: number) => void
  onMoveItem: (itemId: string, toFieldId: string, index: number) => void
  onDropInto: (folder: FieldItem, payload: { itemId?: string; paths?: string[] }) => void
  onGesture: (active: boolean) => void
  /** 이 필드를 맨 앞으로 (겹쳐 있을 때 조작 중인 필드가 가려지지 않게) */
  onRaise: (id: string) => void
  raised: boolean
}

export const FieldBox = memo(function FieldBox({
  field,
  settings,
  bounds,
  onPatch,
  onOpen,
  onItemMenu,
  onFieldMenu,
  onDropPaths,
  onMoveItem,
  onDropInto,
  onGesture,
  onRaise,
  raised,
}: Props) {
  const gesture = useRef<Gesture | null>(null)
  const dragged = useRef(false)
  const titleRef = useRef<HTMLInputElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const tone = pastel(field.color)
  const id = field.id
  const patch = useCallback((next: Partial<Field>) => onPatch(id, next), [onPatch, id])

  // 항목이 늘거나 폭이 좁아지면 높이를 키운다. 줄이는 건 사용자 몫.
  useEffect(() => {
    if (!field.autoGrow || field.collapsed) return
    const needed = neededHeight(field.items.length, field.w, settings)
    const max = bounds.h - field.y - 8
    if (needed > field.h && max > field.h) patch({ h: Math.min(needed, max) })
  }, [
    field.autoGrow,
    field.collapsed,
    field.items.length,
    field.w,
    field.h,
    field.y,
    settings.tile,
    settings.labels,
    bounds.h,
    patch,
  ])

  function begin(mode: 'move' | 'resize', dir: Dir | null, event: ReactPointerEvent) {
    if (event.button !== 0) return
    onRaise(id)
    if (settings.locked) return
    // 제목 위에서 시작하면 기본 동작(포커스)을 살려둔다 — 그냥 클릭하면 이름 편집.
    const onTitle = (event.target as HTMLElement).closest('.df-field__title')
    if (!onTitle) event.preventDefault()
    event.stopPropagation()
    dragged.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = {
      mode,
      dir,
      startX: event.clientX,
      startY: event.clientY,
      x: field.x,
      y: field.y,
      w: field.w,
      h: field.h,
    }
    onGesture(true)
  }

  function move(event: ReactPointerEvent) {
    const g = gesture.current
    if (!g) return
    const dx = event.clientX - g.startX
    const dy = event.clientY - g.startY
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragged.current = true

    if (g.mode === 'move') {
      patch({
        x: clamp(snapTo(g.x + dx, settings.snap), 0, Math.max(0, bounds.w - field.w)),
        y: clamp(snapTo(g.y + dy, settings.snap), 0, Math.max(0, bounds.h - field.h)),
      })
      return
    }

    const dir = g.dir ?? 'se'
    const minH = field.collapsed ? HEADER_H : MIN_H
    let { x, y, w, h } = g

    if (dir.includes('e')) w = clamp(snapTo(g.w + dx, settings.snap), MIN_W, bounds.w - g.x)
    if (dir.includes('s')) h = clamp(snapTo(g.h + dy, settings.snap), minH, bounds.h - g.y)
    if (dir.includes('w')) {
      const right = g.x + g.w
      x = clamp(snapTo(g.x + dx, settings.snap), 0, right - MIN_W)
      w = right - x
    }
    if (dir.includes('n')) {
      const bottom = g.y + g.h
      y = clamp(snapTo(g.y + dy, settings.snap), 0, bottom - minH)
      h = bottom - y
    }

    patch({ x, y, w, h })
  }

  function end(event: ReactPointerEvent) {
    if (!gesture.current) return
    gesture.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    // 끌어서 옮긴 거라면 이름 편집으로 빠지지 않게 포커스를 거둔다.
    if (dragged.current) titleRef.current?.blur()
    onGesture(false)
  }

  /** 커서 위치에서 몇 번째 칸에 끼워 넣을지 계산한다. */
  function indexFromPoint(clientX: number, clientY: number) {
    const body = bodyRef.current
    if (!body) return field.items.length
    const tiles = Array.from(body.querySelectorAll<HTMLElement>('[data-tile]'))
    if (tiles.length === 0) return 0

    for (let i = 0; i < tiles.length; i += 1) {
      const rect = tiles[i].getBoundingClientRect()
      if (clientY < rect.bottom && clientX < rect.left + rect.width / 2) return i
      if (clientY < rect.top) return i
    }
    return tiles.length
  }

  const cols = columns(field.w, settings)
  const rowH = tileHeight(settings)

  return (
    <section
      data-solid
      className={`df-field ${field.collapsed ? 'df-field--collapsed' : ''}`}
      style={{
        left: field.x,
        top: field.y,
        width: field.w,
        height: field.collapsed ? HEADER_H : field.h,
        zIndex: raised ? 3 : 1,
        background: rgba(tone.base, settings.opacity),
        // 흰 필드는 흰 테두리가 안 보여서 옅은 회색으로 윤곽만 잡아준다.
        borderColor:
          field.color === 'white'
            ? 'rgba(178, 178, 194, 0.55)'
            : rgba('#FFFFFF', Math.min(0.75, settings.opacity + 0.2)),
        color: tone.ink,
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onRaise(id)
        onFieldMenu(field, event.clientX, event.clientY)
      }}
    >
      <header
        className="df-field__head"
        onPointerDown={(event) => begin('move', null, event)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('.df-field__title')) return
          patch({ collapsed: !field.collapsed })
        }}
      >
        <input
          ref={titleRef}
          className="df-field__title"
          value={field.title}
          spellCheck={false}
          style={{ color: tone.ink }}
          onChange={(event) => patch({ title: event.target.value })}
          // 이 창은 평소 포커스를 받지 않아서, 누르는 순간 먼저 열어줘야
          // Windows에서도 키보드 입력이 들어온다.
          onPointerDown={() => api.setFocusable(true)}
          onFocus={() => api.setFocusable(true)}
          onBlur={() => api.setFocusable(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur()
          }}
        />
        {field.portal && (
          <span className="df-field__link" title={`폴더를 비추는 중: ${field.portal}`}>
            🔗
          </span>
        )}
        <span className="df-field__count">{field.items.length}</span>
        <button
          type="button"
          className="df-field__btn"
          title={field.collapsed ? '펼치기' : '접기'}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => patch({ collapsed: !field.collapsed })}
        >
          {field.collapsed ? '▸' : '▾'}
        </button>
        <button
          type="button"
          className="df-field__btn"
          title="필드 메뉴"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            onFieldMenu(field, rect.left, rect.bottom + 4)
          }}
        >
          ⋯
        </button>
      </header>

      {!field.collapsed && (
        <div
          ref={bodyRef}
          className="df-field__body"
          style={{
            padding: PAD,
            gap: GAP,
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridAutoRows: `${rowH}px`,
          }}
          onDragOver={(event) => {
            const internal = event.dataTransfer.types.includes('application/x-deskfield-item')
            const files = event.dataTransfer.types.includes('Files')
            if (!internal && !files) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            setDropAt(indexFromPoint(event.clientX, event.clientY))
          }}
          onDragLeave={() => setDropAt(null)}
          onDrop={(event) => {
            event.preventDefault()
            // 루트의 '필드에서 빼기' 드롭 처리까지 올라가면 넣자마자 빠진다.
            event.stopPropagation()
            onRaise(id)
            const index = dropAt ?? field.items.length
            setDropAt(null)

            const itemId = event.dataTransfer.getData('application/x-deskfield-item')
            if (itemId) {
              onMoveItem(itemId, id, index)
              return
            }
            const paths = Array.from(event.dataTransfer.files)
              .map((file) => api.pathForFile(file))
              .filter(Boolean)
            if (paths.length > 0) onDropPaths(id, paths, index)
          }}
        >
          {field.items.map((item, index) => (
            <div key={item.id} data-tile className={dropAt === index ? 'df-slot df-slot--mark' : 'df-slot'}>
              <ItemTile
                item={item}
                ink={tone.ink}
                labels={settings.labels}
                onOpen={onOpen}
                onMenu={onItemMenu}
                onDragStart={() => onGesture(true)}
                onDragEnd={() => onGesture(false)}
                onDropInto={onDropInto}
              />
            </div>
          ))}

          {field.items.length === 0 && (
            <p className="df-field__empty" style={{ color: tone.ink }}>
              {field.portal ? '폴더가 비어 있어요' : '폴더나 파일을 여기로 끌어다 놓으세요'}
            </p>
          )}
        </div>
      )}

      {!settings.locked &&
        DIRS.map((dir) => (
          <span
            key={dir}
            className={`df-handle df-handle--${dir}`}
            onPointerDown={(event) => begin('resize', dir, event)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
        ))}
    </section>
  )
})
