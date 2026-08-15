import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

/**
 * 앱 아이콘(build/icon.png)을 코드로 그린다.
 * 외부 디자인 툴 없이도 빌드가 재현되도록 의존성 없이 PNG를 직접 인코딩한다.
 */

const SIZE = 256
const SS = 3 // 슈퍼샘플링 배수 — 모서리 계단을 없애려고

const canvas = new Float32Array(SIZE * SIZE * 4)

function hex(value) {
  const v = value.replace('#', '')
  return [
    parseInt(v.slice(0, 2), 16) / 255,
    parseInt(v.slice(2, 4), 16) / 255,
    parseInt(v.slice(4, 6), 16) / 255,
  ]
}

/** 둥근 사각형 안쪽이면 true */
function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false
  const cx = Math.min(Math.max(px, x + r), x + w - r)
  const cy = Math.min(Math.max(py, y + r), y + h - r)
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy <= r * r
}

function fillRoundRect(x, y, w, h, r, color, alpha = 1) {
  const [cr, cg, cb] = hex(color)
  for (let py = 0; py < SIZE; py += 1) {
    for (let px = 0; px < SIZE; px += 1) {
      let hits = 0
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const fx = px + (sx + 0.5) / SS
          const fy = py + (sy + 0.5) / SS
          if (inRoundRect(fx, fy, x, y, w, h, r)) hits += 1
        }
      }
      if (hits === 0) continue

      const a = alpha * (hits / (SS * SS))
      const i = (py * SIZE + px) * 4
      const dst = canvas[i + 3]
      const out = a + dst * (1 - a)
      canvas[i] = (cr * a + canvas[i] * dst * (1 - a)) / (out || 1)
      canvas[i + 1] = (cg * a + canvas[i + 1] * dst * (1 - a)) / (out || 1)
      canvas[i + 2] = (cb * a + canvas[i + 2] * dst * (1 - a)) / (out || 1)
      canvas[i + 3] = out
    }
  }
}

// 필드 한 장 + 그 안에 파스텔 타일 네 개
fillRoundRect(18, 26, 220, 204, 34, '#B9AFE0', 0.35)
fillRoundRect(18, 26, 220, 196, 34, '#DCD6F2', 0.97)
fillRoundRect(40, 48, 92, 14, 7, '#6F68A8', 0.55)

fillRoundRect(40, 86, 78, 62, 16, '#CFE9DE')
fillRoundRect(138, 86, 78, 62, 16, '#F6DCCB')
fillRoundRect(40, 160, 78, 46, 16, '#D4E4F4')
fillRoundRect(138, 160, 78, 46, 16, '#F3E9C4')

/* ------------------------------------------------------------------ PNG 인코딩 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
let offset = 0
for (let y = 0; y < SIZE; y += 1) {
  raw[offset] = 0 // 필터: none
  offset += 1
  for (let x = 0; x < SIZE; x += 1) {
    const i = (y * SIZE + x) * 4
    raw[offset] = Math.round(canvas[i] * 255)
    raw[offset + 1] = Math.round(canvas[i + 1] * 255)
    raw[offset + 2] = Math.round(canvas[i + 2] * 255)
    raw[offset + 3] = Math.round(canvas[i + 3] * 255)
    offset += 4
  }
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', png)
console.log(`build/icon.png (${SIZE}×${SIZE}, ${png.length} bytes)`)
