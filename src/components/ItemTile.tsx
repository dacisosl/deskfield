import { memo, useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { FieldItem } from '../lib/types'

const iconCache = new Map<string, string | null>()

function useIcon(target: string) {
  const [icon, setIcon] = useState<string | null>(() => (target ? (iconCache.get(target) ?? null) : null))

  useEffect(() => {
    if (!target) return
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
  /** 폴더 타일에 다른 항목을 떨어뜨리면 실제로 그 폴더 안으로 이동 */
  onDropInto: (folder: FieldItem, payload: { itemId?: string; paths?: string[] }) => void
}

export const ItemTile = memo(function ItemTile({
  item,
  ink,
  labels,
  onOpen,
  onMenu,
  onDragStart,
  onDragEnd,
  onDropInto,
}: Props) {
  const [hot, setHot] = useState(false)
  const special = item.path.startsWith('shell:')
  const canReceive = item.kind === 'folder' && !item.missing && !special
  // 이모지를 직접 고른 타일만 빼고, 나머지는 바탕화면에 보이는 그 아이콘을 그대로 쓴다.
  const icon = useIcon(item.emoji ? '' : item.path)

  return (
    <button
      type="button"
      draggable
      className={`df-tile ${item.missing ? 'df-tile--missing' : ''} ${hot ? 'df-tile--hot' : ''}`}
      style={{ color: ink }}
      title={special ? item.name : item.missing ? `${item.path}\n(찾을 수 없음)` : item.path}
      onDoubleClick={() => onOpen(item)}
      onContextMenu={(event) => {
        event.preventDefault()
        // 필드의 우클릭 메뉴가 이걸 덮어쓰지 않게 전파를 끊는다.
        event.stopPropagation()
        onMenu(item, event.clientX, event.clientY)
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('application/x-deskfield-item', item.id)
        onDragStart(item)
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (!canReceive) return
        const internal = event.dataTransfer.types.includes('application/x-deskfield-item')
        const files = event.dataTransfer.types.includes('Files')
        if (!internal && !files) return
        event.preventDefault()
        // 필드 본문의 '자리 끼워넣기' 처리보다 폴더 드롭이 우선
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'move'
        setHot(true)
      }}
      onDragLeave={() => setHot(false)}
      onDrop={(event) => {
        if (!canReceive) return
        event.preventDefault()
        event.stopPropagation()
        setHot(false)
        const itemId = event.dataTransfer.getData('application/x-deskfield-item')
        if (itemId && itemId !== item.id) {
          onDropInto(item, { itemId })
          return
        }
        const paths = Array.from(event.dataTransfer.files)
          .map((file) => api.pathForFile(file))
          .filter(Boolean)
        if (paths.length > 0) onDropInto(item, { paths })
      }}
    >
      <span className="df-tile__icon">
        {item.emoji ? (
          <span className={`df-tile__emoji ${item.mono ? 'df-tile__emoji--mono' : ''}`}>
            {item.emoji}
          </span>
        ) : icon ? (
          <img
            className={`df-tile__img ${item.mono ? 'df-tile__img--mono' : ''}`}
            src={icon}
            alt=""
            draggable={false}
          />
        ) : (
          <span className="df-tile__fallback">
            {special ? '🗑️' : item.kind === 'folder' ? '📁' : '📄'}
          </span>
        )}
      </span>
      {labels && <span className="df-tile__name">{item.name}</span>}
    </button>
  )
})
