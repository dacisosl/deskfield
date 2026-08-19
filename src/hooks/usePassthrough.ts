import { useEffect, useRef } from 'react'
import { api } from '../lib/api'

/**
 * 마우스 통과 판정은 메인 프로세스가 좌표로 한다 (App이 단단한 영역을 보고).
 * 여기서는 두 가지만: 강제 캡처 상태 전달, 그리고 커서가 단단한 요소 위에
 * 있는지 알림(흐리기 해제용).
 */
export function usePassthrough(capture: boolean, onHover?: (over: boolean) => void) {
  const hoverRef = useRef(onHover)
  hoverRef.current = onHover

  useEffect(() => {
    api.setCapture(capture)
  }, [capture])

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const element = document.elementFromPoint(event.clientX, event.clientY)
      hoverRef.current?.(!!element?.closest('[data-solid]'))
    }
    window.addEventListener('mousemove', onMove, true)
    return () => window.removeEventListener('mousemove', onMove, true)
  }, [])
}
