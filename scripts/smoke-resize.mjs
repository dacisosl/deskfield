/**
 * 이동 → 폭 줄이기 → 높이 늘리기를 실제 드래그로 돌려보고,
 * 폭에 따라 타일이 다시 배치되는지(반응형) 확인한다.
 *   node scripts/smoke-resize.mjs [출력.png]
 */
import { launch, resetState, wait } from './cdp.mjs'

const out = process.argv[2] ?? 'resize.png'
resetState()
const app = await launch()
await wait(1500)

// 자동 정리로 필드를 채워 놓고 시작한다.
await app.evaluate('document.querySelectorAll(".df-bar__btn")[1].click(), true')
await wait(900)
await app.evaluate(`[...document.querySelectorAll('.df-btn--go')].pop().click(), true`)
await wait(1800)

// 항목이 가장 많은 필드를 고른다.
const index = await app.evaluate(`(() => {
  const fields = [...document.querySelectorAll('.df-field')]
  let best = 0
  fields.forEach((f, i) => {
    if (f.querySelectorAll('.df-tile').length > fields[best].querySelectorAll('.df-tile').length) best = i
  })
  return best
})()`)

const info = () =>
  app.evaluate(`(() => {
    const f = document.querySelectorAll('.df-field')[${index}]
    const r = f.getBoundingClientRect()
    const body = f.querySelector('.df-field__body')
    return {
      title: f.querySelector('.df-field__title').value,
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      cols: getComputedStyle(body).gridTemplateColumns.split(' ').length,
      tiles: f.querySelectorAll('.df-tile').length,
    }
  })()`)

const start = await info()
console.log('처음:', start)

// 1) 헤더를 잡고 아래쪽 빈 자리로 옮긴다 (이웃 필드와 손잡이가 겹치지 않게).
const target = { x: 80, y: 560 }
await app.drag(
  { x: start.x + start.w - 60, y: start.y + 18 },
  { x: target.x + start.w - 60, y: target.y + 18 },
)
const moved = await info()
console.log('이동:', moved)

// 2) 오른쪽 모서리를 잡고 폭을 줄인다 → 열 수가 줄어야 한다.
await app.drag(
  { x: moved.x + moved.w + 1, y: moved.y + moved.h / 2 },
  { x: moved.x + Math.round(moved.w * 0.45), y: moved.y + moved.h / 2 },
)
const narrow = await info()
console.log('좁힘:', narrow)

// 3) 아래 모서리를 잡고 높이를 키운다.
await app.drag(
  { x: narrow.x + narrow.w / 2, y: narrow.y + narrow.h + 1 },
  { x: narrow.x + narrow.w / 2, y: narrow.y + narrow.h + 130 },
)
const taller = await info()
console.log('키움:', taller)

await app.shoot(out)
console.log('스크린샷:', out)

// 화면 밖으로는 못 자라야 한다 — 기대 높이는 요청치와 남은 공간 중 작은 쪽.
const vh = await app.evaluate('window.innerHeight')
const expectedH = Math.min(narrow.h + 130, vh - narrow.y)

const checks = [
  // 끈 만큼 따라왔는가 — 시작 자리는 자동 배치에 따라 달라지므로 목표점과 견준다.
  ['이동', Math.abs(moved.x - target.x) <= 8 && Math.abs(moved.y - target.y) <= 8],
  ['폭 줄이기', narrow.w < moved.w - 60],
  ['열 재배치', narrow.cols < moved.cols],
  ['높이 늘리기(화면 안에서)', Math.abs(taller.h - expectedH) <= 10 && taller.h > narrow.h],
]
for (const [label, ok] of checks) console.log(`${ok ? '통과' : '실패'} — ${label}`)

await app.close()
process.exit(checks.every(([, ok]) => ok) ? 0 : 1)
