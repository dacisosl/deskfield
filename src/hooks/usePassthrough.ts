import { useEffect, useRef } from 'react'
import { api } from '../lib/api'

/**
 * 창은 화면 전체를 덮고 있으므로, 필드가 아닌 곳에서는 마우스를 바탕화면으로
 * 통과시켜야 실제 아이콘과 우클릭 메뉴를 그대로 쓸 수 있다.
 * `data-solid`가 붙은 요소 위에 커서가 있을 때만 창이 입력을 받는다.
 */
export function usePassthrough(capture: boolean, onHover?: (over: boolean) => void) {
  const ignoring = useRef(true)
  const hoverRef = useRef(onHover)
  hoverRef.current = onHover

  useEffect(() => {
    const apply = (ignore: boolean) => {
      // 히트 판정은 흐리기에도 그대로 쓴다 — 같은 판정을 두 번 하지 않으려고.
      hoverRef.current?.(!ignore)
      if (ignoring.current === ignore) return
      ignoring.current = ignore
      api.setIgnoreMouse(ignore)
    }

    if (capture) {
      apply(false)
      return
    }

    const hitTest = (x: number, y: number) => {
      const element = document.elementFromPoint(x, y)
      apply(!element?.closest('[data-solid]'))
    }

    const onMove = (event: MouseEvent) => hitTest(event.clientX, event.clientY)
    // 탐색기에서 파일을 끌고 오는 중에도 필드 위에서는 창이 드롭 대상이 되어야 한다.
    const onDrag = (event: DragEvent) => hitTest(event.clientX, event.clientY)
    const onLeave = () => apply(true)

    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('dragover', onDrag, true)
    document.addEventListener('mouseleave', onLeave)

    return () => {
      window.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('dragover', onDrag, true)
      document.removeEventListener('mouseleave', onLeave)
    }
  }, [capture])
}
