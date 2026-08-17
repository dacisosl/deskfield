import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { ConfirmDialog } from './ConfirmDialog'
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
  const [confirmOff, setConfirmOff] = useState(false)

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
          <div className="df-row">
            <span>필드 모양</span>
            <div className="df-seg">
              <button
                type="button"
                className={settings.theme === 'pastel' ? 'df-seg__on' : ''}
                onClick={() => onChange({ theme: 'pastel' })}
              >
                파스텔
              </button>
              <button
                type="button"
                className={settings.theme === 'glass' ? 'df-seg__on' : ''}
                onClick={() => onChange({ theme: 'glass' })}
              >
                유리
              </button>
            </div>
          </div>

          {settings.theme === 'glass' && (
            <div className="df-row df-row--btns">
              <button
                type="button"
                className="df-btn df-btn--ghost"
                onClick={async () => {
                  const picked = await api.pickImage()
                  if (picked) onChange({ glassImage: picked })
                }}
              >
                유리 배경 그림 고르기
              </button>
              {settings.glassImage && (
                <button
                  type="button"
                  className="df-btn df-btn--ghost"
                  onClick={() => onChange({ glassImage: undefined })}
                >
                  바탕화면으로 되돌리기
                </button>
              )}
            </div>
          )}

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
              <small className="df-sub">앱이 켜져 있는 동안만 숨깁니다. 앱을 끄면 전부 다시 보이고, 켜면 다시 정리됩니다.</small>
            </span>
          </label>

          <label className="df-row df-row--check">
            <input
              type="checkbox"
              checked={settings.dimIdle}
              onChange={(e) => onChange({ dimIdle: e.target.checked })}
            />
            <span>
              다른 창을 쓸 때 흐리게
              <small className="df-sub">
                다른 프로그램 창이 앞에 오면 필드가 옅어지고, 바탕화면으로 돌아오면
                선명해집니다.
              </small>
            </span>
          </label>

          {settings.dimIdle && (
            <label className="df-row">
              <span>남길 정도</span>
              <input
                type="range"
                min={0}
                max={0.9}
                step={0.05}
                value={settings.dimLevel}
                onChange={(e) => onChange({ dimLevel: Number(e.target.value) })}
              />
              <b>{settings.dimLevel === 0 ? '숨김' : `${Math.round(settings.dimLevel * 100)}%`}</b>
            </label>
          )}

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
              onChange={async (e) => {
                // 끄는 건 확인을 받는다 — 앱이 안 켜지면 필드가 아예 보이지 않는다.
                if (!e.target.checked) {
                  setConfirmOff(true)
                  return
                }
                setAutostart(await api.setAutostart(true))
              }}
            />
            <span>
              윈도우 시작할 때 자동 실행 <b className="df-tag">권장</b>
              <small className="df-sub">
                필드는 이 앱이 켜져 있을 때만 보입니다. 꺼두면 컴퓨터를 켤 때마다 직접
                실행해야 합니다.
              </small>
            </span>
          </label>

          {!autostart && (
            <p className="df-warn">
              ⚠ 자동 실행이 꺼져 있습니다. 컴퓨터를 켠 뒤 <b>바탕 필드를 직접 실행</b>해야
              필드가 나타납니다. 실행 전까지는 바탕화면이 원래 상태(모든 아이콘이 보이는
              상태)로 표시됩니다.
            </p>
          )}

          <div className="df-row df-row--btns">
            <button type="button" className="df-btn df-btn--ghost" onClick={onTidy}>
              필드 반듯하게 배치
            </button>
            <button type="button" className="df-btn df-btn--ghost" onClick={() => void api.checkUpdate()}>
              지금 업데이트 확인
            </button>
            <button type="button" className="df-btn df-btn--ghost" onClick={() => api.quit()}>
              앱 종료
            </button>
            {version && <span className="df-version">v{version}</span>}
          </div>

          <p className="df-hint">
            압축 파일(zip) 안에서 바로 실행하면 업데이트가 설치되지 않습니다 — 반드시{' '}
            <b>압축을 풀어서</b> 쓰세요.
            <br />
            새 버전은 <b>알아서 받아서 설치</b>합니다 — 준비되면 알려주고 잠시 뒤 스스로 다시
            시작합니다. 위 버튼은 기다리지 않고 바로 확인할 때만 쓰세요.
            <br />
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

      {confirmOff && (
        <ConfirmDialog
          title="자동 실행을 끌까요?"
          body={
            '바탕 필드는 켜져 있을 때만 필드를 그립니다.\n' +
            '자동 실행을 끄면 컴퓨터를 켤 때마다 이 앱을 직접 실행해야 필드가 나타납니다.\n\n' +
            '앱이 꺼져 있는 동안에는 필드에 담아둔 파일도 바탕화면에 그대로 보입니다 — ' +
            '파일이 사라지지는 않습니다.'
          }
          confirmLabel="그래도 끄기"
          cancelLabel="켜 두기"
          danger
          onConfirm={async () => setAutostart(await api.setAutostart(false))}
          onClose={() => setConfirmOff(false)}
        />
      )}
    </div>
  )
}
