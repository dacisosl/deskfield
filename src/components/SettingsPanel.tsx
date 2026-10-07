import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import { THEMES } from '../lib/palette'
import { ConfirmDialog } from './ConfirmDialog'
import type { Settings, Theme } from '../lib/types'

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
  onTidy: () => void
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="df-sec">
      <h3 className="df-sec__title">{title}</h3>
      {children}
    </section>
  )
}

function Slider(props: {
  label: string
  min: number
  max: number
  step: number
  value: number
  shown: string
  onChange: (value: number) => void
}) {
  return (
    <label className="df-row">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <b>{props.shown}</b>
    </label>
  )
}

function Check(props: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label className="df-row df-row--check">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span>{props.children}</span>
    </label>
  )
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
          <Section title="모양">
            <div className="df-row">
              <span>필드 디자인</span>
              <div className="df-themes">
                {(Object.keys(THEMES) as Theme[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`df-theme df-theme--${key} ${settings.theme === key ? 'df-theme--on' : ''}`}
                    onClick={() => onChange({ theme: key })}
                  >
                    <i style={{ background: THEMES[key].base, color: THEMES[key].ink }}>Aa</i>
                    {THEMES[key].label}
                  </button>
                ))}
              </div>
            </div>

            <Check checked={settings.glass} onChange={(glass) => onChange({ glass })}>
              유리 효과
              <small className="df-sub">바탕화면 그림을 흐리게 비춰 필드 뒤가 은은하게 보입니다.</small>
            </Check>

            {settings.glass && (
              <div className="df-row df-row--btns df-row--indent">
                <button
                  type="button"
                  className="df-btn df-btn--ghost df-btn--sm"
                  onClick={async () => {
                    const picked = await api.pickImage()
                    if (picked) onChange({ glassImage: picked })
                  }}
                >
                  비출 그림 직접 고르기
                </button>
                {settings.glassImage && (
                  <button
                    type="button"
                    className="df-btn df-btn--ghost df-btn--sm"
                    onClick={() => onChange({ glassImage: undefined })}
                  >
                    바탕화면으로 되돌리기
                  </button>
                )}
              </div>
            )}

            <Slider
              label="배경 진하기"
              min={0.2}
              max={0.95}
              step={0.05}
              value={settings.opacity}
              shown={`${Math.round(settings.opacity * 100)}%`}
              onChange={(opacity) => onChange({ opacity })}
            />
            <Slider
              label="아이콘 크기"
              min={68}
              max={140}
              step={4}
              value={settings.tile}
              shown={`${settings.tile}px`}
              onChange={(tile) => onChange({ tile })}
            />
            <Slider
              label="아이콘 간격"
              min={2}
              max={24}
              step={2}
              value={settings.iconGap}
              shown={`${settings.iconGap}px`}
              onChange={(iconGap) => onChange({ iconGap })}
            />
            <Slider
              label="필드 간격"
              min={8}
              max={48}
              step={4}
              value={settings.fieldGap}
              shown={`${settings.fieldGap}px`}
              onChange={(fieldGap) => onChange({ fieldGap })}
            />
            <Check checked={settings.labels} onChange={(labels) => onChange({ labels })}>
              항목 이름 보이기
            </Check>
          </Section>

          <Section title="바탕화면 원본">
            <Check checked={settings.hideOriginals} onChange={(hideOriginals) => onChange({ hideOriginals })}>
              필드에 담으면 바탕화면 원본 숨기기
              <small className="df-sub">앱이 켜져 있는 동안만 숨깁니다. 앱을 끄면 전부 다시 보입니다.</small>
            </Check>
            <Check checked={settings.searchLinks} onChange={(searchLinks) => onChange({ searchLinks })}>
              숨긴 항목도 검색되게 <b className="df-tag">권장</b>
              <small className="df-sub">
                숨긴 파일은 윈도우 검색·파일 열기 창에 안 나옵니다. 대신 사용자 폴더의{' '}
                <b>바탕 필드</b> 폴더에 필드별 바로가기를 만들어 시작 메뉴 검색과 파일 열기 창(빠른
                액세스)에서 찾을 수 있게 합니다.
              </small>
            </Check>
            {settings.searchLinks && (
              <div className="df-row df-row--btns df-row--indent">
                <button
                  type="button"
                  className="df-btn df-btn--ghost df-btn--sm"
                  onClick={() => void api.openSearchFolder()}
                >
                  바로가기 폴더 열기
                </button>
              </div>
            )}
          </Section>

          <Section title="동작">
            <Check checked={settings.dimIdle} onChange={(dimIdle) => onChange({ dimIdle })}>
              다른 창을 쓸 때 흐리게
              <small className="df-sub">다른 프로그램이 앞에 오면 옅어지고, 바탕화면으로 돌아오면 선명해집니다.</small>
            </Check>
            {settings.dimIdle && (
              <Slider
                label="남길 정도"
                min={0}
                max={0.9}
                step={0.05}
                value={settings.dimLevel}
                shown={settings.dimLevel === 0 ? '숨김' : `${Math.round(settings.dimLevel * 100)}%`}
                onChange={(dimLevel) => onChange({ dimLevel })}
              />
            )}
            <Check checked={settings.snap} onChange={(snap) => onChange({ snap })}>
              8px 격자에 맞춰 정렬
            </Check>
            <Check checked={settings.locked} onChange={(locked) => onChange({ locked })}>
              필드 잠그기 (이동·크기조절 막기)
            </Check>
            <Check checked={settings.showBar} onChange={(showBar) => onChange({ showBar })}>
              오른쪽 아래 도구 막대 표시
              <small className="df-sub">꺼도 트레이 아이콘 우클릭으로 모든 기능을 쓸 수 있습니다.</small>
            </Check>
          </Section>

          <Section title="시작">
            <Check
              checked={autostart}
              onChange={async (checked) => {
                // 끄는 건 확인을 받는다 — 앱이 안 켜지면 필드가 아예 보이지 않는다.
                if (!checked) {
                  setConfirmOff(true)
                  return
                }
                setAutostart(await api.setAutostart(true))
              }}
            >
              윈도우 시작할 때 가장 먼저 실행 <b className="df-tag">권장</b>
              <small className="df-sub">
                로그인하자마자 다른 시작 프로그램보다 먼저 떠서, 숨길 아이콘이 잠깐 보이는 시간을
                줄입니다.
              </small>
            </Check>
            {!autostart && (
              <p className="df-warn">
                ⚠ 자동 실행이 꺼져 있습니다. 컴퓨터를 켠 뒤 <b>바탕 필드를 직접 실행</b>해야 필드가
                나타납니다.
              </p>
            )}
          </Section>

          <Section title="관리">
            <div className="df-row df-row--btns">
              <button type="button" className="df-btn df-btn--ghost df-btn--sm" onClick={onTidy}>
                필드 반듯하게 배치
              </button>
              <button
                type="button"
                className="df-btn df-btn--ghost df-btn--sm"
                onClick={async () => {
                  await api.refreshIcons()
                  location.reload()
                }}
                title="폴더에 그림을 새로 달았거나 프로그램을 다시 깐 뒤에 쓰세요"
              >
                아이콘 다시 읽기
              </button>
              <button type="button" className="df-btn df-btn--ghost df-btn--sm" onClick={() => void api.checkUpdate()}>
                업데이트 확인
              </button>
              <button type="button" className="df-btn df-btn--ghost df-btn--sm" onClick={() => api.quit()}>
                앱 종료
              </button>
            </div>
            <p className="df-hint">
              단축키 — <b>Ctrl+Alt+D</b> 편집 모드, <b>Ctrl+Alt+H</b> 필드 숨기기/보이기.
              <br />
              새 버전은 알아서 받아 설치합니다. zip으로 받았다면 반드시 <b>압축을 풀어서</b> 쓰세요.
            </p>
          </Section>
        </div>

        <footer className="df-modal__foot">
          {version && <span className="df-version">v{version}</span>}
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
