import { build as viteBuild } from 'vite'
import { buildMain } from './bundle-main.mjs'

await buildMain()
await viteBuild()
console.log('빌드 완료 → dist/')
