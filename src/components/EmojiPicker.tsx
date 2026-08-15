/**
 * 타일 아이콘 피커. 외부 API 없이 OS 컬러 이모지로 그린다 —
 * 오프라인에서도 동작하고, Windows 11의 Fluent 이모지라 보기에도 낫다.
 */

const GROUPS: { label: string; emoji: string[] }[] = [
  {
    label: '정리·작업',
    emoji: ['📁', '🗂️', '📚', '📝', '✏️', '📌', '📎', '🗃️', '📅', '⏰', '✅', '📋', '📊', '📈'],
  },
  {
    label: '학교',
    emoji: ['🏫', '🎓', '🧑‍🏫', '📖', '📐', '🧪', '🔬', '🌍', '🎨', '🎵', '⚽', '🏆', '🥇', '🔔'],
  },
  {
    label: '파일·미디어',
    emoji: ['🖼️', '📷', '🎬', '🎧', '🎤', '💾', '📀', '🖥️', '⌨️', '🖱️', '🖨️', '🎮', '📱', '🔍'],
  },
  {
    label: '강조',
    emoji: ['⭐', '🌟', '❤️', '💙', '💚', '💛', '💜', '🔥', '✨', '🌈', '🎯', '🚀', '💡', '⚡'],
  },
  {
    label: '자연·음식',
    emoji: ['🌸', '🌼', '🌿', '🍀', '🌵', '🌴', '🍎', '🍋', '🍇', '🫐', '☀️', '🌙', '☁️', '❄️'],
  },
  {
    label: '사물',
    emoji: ['🗑️', '🔒', '🔑', '🎁', '📦', '🧰', '🧲', '🪄', '🎈', '🧸', '☕', '🍱', '💰', '🛒'],
  },
]

interface Props {
  /** 현재 아이콘이 이모지인 항목이면 '기본 아이콘' 버튼을 보여준다 */
  showReset: boolean
  onPick: (emoji: string) => void
  onReset: () => void
  onClose: () => void
}

export function EmojiPicker({ showReset, onPick, onReset, onClose }: Props) {
  return (
    <div data-solid className="df-modal" onClick={onClose}>
      <div
        className="df-modal__card df-modal__card--narrow"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="df-modal__head">
          <h2>아이콘 고르기</h2>
          <p>이 항목을 필드에서 어떤 모양으로 보여줄지 고르세요.</p>
        </header>

        <div className="df-picker">
          {GROUPS.map((group) => (
            <section key={group.label}>
              <h3>{group.label}</h3>
              <div className="df-picker__grid">
                {group.emoji.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      onPick(emoji)
                      onClose()
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>

        <footer className="df-modal__foot">
          {showReset && (
            <button
              type="button"
              className="df-btn df-btn--ghost"
              onClick={() => {
                onReset()
                onClose()
              }}
            >
              원래 아이콘으로
            </button>
          )}
          <button type="button" className="df-btn df-btn--go" onClick={onClose}>
            닫기
          </button>
        </footer>
      </div>
    </div>
  )
}
