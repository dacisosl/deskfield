/**
 * 실제 앱에서 '필드 반듯하게 배치'가 겹치지 않게 놓는지 확인한다.
 *   node scripts/smoke-arrange.mjs [출력.png]
 */
import { launch, resetState, wait } from './cdp.mjs'

const out = process.argv[2] ?? 'arrange.png'
resetState()
const app = await launch()
await wait(1500)

// 자동 정리로 필드를 여러 개 만든다.
await app.evaluate('document.querySelectorAll(".df-bar__btn")[1].click(), true')
await wait(900)
await app.evaluate(`[...document.querySelectorAll('.df-btn--go')].pop().click(), true`)
await wait(1800)

// 필드 머리글을 잡아 끌어 실제로 겹쳐 놓는다 (모니터가 빠졌을 때와 같은 상태).
const heads = await app.evaluate(`(() => {
  return [...document.querySelectorAll('.df-field')].slice(0, 3).map((f) => {
    const r = f.querySelector('.df-field__head').getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
})()`)
for (const head of heads) await app.drag(head, { x: 160, y: 120 })

const overlaps = () =>
  app.evaluate(`(() => {
    const rects = [...document.querySelectorAll('.df-field')].map((f) => f.getBoundingClientRect())
    let n = 0
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j]
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) n++
      }
    return { pairs: n, count: rects.length }
  })()`)

const before = await overlaps()
console.log('몰아 놓은 뒤 겹친 쌍:', before.pairs, '/ 필드', before.count, '개')

// 설정 → 필드 반듯하게 배치
await app.evaluate('document.querySelectorAll(".df-bar__btn")[3].click(), true')
await wait(500)
const clicked = await app.evaluate(`(() => {
  const btn = [...document.querySelectorAll('.df-btn--ghost')].find((b) => b.textContent.includes('반듯하게'))
  if (!btn) return false
  btn.click()
  return true
})()`)
await wait(700)

const after = await overlaps()
console.log('반듯하게 배치 후 겹친 쌍:', after.pairs)

const inside = await app.evaluate(`(() => {
  const rects = [...document.querySelectorAll('.df-field')].map((f) => f.getBoundingClientRect())
  return rects.every((r) => r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1)
})()`)

await app.shoot(out)
console.log('스크린샷:', out)

const checks = [
  ['몰아 놓으면 실제로 겹친다', before.pairs > 0],
  ['배치 단추를 찾았다', clicked === true],
  ['배치 후에는 겹치지 않는다', after.pairs === 0],
  ['모두 화면 안에 있다', inside === true],
]
for (const [label, ok] of checks) console.log(`${ok ? '통과' : '실패'} — ${label}`)

await app.close()
process.exit(checks.every(([, ok]) => ok) ? 0 : 1)
