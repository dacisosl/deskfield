/**
 * 개발용 확인 스크립트. 실제 메인 프로세스를 띄우고 CDP로 붙어
 * 렌더러가 정상 동작하는지(스크린샷 + 상태) 확인한다. 배포에는 포함되지 않는다.
 *
 *   node scripts/smoke.mjs [출력.png]
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import electronPath from 'electron'

const out = process.argv[2] ?? 'smoke.png'
const PORT = 9333

const child = spawn('xvfb-run', ['-a', electronPath, '.', '--no-sandbox', `--remote-debugging-port=${PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
})

let log = ''
child.stdout.on('data', (d) => (log += d))
child.stderr.on('data', (d) => (log += d))

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function targets() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page
    } catch {
      /* 아직 안 떴다 */
    }
    await wait(500)
  }
  throw new Error(`디버깅 대상 없음\n${log}`)
}

const page = await targets()
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})

let seq = 0
const pending = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  const resolve = pending.get(message.id)
  if (resolve) {
    pending.delete(message.id)
    resolve(message)
  }
}

function send(method, params = {}) {
  const id = (seq += 1)
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve) => pending.set(id, resolve))
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails))
  return result.result?.result?.value
}

await wait(1500)

console.log('preload 노출:', await evaluate('Object.keys(window.deskfield ?? {}).length + "개 API"'))
console.log('바탕화면 스캔:', await evaluate('window.deskfield.scanDesktop().then(r => r.length + "개 항목")'))

const click = (selector, index = 0) =>
  evaluate(`document.querySelectorAll(${JSON.stringify(selector)})[${index}].click(), true`)

// 자동 정리 버튼 → 검토 화면
await click('.df-bar__btn', 1)
await wait(900)
const groups = await evaluate('document.querySelectorAll(".df-group").length')
console.log('추천 그룹:', groups)
const shotA = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(out.replace(/\.png$/, '-scan.png'), Buffer.from(shotA.result.data, 'base64'))

// 적용
await evaluate(`[...document.querySelectorAll('.df-btn--go')].pop().click(), true`)
await wait(1800)
console.log('필드 개수:', await evaluate('document.querySelectorAll(".df-field").length'))
console.log('타일 개수:', await evaluate('document.querySelectorAll(".df-tile").length'))
console.log('필드 제목:', await evaluate('[...document.querySelectorAll(".df-field__title")].map(i => i.value).join(", ")'))

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
console.log('스크린샷:', out)

socket.close()
child.kill('SIGTERM')
await wait(300)
process.exit(0)
