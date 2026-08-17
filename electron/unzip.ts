import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createInflateRaw } from 'node:zlib'

/**
 * zip을 앱 안에서 직접 푼다.
 *
 * 예전에는 PowerShell의 Expand-Archive를 불렀는데, 보안 정책이나 백신이
 * 외부 실행을 막으면 업데이트가 통째로 실패했다. 압축 해제 정도는 Node의
 * zlib으로 충분하고, 스트림으로 처리해 큰 파일에서도 메모리가 튀지 않는다.
 */
export async function extractZip(zipPath: string, destDir: string) {
  const handle = await fs.open(zipPath, 'r')
  try {
    const { size } = await handle.stat()

    // 끝에서부터 중앙 디렉터리 위치(EOCD)를 찾는다. 주석이 붙어도 64KB 안쪽이다.
    const tailLength = Math.min(size, 66_560)
    const tail = Buffer.alloc(tailLength)
    await handle.read(tail, 0, tailLength, size - tailLength)

    let eocd = -1
    for (let i = tailLength - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i
        break
      }
    }
    if (eocd < 0) throw new Error('zip 구조를 읽지 못했습니다 (끝 표시 없음)')

    const entryCount = tail.readUInt16LE(eocd + 10)
    const dirSize = tail.readUInt32LE(eocd + 12)
    const dirOffset = tail.readUInt32LE(eocd + 16)
    if (dirOffset === 0xffffffff) throw new Error('zip64 형식은 지원하지 않습니다')

    const directory = Buffer.alloc(dirSize)
    await handle.read(directory, 0, dirSize, dirOffset)

    let cursor = 0
    for (let i = 0; i < entryCount; i += 1) {
      if (directory.readUInt32LE(cursor) !== 0x02014b50) {
        throw new Error(`zip 항목 ${i}을(를) 읽지 못했습니다`)
      }
      const method = directory.readUInt16LE(cursor + 10)
      const compressed = directory.readUInt32LE(cursor + 20)
      const nameLength = directory.readUInt16LE(cursor + 28)
      const extraLength = directory.readUInt16LE(cursor + 30)
      const commentLength = directory.readUInt16LE(cursor + 32)
      const localOffset = directory.readUInt32LE(cursor + 42)
      const name = directory.toString('utf8', cursor + 46, cursor + 46 + nameLength)
      cursor += 46 + nameLength + extraLength + commentLength

      // zip 안의 경로가 바깥으로 빠져나가지 못하게 막는다.
      const target = path.join(destDir, name)
      const relative = path.relative(destDir, target)
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`zip 항목 경로가 이상합니다: ${name}`)
      }

      if (name.endsWith('/')) {
        await fs.mkdir(target, { recursive: true })
        continue
      }
      await fs.mkdir(path.dirname(target), { recursive: true })

      // 실제 데이터 시작 위치는 지역 헤더를 읽어야 안다 (헤더 길이가 항목마다 다르다).
      const local = Buffer.alloc(30)
      await handle.read(local, 0, 30, localOffset)
      const dataStart =
        localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28)

      if (compressed === 0) {
        await fs.writeFile(target, '')
        continue
      }

      const source = createReadStream('', {
        fd: handle.fd,
        start: dataStart,
        end: dataStart + compressed - 1,
        autoClose: false,
      })
      const sink = createWriteStream(target)
      if (method === 0) await pipeline(source, sink)
      else if (method === 8) await pipeline(source, createInflateRaw(), sink)
      else throw new Error(`지원하지 않는 압축 방식(${method}): ${name}`)
    }
  } finally {
    await handle.close()
  }
}
