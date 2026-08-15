import type { ScanEntry } from './api'

export interface Suggestion {
  key: string
  title: string
  color: string
  entries: ScanEntry[]
  /** 검토 화면에서 이 그룹을 실제로 만들지 여부 */
  enabled: boolean
}

interface Rule {
  key: string
  title: string
  color: string
  folder?: boolean
  ext?: string[]
}

/** 위에서부터 먼저 맞는 규칙이 항목을 가져간다. */
const RULES: Rule[] = [
  { key: 'folder', title: '폴더', color: 'lavender', folder: true },
  {
    key: 'doc',
    title: '문서',
    color: 'sky',
    ext: ['hwp', 'hwpx', 'doc', 'docx', 'pdf', 'txt', 'md', 'rtf', 'odt', 'tex'],
  },
  {
    key: 'sheet',
    title: '표·발표자료',
    color: 'mint',
    ext: ['xls', 'xlsx', 'xlsm', 'csv', 'ppt', 'pptx', 'odp', 'ods'],
  },
  {
    key: 'image',
    title: '이미지',
    color: 'peach',
    ext: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'tif', 'tiff', 'psd', 'ai'],
  },
  {
    key: 'media',
    title: '영상·음악',
    color: 'rose',
    ext: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'mp3', 'wav', 'flac', 'm4a', 'ogg'],
  },
  { key: 'archive', title: '압축파일', color: 'clay', ext: ['zip', '7z', 'rar', 'tar', 'gz', 'alz', 'egg'] },
  { key: 'shortcut', title: '바로가기', color: 'sage', ext: ['lnk', 'url', 'website'] },
  { key: 'app', title: '프로그램·설치파일', color: 'lemon', ext: ['exe', 'msi', 'bat', 'cmd', 'ps1', 'jar'] },
]

const FALLBACK: Rule = { key: 'etc', title: '기타', color: 'clay' }

const extIndex = new Map<string, Rule>()
for (const rule of RULES) {
  for (const ext of rule.ext ?? []) extIndex.set(ext, rule)
}

function ruleFor(entry: ScanEntry): Rule {
  if (entry.isDirectory) return RULES[0]
  return extIndex.get(entry.ext) ?? FALLBACK
}

export interface ClassifyOptions {
  /** '최근 작업' 그룹을 먼저 뽑을지 */
  recent: boolean
  recentDays: number
  /** 이미 다른 필드에 들어 있는 경로(소문자) — 중복 배치를 막는다. */
  taken?: Set<string>
}

/**
 * 바탕화면 스캔 결과를 추천 그룹으로 나눈다. 순수 함수라 검토 화면에서
 * 옵션을 바꿀 때마다 다시 돌려도 결과가 흔들리지 않는다.
 */
export function classify(entries: ScanEntry[], options: ClassifyOptions): Suggestion[] {
  const taken = options.taken ?? new Set<string>()
  const pool = entries.filter((entry) => !taken.has(entry.path.toLowerCase()))

  const cutoff = Date.now() - options.recentDays * 24 * 60 * 60 * 1000
  const recent: ScanEntry[] = []
  const rest: ScanEntry[] = []

  for (const entry of pool) {
    if (options.recent && entry.mtime > 0 && entry.mtime >= cutoff) recent.push(entry)
    else rest.push(entry)
  }

  const groups = new Map<string, Suggestion>()

  for (const entry of rest) {
    const rule = ruleFor(entry)
    let group = groups.get(rule.key)
    if (!group) {
      group = { key: rule.key, title: rule.title, color: rule.color, entries: [], enabled: true }
      groups.set(rule.key, group)
    }
    group.entries.push(entry)
  }

  const ordered = [...RULES, FALLBACK]
    .map((rule) => groups.get(rule.key))
    .filter((group): group is Suggestion => !!group)

  for (const group of ordered) {
    group.entries.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    // 한두 개짜리 그룹까지 필드로 만들면 바탕화면이 더 지저분해진다.
    if (group.entries.length < 2 && group.key !== 'folder') group.enabled = false
  }

  if (recent.length > 0) {
    recent.sort((a, b) => b.mtime - a.mtime)
    ordered.unshift({
      key: 'recent',
      title: '작성중',
      color: 'lemon',
      entries: recent,
      enabled: recent.length >= 2,
    })
  }

  return ordered
}
