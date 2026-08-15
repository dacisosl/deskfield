interface Props {
  title: string
  body: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = '취소',
  danger,
  onConfirm,
  onClose,
}: Props) {
  return (
    <div data-solid className="df-modal" onClick={onClose}>
      <div
        className="df-modal__card df-modal__card--narrow"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="df-modal__head">
          <h2>{title}</h2>
          <p style={{ whiteSpace: 'pre-line' }}>{body}</p>
        </header>
        <footer className="df-modal__foot">
          <button type="button" className="df-btn df-btn--ghost" onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`df-btn ${danger ? 'df-btn--danger' : 'df-btn--go'}`}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}
