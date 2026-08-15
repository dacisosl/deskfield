/**
 * 개발용 CDP 헬퍼. 실제 앱을 띄우고 렌더러를 조작·촬영한다.
 * 배포 결과물에는 포함되지 않는다(scripts/는 files 목록 밖).
 */
import { spawn } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import electronPath from 'electron'

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 저장된 필드 배치를 비운다 — 확인 스크립트를 같은 조건에서 돌리려고. */
export function resetState() {
  // 앞선 실행이 남긴 앱이 살아 있으면 지운 파일을 도로 저장한다. 먼저 정리.
  try {
    execSync('pkill -9 -f "remote-debugging-port=9333" || true', { stdio: 'ignore' })
  } catch {
    /* 없으면 그만 */
  }
  const roots = {
    linux: path.join(homedir(), '.config', 'DeskField'),
    darwin: path.join(homedir(), 'Library', 'Application Support', 'DeskField'),
    win32: path.join(process.env.APPDATA ?? '', 'DeskField'),
  }
  rmSync(path.join(roots[process.platform] ?? roots.linux, 'state.json'), { force: true })
}

export async function launch({ port = 9333, headless = true } = {}) {
  const args = ['.', '--no-sandbox', `--remote-debugging-port=${port}`]
  // 프로세스 그룹으로 띄운다. xvfb-run만 죽이면 electron이 살아남아 다음 실행을 가로챈다.
  const child = headless
    ? spawn('xvfb-run', ['-a', electronPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    : spawn(electronPath, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true })

  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))

  let page = null
  for (let i = 0; i < 40 && !page; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      page = list.find((target) => target.type === 'page')
    } catch {
      /* 아직 안 떴다 */
    }
    if (!page) await wait(500)
  }
  if (!page) throw new Error(`디버깅 대상 없음\n${log}`)

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

  const send = (method, params = {}) => {
    const id = (seq += 1)
    socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve) => pending.set(id, resolve))
  }

  const evaluate = async (expression) => {
    const reply = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (reply.result?.exceptionDetails) {
      throw new Error(JSON.stringify(reply.result.exceptionDetails.exception ?? reply.result.exceptionDetails))
    }
    return reply.result?.result?.value
  }

  const shoot = async (file) => {
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
    return file
  }

  /** 진짜 마우스 드래그 — 포인터 이벤트 경로를 그대로 태운다. */
  const drag = async (from, to, steps = 12) => {
    const mouse = (type, x, y) =>
      send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: 1, clickCount: 1 })
    await mouse('mousePressed', from.x, from.y)
    for (let i = 1; i <= steps; i += 1) {
      await mouse('mouseMoved', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)
      await wait(16)
    }
    await mouse('mouseReleased', to.x, to.y)
    await wait(120)
  }

  const close = async () => {
    socket.close()
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
    await wait(400)
  }

  return { send, evaluate, shoot, drag, close }
}
