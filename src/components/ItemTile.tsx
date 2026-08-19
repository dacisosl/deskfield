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

/**
 * 폴더는 OS 추출이 환경에 따라 엉뚱한 아이콘을 주는 경우가 있어 직접 그린다.
 * 어디서나 같은 모습이고, 파스텔 배경과도 어울린다.
 */
function FolderGlyph() {
  return (
    <svg viewBox="0 0 48 40" width="44" height="37" aria-hidden>
      <path d="M4 9a4 4 0 0 1 4-4h11.2l4.2 5H40a4 4 0 0 1 4 4v2H4Z" fill="#EBBE5E" />
      <rect x="4" y="13" width="40" height="23" rx="4" fill="#F7D98C" />
      <rect x="4" y="13" width="40" height="7.5" rx="3.75" fill="#FBE7AE" />
    </svg>
  )
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
  // 이모지를 골랐거나 폴더·특수 타일이면 OS 아이콘을 아예 요청하지 않는다.
  const wantsOsIcon = !item.emoji && !special && item.kind !== 'folder'
  const icon = useIcon(wantsOsIcon ? item.path : '')

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
        ) : item.kind === 'folder' ? (
          <FolderGlyph />
        ) : icon ? (
          <img src={icon} alt="" draggable={false} />
        ) : (
          <span className="df-tile__fallback">{special ? '🗑️' : '📄'}</span>
        )}
      </span>
      {labels && <span className="df-tile__name">{item.name}</span>}
    </button>
  )
})
