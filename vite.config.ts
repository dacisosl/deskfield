import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // 패키징 후에는 file://에서 열리므로 상대 경로여야 한다.
  base: './',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    target: 'chrome120',
  },
  server: {
    port: 5273,
    strictPort: true,
  },
})
