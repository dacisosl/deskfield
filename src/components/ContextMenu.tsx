import { useEffect, useRef, useState } from 'react'
import { PALETTE } from '../lib/palette'

export interface MenuEntry {
  label: string
  onSelect?: () => void
  danger?: boolean
  separator?: boolean
}

export interface MenuSpec {
  x: number
  y: number
  entries: MenuEntry[]
  /** 색 고르기 줄을 맨 위에 붙인다. */
  onColor?: (key: string) => void
}

interface Props {
  menu: MenuSpec
  onClose: () => void
}

export function ContextMenu({ menu, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ x: menu.x, y: menu.y })

  // 화면 밖으로 나가면 안쪽으로 당겨온다.
  useEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    const x = Math.min(menu.x, window.innerWidth - box.width - 8)
    const y = Math.min(menu.y, window.innerHeight - box.height - 8)
    setPos({ x: Math.max(8, x), y: Math.max(8, y) })
  }, [menu.x, menu.y])

  useEffect(() => {
    const close = () => onClose()
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [onClose])

  return (
    <div
      data-solid
      ref={ref}
      className="df-menu"
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {menu.onColor && (
        <div className="df-menu__colors">
          {PALETTE.map((tone) => (
            <button
              key={tone.key}
              type="button"
              title={tone.label}
              className="df-menu__swatch"
              style={{ background: tone.base }}
              onClick={() => {
                menu.onColor?.(tone.key)
                onClose()
              }}
            />
          ))}
        </div>
      )}

      {menu.entries.map((entry, index) =>
        entry.separator ? (
          <hr key={`sep-${index}`} className="df-menu__sep" />
        ) : (
          <button
            key={entry.label}
            type="button"
            className={`df-menu__item ${entry.danger ? 'df-menu__item--danger' : ''}`}
            onClick={() => {
              entry.onSelect?.()
              onClose()
            }}
          >
            {entry.label}
          </button>
        ),
      )}
    </div>
  )
}
