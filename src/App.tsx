import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ContextMenu, type MenuSpec } from './components/ContextMenu'
import { EmojiPicker } from './components/EmojiPicker'
import { FieldBox } from './components/FieldBox'
import { ScanReview, type ScanResult } from './components/ScanReview'
import { SettingsPanel } from './components/SettingsPanel'
import { Toolbar } from './components/Toolbar'
import { usePassthrough } from './hooks/usePassthrough'
import { api } from './lib/api'
import { clamp, snapTo } from './lib/layout'
import { MIN_H, MIN_W, type Field, type FieldItem, type Settings } from './lib/types'
import { useFields } from './state/useFields'

interface Draft {
  x: number
  y: number
  w: number
  h: number
}

export default function App() {
  const {
    state,
    stateRef,
    loaded,
    addField,
    patchField,
    removeField,
    clearField,
    addSpecial,
    updateItem,
    addPaths,
    moveItem,
    removeItems,
    sortField,
    setSettings,
    replaceFields,
  } = useFields()

  const [bounds, setBounds] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [editing, setEditing] = useState(false)
  const [gesture, setGesture] = useState(false)
  const [menu, setMenu] = useState<MenuSpec | null>(null)
  const [scanning, setScanning] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [frontId, setFrontId] = useState<string | null>(null)
  const [pickerFor, setPickerFor] = useState<FieldItem | null>(null)
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const draftStart = useRef<{ x: number; y: number } | null>(null)

  const modalOpen = scanning || showSettings || !!pickerFor
  usePassthrough(editing || gesture || modalOpen || !!menu)

  useEffect(() => {
    const onResize = () => setBounds({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(timer)
  }, [toast])

  const takenPaths = useMemo(() => {
    const set = new Set<string>()
    for (const field of state.fields) {
      for (const item of field.items) set.add(item.path.toLowerCase())
    }
    return set
  }, [state.fields])

  const newField = useCallback(() => {
    addField({}, bounds)
  }, [addField, bounds])

  // 트레이 메뉴·단축키에서 오는 명령
  useEffect(() => {
    return api.onCommand((command) => {
      if (command === 'cmd:toggle-edit') setEditing((prev) => !prev)
      if (command === 'cmd:new-field') newField()
      if (command === 'cmd:scan') setScanning(true)
      if (command === 'cmd:settings') setShowSettings(true)
      if (command === 'cmd:toggle-bar') setSettings({ showBar: !stateRef.current.settings.showBar })
    })
  }, [newField, setSettings, stateRef])

  useEffect(() => {
    return api.onWorkAreaChange((rect) => setBounds({ w: rect.width, h: rect.height }))
  }, [])

  useEffect(() => {
    const offAvailable = api.onUpdateAvailable((version) => setUpdateVersion(version))
    const offNone = api.onUpdateNone(() => setToast('지금이 최신 버전이에요'))
    return () => {
      offAvailable()
      offNone()
    }
  }, [])

  // 해상도가 바뀌면 화면 밖으로 나간 필드를 안으로 끌어온다.
  useEffect(() => {
    if (!loaded) return
    replaceFields((fields) =>
      fields.map((field) => {
        const w = Math.min(field.w, bounds.w)
        const h = Math.min(field.h, bounds.h)
        return {
          ...field,
          w,
          h,
          x: clamp(field.x, 0, Math.max(0, bounds.w - w)),
          y: clamp(field.y, 0, Math.max(0, bounds.h - h)),
        }
      }),
    )
  }, [bounds.w, bounds.h, loaded, replaceFields])

  const openItem = useCallback(async (item: FieldItem) => {
    const error = await api.open(item.path)
    if (error) setToast(`열 수 없어요 — ${item.name}`)
  }, [])

  const applyScan = useCallback(
    async (groups: ScanResult[]) => {
      setScanning(false)
      const created = groups.map((group) => ({
        id: addField({ title: group.title, color: group.color, w: 340, h: 240 }, bounds),
        paths: group.paths,
      }))
      for (const entry of created) await addPaths(entry.id, entry.paths)
      setToast(`필드 ${created.length}개를 만들었어요`)
    },
    [addField, addPaths, bounds],
  )

  /** '원본 숨기기'를 켜고 끄면 이미 담아둔 항목 전체에 즉시 반영한다. */
  const changeSettings = useCallback(
    (patch: Partial<Settings>) => {
      if ('hideOriginals' in patch) {
        const hide = !!patch.hideOriginals
        for (const field of state.fields) {
          for (const item of field.items) {
            if (!item.path.startsWith('shell:')) void api.setHidden(item.path, hide)
          }
        }
      }
      setSettings(patch)
    },
    [setSettings, state.fields],
  )

  const tidy = useCallback(() => {
    const gapX = 24
    const gapY = 24
    let x = gapX
    let y = gapY
    let rowH = 0
    replaceFields((fields) =>
      fields.map((field) => {
        if (x + field.w > bounds.w - gapX && x > gapX) {
          x = gapX
          y += rowH + gapY
          rowH = 0
        }
        const placed = { ...field, x, y: Math.min(y, Math.max(0, bounds.h - field.h)) }
        x += field.w + gapX
        rowH = Math.max(rowH, field.collapsed ? 40 : field.h)
        return placed
      }),
    )
    setShowSettings(false)
  }, [bounds.h, bounds.w, replaceFields])

  const fieldMenu = useCallback((field: Field, x: number, y: number) => {
    setMenu({
      x,
      y,
      onColor: (color) => patchField(field.id, { color }),
      entries: [
        {
          label: '파일 추가…',
          onSelect: async () => {
            const paths = await api.pick('file')
            if (paths.length) await addPaths(field.id, paths)
          },
        },
        {
          label: '폴더 추가…',
          onSelect: async () => {
            const paths = await api.pick('folder')
            if (paths.length) await addPaths(field.id, paths)
          },
        },
        {
          label: '휴지통 타일 추가',
          onSelect: () =>
            addSpecial(field.id, { path: 'shell:RecycleBin', name: '휴지통', kind: 'file', emoji: '🗑️' }),
        },
        { label: '', separator: true },
        { label: '이름순 정렬', onSelect: () => sortField(field.id, 'name') },
        { label: '폴더 먼저 정렬', onSelect: () => sortField(field.id, 'kind') },
        {
          label: field.autoGrow ? '자동 높이 끄기' : '자동 높이 켜기',
          onSelect: () => patchField(field.id, { autoGrow: !field.autoGrow }),
        },
        { label: field.collapsed ? '펼치기' : '접기', onSelect: () => patchField(field.id, { collapsed: !field.collapsed }) },
        { label: '', separator: true },
        {
          label: '항목 모두 비우기',
          onSelect: () => clearField(field.id),
        },
        { label: '필드 삭제', danger: true, onSelect: () => removeField(field.id) },
      ],
    })
  }, [addPaths, addSpecial, clearField, patchField, removeField, sortField])

  const itemMenu = useCallback((item: FieldItem, x: number, y: number) => {
    const special = item.path.startsWith('shell:')
    setMenu({
      x,
      y,
      entries: [
        { label: '열기', onSelect: () => void openItem(item) },
        ...(special
          ? []
          : [{ label: '파일 위치 열기', onSelect: () => void api.reveal(item.path) }]),
        { label: '', separator: true },
        { label: '아이콘 바꾸기…', onSelect: () => setPickerFor(item) },
        { label: '', separator: true },
        { label: '필드에서 빼기', danger: true, onSelect: () => removeItems([item.id]) },
      ],
    })
  }, [openItem, removeItems])

  const dropPaths = useCallback(
    (id: string, paths: string[], index: number) => void addPaths(id, paths, index),
    [addPaths],
  )

  /** 편집 모드에서 빈 곳을 끌면 그 크기대로 새 필드를 만든다. */
  function startDraft(event: ReactPointerEvent<HTMLDivElement>) {
    if (!editing || event.button !== 0 || state.settings.locked) return
    if ((event.target as HTMLElement).closest('[data-solid]')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    draftStart.current = { x: event.clientX, y: event.clientY }
    setDraft({ x: event.clientX, y: event.clientY, w: 0, h: 0 })
  }

  function moveDraft(event: ReactPointerEvent<HTMLDivElement>) {
    const start = draftStart.current
    if (!start) return
    const snap = state.settings.snap
    const x = snapTo(Math.min(start.x, event.clientX), snap)
    const y = snapTo(Math.min(start.y, event.clientY), snap)
    setDraft({
      x,
      y,
      w: snapTo(Math.abs(event.clientX - start.x), snap),
      h: snapTo(Math.abs(event.clientY - start.y), snap),
    })
  }

  function endDraft() {
    const box = draft
    draftStart.current = null
    setDraft(null)
    if (!box) return
    if (box.w < MIN_W || box.h < MIN_H) return
    addField({ x: box.x, y: box.y, w: box.w, h: box.h }, bounds)
  }

  return (
    <div
      className={`df-root ${editing ? 'df-root--edit' : ''}`}
      onPointerDown={startDraft}
      onPointerMove={moveDraft}
      onPointerUp={endDraft}
      onPointerCancel={endDraft}
      onDragOver={(event) => {
        // 필드 밖으로 끌고 나온 타일 — 놓으면 필드에서 뺀다
        if (event.dataTransfer.types.includes('application/x-deskfield-item')) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }
      }}
      onDrop={(event) => {
        const itemId = event.dataTransfer.getData('application/x-deskfield-item')
        if (!itemId) return
        event.preventDefault()
        removeItems([itemId])
        setToast('필드에서 뺐어요 — 바탕화면에 다시 보입니다')
      }}
    >
      {state.fields.map((field) => (
        <FieldBox
          key={field.id}
          field={field}
          settings={state.settings}
          bounds={bounds}
          onPatch={patchField}
          onOpen={openItem}
          onItemMenu={itemMenu}
          onFieldMenu={fieldMenu}
          onDropPaths={dropPaths}
          onMoveItem={moveItem}
          onGesture={setGesture}
          onRaise={setFrontId}
          raised={frontId === field.id}
        />
      ))}

      {draft && (
        <div className="df-draft" style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h }} />
      )}

      {editing && (
        <p className="df-editnote" data-solid>
          편집 모드 — 빈 곳을 드래그하면 필드가 만들어집니다. 끝내려면 Ctrl+Alt+D 또는 ✎ 버튼.
        </p>
      )}

      {state.settings.showBar && (
      <Toolbar
        editing={editing}
        locked={state.settings.locked}
        onToggleEdit={() => setEditing((prev) => !prev)}
        onNewField={newField}
        onScan={() => setScanning(true)}
        onToggleLock={() => setSettings({ locked: !state.settings.locked })}
        onSettings={() => setShowSettings(true)}
      />
      )}

      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}

      {scanning && (
        <ScanReview taken={takenPaths} onCancel={() => setScanning(false)} onApply={applyScan} />
      )}

      {showSettings && (
        <SettingsPanel
          settings={state.settings}
          onChange={changeSettings}
          onClose={() => setShowSettings(false)}
          onTidy={tidy}
        />
      )}

      {pickerFor && (
        <EmojiPicker
          showReset={!!pickerFor.emoji}
          onPick={(emoji) => updateItem(pickerFor.id, { emoji })}
          onReset={() => updateItem(pickerFor.id, { emoji: undefined })}
          onClose={() => setPickerFor(null)}
        />
      )}

      {toast && (
        <div className="df-toast" data-solid>
          {toast}
        </div>
      )}

      {updateVersion && (
        <div className="df-update" data-solid>
          <span>
            새 버전 <b>v{updateVersion}</b>이 나왔어요
          </span>
          {updateBusy ? (
            <span className="df-update__busy">내려받는 중… 잠시 후 자동으로 다시 켜집니다</span>
          ) : (
            <>
              <button
                type="button"
                className="df-btn df-btn--go"
                onClick={async () => {
                  setUpdateBusy(true)
                  const ok = await api.applyUpdate()
                  if (!ok) {
                    setUpdateBusy(false)
                    setToast('자동 적용에 실패해서 다운로드 페이지를 열었어요')
                    setUpdateVersion(null)
                  }
                }}
              >
                지금 업데이트
              </button>
              <button type="button" className="df-btn df-btn--ghost" onClick={() => setUpdateVersion(null)}>
                나중에
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
