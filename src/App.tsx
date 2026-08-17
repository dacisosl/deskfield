import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ContextMenu, type MenuSpec } from './components/ContextMenu'
import { EmojiPicker } from './components/EmojiPicker'
import { RenameDialog } from './components/RenameDialog'
import { FieldBox } from './components/FieldBox'
import { ScanReview, type ScanResult } from './components/ScanReview'
import { SettingsPanel } from './components/SettingsPanel'
import { Toolbar } from './components/Toolbar'
import { useGlassBackdrop } from './hooks/useGlassBackdrop'
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
    refreshPortal,
  } = useFields()

  const [bounds, setBounds] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [editing, setEditing] = useState(false)
  const [gesture, setGesture] = useState(false)
  const [menu, setMenu] = useState<MenuSpec | null>(null)
  const [scanning, setScanning] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null)
  const [frontId, setFrontId] = useState<string | null>(null)
  const [pickerFor, setPickerFor] = useState<FieldItem | null>(null)
  const [renameFor, setRenameFor] = useState<FieldItem | null>(null)
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [dimmed, setDimmed] = useState(false)
  const draftStart = useRef<{ x: number; y: number } | null>(null)
  const dimTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const modalOpen = scanning || showSettings || !!pickerFor || !!renameFor
  const capture = editing || gesture || modalOpen || !!menu

  const glass = useGlassBackdrop(
    state.settings.theme === 'glass',
    bounds,
    state.settings.glassImage,
  )

  /** 커서가 필드에서 벗어난 채로 잠시 있으면 흐려진다. 다시 올리면 즉시 선명해진다. */
  const onHover = useCallback(
    (over: boolean) => {
      if (dimTimer.current) {
        clearTimeout(dimTimer.current)
        dimTimer.current = null
      }
      if (over || !stateRef.current.settings.dimIdle) {
        setDimmed(false)
        return
      }
      dimTimer.current = setTimeout(() => setDimmed(true), 1200)
    },
    [stateRef],
  )

  usePassthrough(capture, onHover)

  // 조작 중(편집·드래그·메뉴)에는 항상 선명하게.
  useEffect(() => {
    if (capture) setDimmed(false)
  }, [capture])

  useEffect(() => {
    const onResize = () => setBounds({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), toast.action ? 6000 : 2600)
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
      if (command === 'cmd:unhide-all') {
        const paths = stateRef.current.fields
          .filter((f) => !f.portal)
          .flatMap((f) => f.items)
          .filter((it) => !it.path.startsWith('shell:'))
          .map((it) => it.path)
        void api.setHiddenBatch(paths, false)
        setSettings({ hideOriginals: false })
        setToast({ text: '숨겨둔 원본을 모두 다시 보이게 했어요' })
      }
    })
  }, [newField, setSettings, stateRef])

  useEffect(() => {
    return api.onWorkAreaChange((rect) => setBounds({ w: rect.width, h: rect.height }))
  }, [])

  useEffect(() => {
    const offAvailable = api.onUpdateAvailable((version) => setUpdateVersion(version))
    const offNone = api.onUpdateNone(() => setToast({ text: '지금이 최신 버전이에요' }))
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
    if (error) setToast({ text: `열 수 없어요 — ${item.name}` })
  }, [])

  const applyScan = useCallback(
    async (groups: ScanResult[]) => {
      setScanning(false)
      const created = groups.map((group) => ({
        id: addField({ title: group.title, color: group.color, w: 340, h: 240 }, bounds),
        paths: group.paths,
      }))
      for (const entry of created) await addPaths(entry.id, entry.paths)
      setToast({ text: `필드 ${created.length}개를 만들었어요` })
    },
    [addField, addPaths, bounds],
  )

  /** 타일(또는 탐색기 파일)을 폴더 타일에 떨어뜨리면 실제로 그 폴더 안으로 옮긴다. */
  const dropInto = useCallback(
    async (folder: FieldItem, payload: { itemId?: string; paths?: string[] }) => {
      if (payload.itemId) {
        const owner = stateRef.current.fields.find((f) =>
          f.items.some((it) => it.id === payload.itemId),
        )
        const item = owner?.items.find((it) => it.id === payload.itemId)
        if (!owner || !item || item.path.startsWith('shell:')) return

        const result = await api.moveInto(item.path, folder.path)
        if (!result.ok || !result.newPath) {
          setToast({ text: result.error ?? '옮기지 못했어요' })
          return
        }
        const oldPath = item.path
        const fieldId = owner.id
        const moved = result.newPath
        if (owner.portal) void refreshPortal(owner.id)
        else removeItems([payload.itemId])
        setToast({
          text: `"${item.name}" → "${folder.name}" 폴더로 옮겼어요`,
          action: {
            label: '실행 취소',
            run: () => {
              void (async () => {
                const back = await api.moveInto(moved, oldPath.replace(/[\\/][^\\/]+$/, ''))
                if (back.ok && back.newPath) await addPaths(fieldId, [back.newPath])
                else setToast({ text: back.error ?? '되돌리지 못했어요' })
              })()
            },
          },
        })
        return
      }

      if (payload.paths?.length) {
        let moved = 0
        for (const src of payload.paths) {
          const result = await api.moveInto(src, folder.path)
          if (result.ok) moved += 1
        }
        setToast({
          text:
            moved === payload.paths.length
              ? `${moved}개를 "${folder.name}" 폴더로 옮겼어요`
              : `${moved}/${payload.paths.length}개만 옮겼어요`,
        })
      }
    },
    [addPaths, refreshPortal, removeItems, stateRef],
  )

  /** 실제 파일 이름 변경 — 타일과 파일이 함께 바뀐다. */
  const renameItem = useCallback(
    async (item: FieldItem, newName: string) => {
      const result = await api.renameItem(item.path, newName)
      if (!result.ok || !result.newPath) {
        setToast({ text: result.error ?? '이름을 바꾸지 못했어요' })
        return
      }
      const owner = stateRef.current.fields.find((f) => f.items.some((it) => it.id === item.id))
      if (owner?.portal) void refreshPortal(owner.id)
      else updateItem(item.id, { path: result.newPath, name: newName })
    },
    [refreshPortal, stateRef, updateItem],
  )

  const trashItem = useCallback(
    async (item: FieldItem) => {
      const result = await api.trashItem(item.path)
      if (!result.ok) {
        setToast({ text: result.error ?? '휴지통으로 보내지 못했어요' })
        return
      }
      const owner = stateRef.current.fields.find((f) => f.items.some((it) => it.id === item.id))
      if (owner?.portal) void refreshPortal(owner.id)
      else removeItems([item.id])
      setToast({ text: `"${item.name}"을(를) 휴지통으로 보냈어요` })
    },
    [refreshPortal, removeItems, stateRef],
  )

  const newFolderIn = useCallback(
    async (fieldId: string) => {
      const result = await api.newFolder()
      if (!result.ok || !result.newPath) {
        setToast({ text: result.error ?? '폴더를 만들지 못했어요' })
        return
      }
      await addPaths(fieldId, [result.newPath])
      // 만들어진 타일을 찾아 바로 이름 입력으로 — 바탕화면의 '새 폴더' 흐름 그대로
      setTimeout(() => {
        const created = stateRef.current.fields
          .flatMap((f) => f.items)
          .find((it) => it.path === result.newPath)
        if (created) setRenameFor(created)
      }, 120)
    },
    [addPaths, stateRef],
  )

  /** '원본 숨기기'를 켜고 끄면 이미 담아둔 항목 전체에 즉시 반영한다. */
  const changeSettings = useCallback(
    (patch: Partial<Settings>) => {
      if ('hideOriginals' in patch) {
        const paths = state.fields
          .filter((field) => !field.portal)
          .flatMap((field) => field.items)
          .filter((item) => !item.path.startsWith('shell:'))
          .map((item) => item.path)
        if (paths.length > 0) void api.setHiddenBatch(paths, !!patch.hideOriginals)
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
    if (field.portal) {
      setMenu({
        x,
        y,
        onColor: (color) => patchField(field.id, { color }),
        entries: [
          { label: '폴더 열기', onSelect: () => void api.open(field.portal as string) },
          { label: '새로 고침', onSelect: () => void refreshPortal(field.id) },
          {
            label: '포털 해제 (일반 필드로)',
            onSelect: () => patchField(field.id, { portal: undefined, items: [] }),
          },
          { label: '', separator: true },
          { label: field.collapsed ? '펼치기' : '접기', onSelect: () => patchField(field.id, { collapsed: !field.collapsed }) },
          { label: '', separator: true },
          { label: '필드 삭제', danger: true, onSelect: () => removeField(field.id) },
        ],
      })
      return
    }
    setMenu({
      x,
      y,
      onColor: (color) => patchField(field.id, { color }),
      entries: [
        {
          label: '폴더 비추기(포털)…',
          onSelect: async () => {
            const picked = await api.pick('folder')
            if (picked[0]) {
              const name = picked[0].split(/[\\/]/).filter(Boolean).pop() ?? picked[0]
              patchField(field.id, { portal: picked[0], title: name, items: [] })
            }
          },
        },
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
        { label: '새 폴더 만들기', onSelect: () => void newFolderIn(field.id) },
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
  }, [addPaths, addSpecial, clearField, newFolderIn, patchField, refreshPortal, removeField, sortField])

  const itemMenu = useCallback((item: FieldItem, x: number, y: number) => {
    const special = item.path.startsWith('shell:')
    const owner = stateRef.current.fields.find((f) => f.items.some((it) => it.id === item.id))
    const inPortal = !!owner?.portal
    setMenu({
      x,
      y,
      entries: [
        { label: '열기', onSelect: () => void openItem(item) },
        ...(special
          ? []
          : [{ label: '파일 위치 열기', onSelect: () => void api.reveal(item.path) }]),
        { label: '', separator: true },
        ...(special
          ? [{ label: '아이콘 바꾸기…', onSelect: () => setPickerFor(item) }]
          : [
              { label: '이름 바꾸기…', onSelect: () => setRenameFor(item) },
              // 포털 항목은 새로고침 때 다시 만들어져 이모지가 유지되지 않는다
              ...(inPortal ? [] : [{ label: '아이콘 바꾸기…', onSelect: () => setPickerFor(item) }]),
            ]),
        { label: '', separator: true },
        ...(inPortal ? [] : [{ label: '필드에서 빼기', onSelect: () => removeItems([item.id]) }]),
        ...(special
          ? []
          : [{ label: '휴지통으로 삭제', danger: true, onSelect: () => void trashItem(item) }]),
      ],
    })
  }, [openItem, removeItems, stateRef, trashItem])

  const dropPaths = useCallback(
    (id: string, paths: string[], index: number) => {
      const field = stateRef.current.fields.find((f) => f.id === id)
      if (field?.portal) {
        // 포털은 폴더 그 자체 — 떨어뜨리면 폴더 안으로 이동한다.
        const portal = field.portal
        void (async () => {
          let moved = 0
          for (const src of paths) {
            const result = await api.moveInto(src, portal)
            if (result.ok) moved += 1
          }
          setToast({ text: `${moved}개를 "${field.title}" 폴더로 옮겼어요` })
          void refreshPortal(id)
        })()
        return
      }
      void addPaths(id, paths, index)
    },
    [addPaths, refreshPortal, stateRef],
  )

  /** 필드 간 이동 — 포털이 얽히면 실제 파일 이동으로 바뀐다. */
  const moveItemSmart = useCallback(
    (itemId: string, toFieldId: string, index: number) => {
      const source = stateRef.current.fields.find((f) => f.items.some((it) => it.id === itemId))
      const target = stateRef.current.fields.find((f) => f.id === toFieldId)
      const item = source?.items.find((it) => it.id === itemId)
      if (!source || !target || !item) return

      if (target.portal) {
        if (source.id === target.id || item.path.startsWith('shell:')) return
        const portal = target.portal
        void (async () => {
          const result = await api.moveInto(item.path, portal)
          if (!result.ok) {
            setToast({ text: result.error ?? '옮기지 못했어요' })
            return
          }
          if (!source.portal) removeItems([itemId])
          setToast({ text: `"${item.name}"을(를) "${target.title}"(으)로 옮겼어요` })
          void refreshPortal(toFieldId)
          if (source.portal) void refreshPortal(source.id)
        })()
        return
      }

      if (source.portal) {
        // 포털에서 일반 필드로 끌면 참조로 담는다 (파일은 그대로).
        void addPaths(toFieldId, [item.path], index)
        return
      }

      moveItem(itemId, toFieldId, index)
    },
    [addPaths, moveItem, refreshPortal, removeItems, stateRef],
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
      className={`df-root ${editing ? 'df-root--edit' : ''} ${
        dimmed && state.settings.dimIdle ? 'df-root--dim' : ''
      }`}
      style={{ ['--dim' as string]: String(state.settings.dimLevel) } as React.CSSProperties}
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
        const owner = stateRef.current.fields.find((f) => f.items.some((it) => it.id === itemId))
        if (owner?.portal) {
          setToast({ text: '폴더 안 파일이에요 — 빼려면 다른 필드나 폴더로 옮기세요' })
          return
        }
        removeItems([itemId])
        setToast({ text: '필드에서 뺐어요 — 바탕화면에 다시 보입니다' })
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
          onMoveItem={moveItemSmart}
          onDropInto={dropInto}
          onGesture={setGesture}
          onRaise={setFrontId}
          raised={frontId === field.id}
          glass={glass}
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

      {renameFor && (
        <RenameDialog
          item={renameFor}
          onConfirm={(name) => void renameItem(renameFor, name)}
          onClose={() => setRenameFor(null)}
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
          <span>{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              className="df-toast__act"
              onClick={() => {
                toast.action?.run()
                setToast(null)
              }}
            >
              {toast.action.label}
            </button>
          )}
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
                    setToast({ text: '자동 적용에 실패해서 다운로드 페이지를 열었어요' })
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
