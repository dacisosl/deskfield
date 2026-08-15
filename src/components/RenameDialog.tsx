import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { FieldItem } from '../lib/types'

interface Props {
  item: FieldItem
  onConfirm: (newName: string) => void
  onClose: () => void
}

export function RenameDialog({ item, onConfirm, onClose }: Props) {
  const [name, setName] = useState(item.name)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 이 창은 평소 포커스를 안 받는다 — 입력하는 동안만 연다.
  useEffect(() => {
    api.setFocusable(true)
    const timer = setTimeout(() => {
      const input = inputRef.current
      if (!input) return
      input.focus()
      // 바탕화면 이름 바꾸기처럼 확장자 앞까지만 선택해 준다.
      const dot = item.kind === 'file' ? item.name.lastIndexOf('.') : -1
      input.setSelectionRange(0, dot > 0 ? dot : item.name.length)
    }, 30)
    return () => {
      clearTimeout(timer)
      api.setFocusable(false)
    }
  }, [item])

  const submit = () => {
    const clean = name.trim()
    if (!clean || clean === item.name) {
      onClose()
      return
    }
    onConfirm(clean)
    onClose()
  }

  return (
    <div data-solid className="df-modal" onClick={onClose}>
      <div
        className="df-modal__card df-modal__card--narrow"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="df-modal__head">
          <h2>이름 바꾸기</h2>
        </header>
        <input
          ref={inputRef}
          className="df-rename"
          value={name}
          spellCheck={false}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
            if (event.key === 'Escape') onClose()
          }}
        />
        <footer className="df-modal__foot">
          <button type="button" className="df-btn df-btn--ghost" onClick={onClose}>
            취소
          </button>
          <button type="button" className="df-btn df-btn--go" onClick={submit} disabled={!name.trim()}>
            변경
          </button>
        </footer>
      </div>
    </div>
  )
}
