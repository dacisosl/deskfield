import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { FieldItem } from '../lib/types'

const iconCache = new Map<string, string | null>()

function useIcon(target: string) {
  const [icon, setIcon] = useState<string | null>(() => iconCache.get(target) ?? null)

  useEffect(() => {
    if (iconCache.has(target)) {
      setIcon(iconCache.get(target) ?? null)
      return
    }
    let alive = true
    api.getIcon(target).then((value) => {
      iconCache.set(target, value)
      if (alive) setIcon(value)
    })
    return () => {
      alive = false
    }
  }, [target])

  return icon
}

interface Props {
  item: FieldItem
  ink: string
  labels: boolean
  onOpen: (item: FieldItem) => void
  onMenu: (item: FieldItem, x: number, y: number) => void
  onDragStart: (item: FieldItem) => void
  onDragEnd: () => void
}

export function ItemTile({ item, ink, labels, onOpen, onMenu, onDragStart, onDragEnd }: Props) {
  const icon = useIcon(item.path)

  return (
    <button
      type="button"
      draggable
      className={`df-tile ${item.missing ? 'df-tile--missing' : ''}`}
      style={{ color: ink }}
      title={item.missing ? `${item.path}\n(찾을 수 없음)` : item.path}
      onDoubleClick={() => onOpen(item)}
      onContextMenu={(event) => {
        event.preventDefault()
        onMenu(item, event.clientX, event.clientY)
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('application/x-deskfield-item', item.id)
        onDragStart(item)
      }}
      onDragEnd={onDragEnd}
    >
      <span className="df-tile__icon">
        {icon ? (
          <img src={icon} alt="" draggable={false} />
        ) : (
          <span className="df-tile__fallback">{item.kind === 'folder' ? '📁' : '📄'}</span>
        )}
      </span>
      {labels && <span className="df-tile__name">{item.name}</span>}
    </button>
  )
}
