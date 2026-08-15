import { spawn } from 'node:child_process'
import electronPath from 'electron'
import { createServer } from 'vite'
import { buildMain } from './bundle-main.mjs'

const server = await createServer()
await server.listen()

const url = server.resolvedUrls?.local?.[0]
if (!url) throw new Error('vite 개발 서버 주소를 찾지 못했습니다')

await buildMain({ sourcemap: true })

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
})

child.on('close', async () => {
  await server.close()
  process.exit(0)
})
