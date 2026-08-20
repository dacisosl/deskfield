/**
 * 필드 배치 계산 확인 — 화면 없이 순수 함수만 돌린다.
 *   node scripts/test-arrange.mjs
 */
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const out = path.join(mkdtempSync(path.join(tmpdir(), 'df-arrange-')), 'arrange.mjs')
await build({
  entryPoints: ['src/lib/arrange.ts'],
  outfile: out,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'warning',
})
const A = await import(out)

let failed = 0
function check(label, ok, extra = '') {
  console.log(`${ok ? '통과' : '실패'} — ${label}${extra ? ` (${extra})` : ''}`)
  if (!ok) failed += 1
}

const field = (id, x, y, w = 320, h = 220, collapsed = false) => ({
  id,
  title: id,
  x,
  y,
  w,
  h,
  color: 'butter',
  collapsed,
  autoGrow: false,
  items: [],
})

/* 넓은 화면에 흩어져 있던 필드들 */
const wide = { w: 3840, h: 1080 }
const narrow = { w: 1920, h: 1080 }
const spread = [
  field('a', 40, 40),
  field('b', 1400, 40),
  field('c', 2600, 40),
  field('d', 3400, 500),
]

check('넓은 화면에서는 그대로 둔다', A.layoutIsFine(spread, wide))
check('좁은 화면으로 가면 손봐야 한다', !A.layoutIsFine(spread, narrow))

/* 예전 방식(각자 화면 안으로 밀어 넣기)이 어떻게 겹쳤는지 */
const clampOnly = spread.map((f) => ({
  ...f,
  x: Math.min(f.x, narrow.w - f.w),
  y: Math.min(f.y, narrow.h - f.h),
}))
check('예전 방식은 필드가 겹쳤다', !A.layoutIsFine(clampOnly, narrow))

/* 새 방식 */
const packed = A.packFields(A.fitSizes(spread, narrow), narrow, 24)
check('다시 채워 넣으면 겹치지 않는다', A.layoutIsFine(packed, narrow))
check('필드 수는 그대로', packed.length === spread.length)
check('항목을 잃지 않는다', packed.every((f, i) => f.id === spread[i].id))

/* 접힌 필드도 자리를 적게 쓴다 */
const withCollapsed = [field('a', 0, 0), field('b', 0, 0, 320, 600, true), field('c', 0, 0)]
const packedCollapsed = A.packFields(withCollapsed, narrow, 24)
check('접힌 필드가 있어도 겹치지 않는다', A.layoutIsFine(packedCollapsed, narrow))

/* 넓은 화면으로 돌아오면 쓰던 자리로 */
const snapshot = A.rememberLayout([], A.screenKey(wide), spread)[0]
check('화면 열쇠', snapshot.key === '3840x1080', snapshot.key)
const restored = A.applySnapshot(packed, snapshot, wide, 24)
check(
  '모니터를 다시 꽂으면 쓰던 자리로 돌아온다',
  restored.every((f) => {
    const was = spread.find((s) => s.id === f.id)
    return f.x === was.x && f.y === was.y
  }),
)

/* 그 사이 새로 만든 필드는 빈 자리로 */
const plusNew = [...packed, field('e', 0, 0)]
const restoredPlus = A.applySnapshot(plusNew, snapshot, wide, 24)
check('그 사이 만든 필드도 겹치지 않게 놓인다', A.layoutIsFine(restoredPlus, wide))
check('새 필드가 사라지지 않는다', restoredPlus.some((f) => f.id === 'e'))

/* 기억은 최근 것부터, 개수 제한 */
let layouts = []
for (let i = 0; i < A.MAX_LAYOUTS + 3; i += 1) {
  layouts = A.rememberLayout(layouts, `k${i}`, spread)
}
check('오래된 기억은 버린다', layouts.length === A.MAX_LAYOUTS, `${layouts.length}개`)
check('최근 것이 앞에 온다', layouts[0].key === `k${A.MAX_LAYOUTS + 2}`)

/* 화면보다 큰 필드 */
const huge = [field('big', 0, 0, 5000, 3000)]
const fitted = A.fitSizes(huge, narrow)
check('화면보다 큰 필드는 줄인다', fitted[0].w === narrow.w && fitted[0].h === narrow.h)

/* 바뀐 게 없으면 건드리지 않는다 */
check('같은 배치는 같다고 본다', A.sameLayout(spread, spread.map((f) => ({ ...f }))))
check('다른 배치는 다르다고 본다', !A.sameLayout(spread, packed))

/* 필드가 아주 많아도 화면 안에 */
const many = Array.from({ length: 24 }, (_, i) => field(`m${i}`, 0, 0))
const packedMany = A.packFields(many, narrow, 24)
check(
  '필드가 많아도 화면 밖으로 나가지 않는다',
  packedMany.every((f) => f.x >= 0 && f.y >= 0 && f.x + f.w <= narrow.w && f.y + f.h <= narrow.h),
)

process.exit(failed === 0 ? 0 : 1)
