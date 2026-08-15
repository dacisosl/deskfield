interface Props {
  editing: boolean
  locked: boolean
  onToggleEdit: () => void
  onNewField: () => void
  onScan: () => void
  onToggleLock: () => void
  onSettings: () => void
}

export function Toolbar({
  editing,
  locked,
  onToggleEdit,
  onNewField,
  onScan,
  onToggleLock,
  onSettings,
}: Props) {
  return (
    <div data-solid className={`df-bar ${editing ? 'df-bar--on' : ''}`}>
      <button type="button" className="df-bar__btn" onClick={onNewField} title="새 필드 (빈 곳에 만들기)">
        ＋
      </button>
      <button type="button" className="df-bar__btn" onClick={onScan} title="바탕화면 자동 정리">
        ✨
      </button>
      <button
        type="button"
        className={`df-bar__btn ${editing ? 'df-bar__btn--active' : ''}`}
        onClick={onToggleEdit}
        title="편집 모드 (Ctrl+Alt+D) — 빈 곳을 끌어 새 필드를 그립니다"
      >
        ✎
      </button>
      <button
        type="button"
        className={`df-bar__btn ${locked ? 'df-bar__btn--active' : ''}`}
        onClick={onToggleLock}
        title={locked ? '잠금 해제' : '필드 잠그기 (이동·크기조절 막기)'}
      >
        {locked ? '🔒' : '🔓'}
      </button>
      <button type="button" className="df-bar__btn" onClick={onSettings} title="설정">
        ⚙
      </button>
    </div>
  )
}
