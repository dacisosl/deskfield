import { build as esbuild } from 'esbuild'

/** 메인/프리로드 번들. 렌더러는 vite가 따로 굽는다. */
export async function buildMain({ sourcemap = false } = {}) {
  const common = {
    bundle: true,
    platform: 'node',
    target: 'node20',
    external: ['electron'],
    sourcemap,
    logLevel: 'warning',
  }

  // 메인도 CJS. Windows 패키지(asar) 안에서는 ESM 진입점이 로드되지 않는다.
  await esbuild({
    ...common,
    entryPoints: ['electron/main.ts'],
    outfile: 'dist/electron/main.cjs',
    format: 'cjs',
  })

  // 프리로드는 CommonJS로 — sandbox 환경에서 가장 확실하게 로드된다.
  await esbuild({
    ...common,
    entryPoints: ['electron/preload.ts'],
    outfile: 'dist/electron/preload.cjs',
    format: 'cjs',
  })
}
