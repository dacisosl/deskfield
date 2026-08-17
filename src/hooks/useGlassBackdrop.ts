import { useEffect, useState } from 'react'
import { api } from '../lib/api'

/**
 * 유리 모드용 배경. 투명 창에서는 CSS backdrop-filter가 흐리게 할 대상이
 * 없어서(창 뒤는 페이지가 아니라 바탕화면이다) 진짜 유리가 되지 않는다.
 * 그래서 바탕화면 그림을 직접 읽어 한 번만 흐리게 구워두고, 각 필드가 자기
 * 위치만큼 잘라 쓰게 한다 — 매 프레임 비용이 없고 결과는 진짜 프로스티드 글래스다.
 */
export function useGlassBackdrop(
  enabled: boolean,
  bounds: { w: number; h: number },
  override?: string,
) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || bounds.w === 0) {
      setUrl(null)
      return
    }
    let alive = true

    void (async () => {
      const source = override ? await api.readImage(override) : await api.getWallpaper()
      if (!alive) return
      if (!source) {
        // 바탕화면 그림을 못 찾으면(단색 배경·슬라이드쇼 등) 흰 유리로 떨어진다.
        setUrl(null)
        return
      }

      const image = new Image()
      image.onload = () => {
        if (!alive) return
        // 절반 해상도로 구워도 어차피 흐린 그림이라 차이가 안 보인다. 메모리·시간만 절약.
        const scale = 0.5
        const cw = Math.max(1, Math.round(bounds.w * scale))
        const ch = Math.max(1, Math.round(bounds.h * scale))
        const canvas = document.createElement('canvas')
        canvas.width = cw
        canvas.height = ch
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        // 화면을 꽉 채우도록(cover) 맞추고, 가장자리가 흐림 때문에 비치지 않게
        // 조금 넉넉히 그린다.
        const cover = Math.max(cw / image.width, ch / image.height) * 1.08
        const dw = image.width * cover
        const dh = image.height * cover
        ctx.filter = 'blur(16px) saturate(1.45) brightness(1.03)'
        ctx.drawImage(image, (cw - dw) / 2, (ch - dh) / 2, dw, dh)

        setUrl(canvas.toDataURL('image/jpeg', 0.72))
      }
      image.onerror = () => alive && setUrl(null)
      image.src = source
    })()

    return () => {
      alive = false
    }
  }, [enabled, bounds.w, bounds.h, override])

  return url
}
