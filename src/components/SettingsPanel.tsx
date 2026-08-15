import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Settings } from '../lib/types'

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
  onTidy: () => void
}

export function SettingsPanel({ settings, onChange, onClose, onTidy }: Props) {
  const [autostart, setAutostart] = useState(false)
  const [version, setVersion] = useState('')

  useEffect(() => {
    api.getAutostart().then(setAutostart)
    api.getVersion().then(setVersion)
  }, [])

  return (
    <div data-solid className="df-modal">
      <div className="df-modal__card df-modal__card--narrow">
        <header className="df-modal__head">
          <h2>설정</h2>
        </header>

        <div className="df-settings">
          <label className="df-row">
            <span>배경 진하기</span>
            <input
              type="range"
              min={0.2}
              max={0.9}
              step={0.05}
              value={settings.opacity}
              onChange={(e) => onChange({ opacity: Number(e.target.value) })}
            />
            <b>{Math.round(settings.opacity * 100)}%</b>
          </label>

          <label className="df-row">
            <span>아이콘 크기</span>
            <input
              type="range"
              min={68}
              max={140}
              step={4}
              value={settings.tile}
              onChange={(e) => onChange({ tile: Number(e.target.value) })}
            />
            <b>{settings.tile}px</b>
          </label>

          <label className="df-row df-row--check">
            <input
              type="checkbox"
              checked={settings.hideOriginals}
              onChange={(e) => onChange({ hideOriginals: e.target.checked })}
            />
            <span>
              필드에 담으면 바탕화면 원본 숨기기
              <small className="df-sub">파일은 옮기지 않고 숨김 표시만 합니다. 필드에서 빼면 다시 보입니다.</small>
            </span>
          </label>

          <label className="df-row df-row--check">
            <input
              type="checkbox"
              checked={settings.showBar}
              onChange={(e) => onChange({ showBar: e.target.checked })}
            />
            <span>
              오른쪽 아래 도구 막대 표시
              <small className="df-sub">꺼도 트레이 아이콘 우클릭으로 모든 기능을 쓸 수 있습니다.</small>
            </span>
          </label>

          <label className="df-row df-row--check">
            <input
              type="checkbox"
              checked={settings.labels}
              onChange={(e) => onChange({ labels: e.target.checked })}
            />
            <span>항목 이름 보이기</span>
          </label>

          <label className="df-row df-row--check">
            <input
              type="checkbox"
              checked={settings.snap}
              onChange={(e) => onChange({ snap: e.target.checked })}
            />
            <span>8px 격자에 맞춰 정렬</span>
          </label>

          <label className="df-row df-row--check">
            <input
              type="checkbox"
              checked={settings.locked}
              onChange={(e) => onChange({ locked: e.target.checked })}
            />
            <span>필드 잠그기 (이동·크기조절 막기)</span>
          </label>

          <label className="df-row df-row--check">
            <input
              type="checkbox"
              checked={autostart}
              onChange={async (e) => setAutostart(await api.setAutostart(e.target.checked))}
            />
            <span>윈도우 시작할 때 자동 실행</span>
          </label>

          <div className="df-row df-row--btns">
            <button type="button" className="df-btn df-btn--ghost" onClick={onTidy}>
              필드 반듯하게 배치
            </button>
            <button type="button" className="df-btn df-btn--ghost" onClick={() => void api.checkUpdate()}>
              업데이트 확인
            </button>
            <button type="button" className="df-btn df-btn--ghost" onClick={() => api.quit()}>
              앱 종료
            </button>
            {version && <span className="df-version">v{version}</span>}
          </div>

          <p className="df-hint">
            단축키 — <b>Ctrl+Alt+D</b> 편집 모드, <b>Ctrl+Alt+H</b> 필드 숨기기/보이기.
            <br />
            필드 밖 빈 자리는 그대로 바탕화면입니다. 원래 쓰던 아이콘과 우클릭 메뉴를 그대로 쓸 수
            있어요.
          </p>
        </div>

        <footer className="df-modal__foot">
          <button type="button" className="df-btn df-btn--go" onClick={onClose}>
            닫기
          </button>
        </footer>
      </div>
    </div>
  )
}
