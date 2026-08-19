/**
 * 편집 모드에서 빈 곳을 끌어 필드 만들기 + 타일을 다른 필드로 옮기기를 확인한다.
 *   node scripts/smoke-interact.mjs [출력.png]
 */
import { launch, resetState, wait } from './cdp.mjs'

const out = process.argv[2] ?? 'interact.png'
resetState()
const app = await launch()
await wait(1500)

// 자동 정리로 필드를 채운다.
await app.evaluate('document.querySelectorAll(".df-bar__btn")[1].click(), true')
await wait(900)
await app.evaluate(`[...document.querySelectorAll('.df-btn--go')].pop().click(), true`)
await wait(1800)

const count = () => app.evaluate('document.querySelectorAll(".df-field").length')
const before = await count()
console.log('자동 정리 후 필드:', before)

/* 1) ＋ 버튼으로 새 필드 만들기 */
await app.evaluate('document.querySelectorAll(".df-bar__btn")[0].click(), true')
await wait(400)
const drawn = await app.evaluate(`(() => {
  const f = [...document.querySelectorAll('.df-field')].pop()
  const r = f.getBoundingClientRect()
  return { title: f.querySelector('.df-field__title').value, w: Math.round(r.width), h: Math.round(r.height) }
})()`)
console.log('새 필드:', drawn, '(총', await count(), '개)')

/* 2) 타일을 다른 필드로 끌어 옮기기 */
const moveResult = await app.evaluate(`(() => {
  const fields = [...document.querySelectorAll('.df-field')]
  const from = fields.find((f) => f.querySelectorAll('.df-tile').length >= 2)
  const to = fields[fields.length - 1]
  const tile = from.querySelector('.df-tile')
  const name = tile.querySelector('.df-tile__name').textContent
  const beforeFrom = from.querySelectorAll('.df-tile').length

  const dt = new DataTransfer()
  tile.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }))
  const body = to.querySelector('.df-field__body')
  const r = body.getBoundingClientRect()
  const opts = { dataTransfer: dt, bubbles: true, clientX: r.x + 30, clientY: r.y + 30 }
  body.dispatchEvent(new DragEvent('dragover', opts))
  body.dispatchEvent(new DragEvent('drop', opts))
  tile.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }))

  return { name, beforeFrom, fromIndex: fields.indexOf(from) }
})()`)
await wait(600)

const after = await app.evaluate(`(() => {
  const fields = [...document.querySelectorAll('.df-field')]
  return {
    from: fields[${moveResult.fromIndex}].querySelectorAll('.df-tile').length,
    to: [...fields.pop().querySelectorAll('.df-tile__name')].map((n) => n.textContent),
  }
})()`)
console.log('옮긴 항목:', moveResult.name, '/ 원래 필드', moveResult.beforeFrom, '→', after.from)
console.log('받은 필드 내용:', after.to)

await app.shoot(out)
console.log('스크린샷:', out)

const checks = [
  ['필드 만들기', (await count()) === before + 1 && drawn.w > 250 && drawn.h > 180],
  ['항목 이동', after.from === moveResult.beforeFrom - 1 && after.to.includes(moveResult.name)],
]
for (const [label, ok] of checks) console.log(`${ok ? '통과' : '실패'} — ${label}`)

await app.close()
process.exit(checks.every(([, ok]) => ok) ? 0 : 1)
