import { useEffect, useMemo, useState } from 'react'
import { api, type ScanEntry } from '../lib/api'
import { classify, type Suggestion } from '../lib/classify'
import { PALETTE, pastel } from '../lib/palette'

export interface ScanResult {
  title: string
  color: string
  paths: string[]
}

interface Override {
  enabled?: boolean
  title?: string
  color?: string
}

interface Props {
  taken: Set<string>
  onCancel: () => void
  onApply: (groups: ScanResult[]) => void
}

export function ScanReview({ taken, onCancel, onApply }: Props) {
  const [entries, setEntries] = useState<ScanEntry[] | null>(null)
  const [recent, setRecent] = useState(true)
  const [days, setDays] = useState(7)
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  useEffect(() => {
    api.scanDesktop().then(setEntries)
  }, [])

  const groups = useMemo<Suggestion[]>(() => {
    if (!entries) return []
    return classify(entries, { recent, recentDays: days, taken })
  }, [entries, recent, days, taken])

  const view = groups.map((group) => {
    const override = overrides[group.key] ?? {}
    return {
      ...group,
      enabled: override.enabled ?? group.enabled,
      title: override.title ?? group.title,
      color: override.color ?? group.color,
      entries: group.entries.filter((entry) => !excluded.has(entry.path)),
    }
  })

  const chosen = view.filter((group) => group.enabled && group.entries.length > 0)
  const total = chosen.reduce((sum, group) => sum + group.entries.length, 0)

  function patch(key: string, next: Override) {
    setOverrides((prev) => ({ ...prev, [key]: { ...prev[key], ...next } }))
  }

  return (
    <div data-solid className="df-modal">
      <div className="df-modal__card">
        <header className="df-modal__head">
          <h2>바탕화면 자동 정리</h2>
          <p>
            바탕화면을 훑어 이렇게 묶어봤어요. 그대로 두거나, 이름·색을 고치고 필요 없는 그룹은
            꺼둔 다음 적용하세요. <strong>파일은 옮기지 않고 필드에만 담깁니다.</strong>
          </p>
        </header>

        <div className="df-modal__opts">
          <label className="df-check">
            <input type="checkbox" checked={recent} onChange={(e) => setRecent(e.target.checked)} />
            최근 <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              onFocus={() => api.setFocusable(true)}
              onBlur={() => api.setFocusable(false)}
            >
              <option value={3}>3일</option>
              <option value={7}>7일</option>
              <option value={14}>14일</option>
              <option value={30}>30일</option>
            </select>{' '}
            안에 손댄 항목은 <b>작성중</b>으로 먼저 묶기
          </label>
        </div>

        <div className="df-modal__list">
          {entries === null && <p className="df-modal__msg">바탕화면을 읽는 중…</p>}
          {entries !== null && view.length === 0 && (
            <p className="df-modal__msg">정리할 항목이 없어요. 이미 전부 필드에 들어가 있습니다.</p>
          )}

          {view.map((group) => {
            const tone = pastel(group.color)
            return (
              <section
                key={group.key}
                className={`df-group ${group.enabled ? '' : 'df-group--off'}`}
                style={{ background: `${tone.base}66`, borderColor: `${tone.base}` }}
              >
                <header className="df-group__head">
                  <input
                    type="checkbox"
                    checked={group.enabled}
                    onChange={(e) => patch(group.key, { enabled: e.target.checked })}
                  />
                  <input
                    className="df-group__title"
                    value={group.title}
                    style={{ color: tone.ink }}
                    onChange={(e) => patch(group.key, { title: e.target.value })}
                    onFocus={() => api.setFocusable(true)}
                    onBlur={() => api.setFocusable(false)}
                  />
                  <span className="df-group__count">{group.entries.length}개</span>
                  <span className="df-group__colors">
                    {PALETTE.map((color) => (
                      <button
                        key={color.key}
                        type="button"
                        title={color.label}
                        className={`df-swatch ${color.key === group.color ? 'df-swatch--on' : ''}`}
                        style={{ background: color.base }}
                        onClick={() => patch(group.key, { color: color.key })}
                      />
                    ))}
                  </span>
                </header>

                <ul className="df-group__chips">
                  {group.entries.slice(0, 40).map((entry) => (
                    <li key={entry.path} title={entry.path}>
                      <span>{entry.isDirectory ? '📁' : '📄'}</span>
                      <span className="df-chip__name">{entry.name}</span>
                      <button
                        type="button"
                        title="이 항목은 빼기"
                        onClick={() =>
                          setExcluded((prev) => new Set(prev).add(entry.path))
                        }
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                  {group.entries.length > 40 && (
                    <li className="df-chip--more">외 {group.entries.length - 40}개</li>
                  )}
                </ul>
              </section>
            )
          })}
        </div>

        <footer className="df-modal__foot">
          <span className="df-modal__sum">
            {chosen.length}개 필드 · 항목 {total}개
          </span>
          {excluded.size > 0 && (
            <button type="button" className="df-btn df-btn--ghost" onClick={() => setExcluded(new Set())}>
              뺀 항목 되돌리기
            </button>
          )}
          <button type="button" className="df-btn df-btn--ghost" onClick={onCancel}>
            취소
          </button>
          <button
            type="button"
            className="df-btn df-btn--go"
            disabled={chosen.length === 0}
            onClick={() =>
              onApply(
                chosen.map((group) => ({
                  title: group.title,
                  color: group.color,
                  paths: group.entries.map((entry) => entry.path),
                })),
              )
            }
          >
            이대로 필드 만들기
          </button>
        </footer>
      </div>
    </div>
  )
}
