/**
 * 바탕화면에 보이는 그 아이콘을 그대로 가져온다.
 *
 * Electron의 app.getFileIcon은 32px짜리라 타일에서 흐릿하고, 폴더·바로가기처럼
 * 셸이 직접 그리는 아이콘은 환경에 따라 엉뚱하게 나온다. 그래서 Windows에서는
 * 셸 시스템 이미지 목록(SHIL_JUMBO, 256px)에서 직접 뽑아 쓰고, 실패할 때만
 * getFileIcon으로 물러난다.
 *
 * 뽑은 그림은 userData\iconcache 에 PNG로 남는다 — 두 번째 실행부터는
 * PowerShell을 아예 띄우지 않는다.
 */
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, promises as fs, writeFileSync } from 'node:fs'
import path from 'node:path'

/** 타일에 그려지는 크기(최대 140px)의 두 배까지 감당하는 값. */
const SIZE = 160
/** 한 번에 모아서 처리할 때까지 기다리는 시간 — 화면이 뜨자마자 우르르 들어온다. */
const BATCH_MS = 60

/** 셸 개체는 파일 경로가 없어 CLSID로 바꿔야 아이콘을 뽑을 수 있다. */
const SHELL_ALIAS: Record<string, string> = {
  'shell:recyclebin': '::{645FF040-5081-101B-9F08-00AA002F954E}',
  'shell:recyclebinfolder': '::{645FF040-5081-101B-9F08-00AA002F954E}',
  'shell:mycomputerfolder': '::{20D04FE0-3AEA-1069-A2D8-08002B30309D}',
}

const memory = new Map<string, string | null>()

/** 메인 프로세스의 로그로 흘려보낸다 — 아이콘이 안 나올 때 원인을 알 수 있게. */
let logger: (message: string) => void = () => {}
export function setIconLogger(fn: (message: string) => void) {
  logger = fn
}

let cacheDir = ''
function ensureCacheDir() {
  if (!cacheDir) {
    cacheDir = path.join(app.getPath('userData'), 'iconcache')
    mkdirSync(cacheDir, { recursive: true })
  }
  return cacheDir
}

function cacheFile(target: string) {
  const key = createHash('sha1').update(`${SIZE}:${target.toLowerCase()}`).digest('hex')
  return path.join(ensureCacheDir(), `${key}.png`)
}

async function readCached(file: string) {
  try {
    const buffer = await fs.readFile(file)
    if (buffer.length === 0) return null
    return `data:image/png;base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}

/* ---------------------------------------------------------------- PowerShell */

const PS_SCRIPT = String.raw`
param([string]$List, [int]$Size = 160)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$code = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class DfIcon
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct SHFILEINFO
    {
        public IntPtr hIcon;
        public int iIcon;
        public uint dwAttributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName;
    }

    [ComImport, Guid("46EB5926-582E-4017-9FDF-E8998DAA0950"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IImageList
    {
        [PreserveSig] int Add(IntPtr a, IntPtr b, ref int c);
        [PreserveSig] int ReplaceIcon(int a, IntPtr b, ref int c);
        [PreserveSig] int SetOverlayImage(int a, int b);
        [PreserveSig] int Replace(int a, IntPtr b, IntPtr c);
        [PreserveSig] int AddMasked(IntPtr a, int b, ref int c);
        [PreserveSig] int Draw(IntPtr a);
        [PreserveSig] int Remove(int a);
        [PreserveSig] int GetIcon(int i, int flags, ref IntPtr picon);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr SHGetFileInfo(string path, uint attrs, ref SHFILEINFO info, uint cb, uint flags);

    [DllImport("shell32.dll", EntryPoint = "SHGetFileInfoW")]
    static extern IntPtr SHGetFileInfoPidl(IntPtr pidl, uint attrs, ref SHFILEINFO info, uint cb, uint flags);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHParseDisplayName(string name, IntPtr bc, out IntPtr pidl, uint inAttrs, out uint outAttrs);

    [DllImport("shell32.dll")]
    static extern int SHGetImageList(int list, ref Guid riid, out IImageList ppv);

    [DllImport("user32.dll")]
    static extern bool DestroyIcon(IntPtr h);

    [DllImport("ole32.dll")]
    static extern void CoTaskMemFree(IntPtr p);

    const uint SHGFI_SYSICONINDEX = 0x4000;
    const uint SHGFI_PIDL = 0x0008;

    static int IndexOf(string target)
    {
        SHFILEINFO info = new SHFILEINFO();
        uint cb = (uint)Marshal.SizeOf(typeof(SHFILEINFO));
        if (target.StartsWith("::"))
        {
            IntPtr pidl; uint attrs;
            if (SHParseDisplayName(target, IntPtr.Zero, out pidl, 0, out attrs) != 0) return -1;
            IntPtr ok = SHGetFileInfoPidl(pidl, 0, ref info, cb, SHGFI_SYSICONINDEX | SHGFI_PIDL);
            CoTaskMemFree(pidl);
            if (ok == IntPtr.Zero) return -1;
        }
        else
        {
            if (SHGetFileInfo(target, 0, ref info, cb, SHGFI_SYSICONINDEX) == IntPtr.Zero) return -1;
        }
        return info.iIcon;
    }

    static IntPtr Handle(int index)
    {
        Guid iid = new Guid("46EB5926-582E-4017-9FDF-E8998DAA0950");
        // SHIL_JUMBO(4) -> SHIL_EXTRALARGE(2) -> SHIL_LARGE(0)
        foreach (int list in new int[] { 4, 2, 0 })
        {
            IImageList il = null;
            try { if (SHGetImageList(list, ref iid, out il) != 0 || il == null) continue; }
            catch { continue; }
            IntPtr h = IntPtr.Zero;
            try { if (il.GetIcon(index, 1, ref h) == 0 && h != IntPtr.Zero) return h; }
            catch { }
            finally { Marshal.ReleaseComObject(il); }
        }
        return IntPtr.Zero;
    }

    // 점보 목록은 256px 캔버스 한구석에 작은 아이콘을 얹어주기도 한다. 실제 그림 범위를 잰다.
    static Rectangle Content(Bitmap bmp)
    {
        int left = bmp.Width, top = bmp.Height, right = -1, bottom = -1;
        BitmapData data = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height),
            ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try
        {
            int stride = data.Stride;
            byte[] row = new byte[stride];
            for (int y = 0; y < bmp.Height; y++)
            {
                Marshal.Copy(IntPtr.Add(data.Scan0, y * stride), row, 0, stride);
                for (int x = 0; x < bmp.Width; x++)
                {
                    if (row[x * 4 + 3] <= 8) continue;
                    if (x < left) left = x;
                    if (x > right) right = x;
                    if (y < top) top = y;
                    if (y > bottom) bottom = y;
                }
            }
        }
        finally { bmp.UnlockBits(data); }
        if (right < left || bottom < top) return Rectangle.Empty;
        return Rectangle.FromLTRB(left, top, right + 1, bottom + 1);
    }

    public static bool Save(string target, string outPath, int size)
    {
        int index = IndexOf(target);
        if (index < 0) return false;
        IntPtr h = Handle(index);
        if (h == IntPtr.Zero) return false;
        try
        {
            using (Icon ico = Icon.FromHandle(h))
            using (Bitmap raw = ico.ToBitmap())
            {
                Rectangle box = Content(raw);
                if (box.IsEmpty) return false;

                // 캔버스에 비해 그림이 확연히 작을 때만 잘라낸다(정사각 비율은 지킨다).
                Rectangle src = new Rectangle(0, 0, raw.Width, raw.Height);
                if (box.Width < raw.Width * 0.7 || box.Height < raw.Height * 0.7)
                {
                    int side = Math.Max(box.Width, box.Height);
                    int cx = box.Left + box.Width / 2;
                    int cy = box.Top + box.Height / 2;
                    src = new Rectangle(cx - side / 2, cy - side / 2, side, side);
                    src.Intersect(new Rectangle(0, 0, raw.Width, raw.Height));
                    if (src.Width <= 0 || src.Height <= 0) src = box;
                }

                using (Bitmap dst = new Bitmap(size, size, PixelFormat.Format32bppArgb))
                {
                    using (Graphics g = Graphics.FromImage(dst))
                    {
                        g.Clear(Color.Transparent);
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        g.CompositingQuality = CompositingQuality.HighQuality;
                        g.SmoothingMode = SmoothingMode.AntiAlias;

                        // 원본 비율 유지 — 세로로 긴 문서 아이콘이 찌그러지지 않게.
                        double scale = Math.Min((double)size / src.Width, (double)size / src.Height);
                        int w = Math.Max(1, (int)Math.Round(src.Width * scale));
                        int hh = Math.Max(1, (int)Math.Round(src.Height * scale));
                        g.DrawImage(raw, new Rectangle((size - w) / 2, (size - hh) / 2, w, hh),
                            src, GraphicsUnit.Pixel);
                    }
                    dst.Save(outPath, ImageFormat.Png);
                }
            }
            return true;
        }
        catch { return false; }
        finally { DestroyIcon(h); }
    }
}
'@

Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing | Out-Null

$items = Get-Content -LiteralPath $List -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($item in $items) {
  try { [void][DfIcon]::Save($item.path, $item.out, $Size) } catch { }
}
`

let scriptPath = ''
function ensureScript() {
  if (!scriptPath) {
    scriptPath = path.join(ensureCacheDir(), 'extract.ps1')
    writeFileSync(scriptPath, `﻿${PS_SCRIPT}`, 'utf8')
  }
  return scriptPath
}

/** 셸에서 실제로 아이콘을 뽑는다. 실패는 조용히 넘긴다 — 호출부가 대안을 갖고 있다. */
function runExtractor(jobs: { path: string; out: string }[]) {
  return new Promise<void>((resolve) => {
    let listFile = ''
    try {
      listFile = path.join(ensureCacheDir(), `job-${process.pid}-${Date.now()}.json`)
      writeFileSync(listFile, JSON.stringify(jobs), 'utf8')
    } catch {
      resolve()
      return
    }
    const done = () => {
      fs.unlink(listFile).catch(() => {})
      resolve()
    }
    const child = execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-STA',
        '-File',
        ensureScript(),
        '-List',
        listFile,
        '-Size',
        String(SIZE),
      ],
      { windowsHide: true, timeout: 25_000 },
      () => done(),
    )
    child.on('error', () => done())
  })
}

/* -------------------------------------------------------------------- 큐 */

type Pending = { target: string; file: string; resolve: (value: string | null) => void }

let queue: Pending[] = []
let timer: NodeJS.Timeout | null = null
let flushing = false

function schedule() {
  if (timer || flushing) return
  timer = setTimeout(() => {
    timer = null
    void flush()
  }, BATCH_MS)
}

async function flush() {
  if (flushing || queue.length === 0) return
  flushing = true
  const batch = queue
  queue = []

  const jobs = new Map<string, string>()
  for (const item of batch) jobs.set(item.target, item.file)

  try {
    await runExtractor([...jobs].map(([target, out]) => ({ path: target, out })))
  } catch {
    // 아래에서 대안 경로로 처리한다.
  }

  let missed = 0
  await Promise.all(
    batch.map(async (item) => {
      let url = await readCached(item.file)
      if (!url) {
        missed += 1
        url = await fallbackIcon(item.target)
      }
      memory.set(item.target, url)
      item.resolve(url)
    }),
  )
  if (missed > 0) logger(`아이콘 ${missed}/${batch.length}개는 셸에서 못 뽑아 기본 추출로 대체`)

  flushing = false
  if (queue.length > 0) schedule()
}

/** 셸 추출이 안 되는 환경(다른 OS, 권한 제한)에서는 Electron 기본 추출로. */
async function fallbackIcon(target: string) {
  if (target.startsWith('::') || target.startsWith('shell:')) return null
  try {
    const image = await app.getFileIcon(target, { size: 'large' })
    if (image.isEmpty()) return null
    return image.toDataURL()
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ 공개 */

export async function getIcon(target: string): Promise<string | null> {
  if (!target) return null
  const shellTarget = SHELL_ALIAS[target.toLowerCase()] ?? target
  if (memory.has(shellTarget)) return memory.get(shellTarget) ?? null

  if (process.platform !== 'win32') {
    const url = await fallbackIcon(shellTarget)
    memory.set(shellTarget, url)
    return url
  }

  const file = cacheFile(shellTarget)
  const cached = await readCached(file)
  if (cached) {
    memory.set(shellTarget, cached)
    return cached
  }

  return new Promise<string | null>((resolve) => {
    queue.push({ target: shellTarget, file, resolve })
    schedule()
  })
}

/** 폴더에 사용자 지정 아이콘을 달거나 프로그램을 새로 깐 뒤 쓰는 되읽기. */
export async function clearIconCache() {
  memory.clear()
  try {
    const dir = ensureCacheDir()
    const names = await fs.readdir(dir)
    await Promise.all(
      names.filter((n) => n.endsWith('.png')).map((n) => fs.unlink(path.join(dir, n)).catch(() => {})),
    )
  } catch {
    // 캐시를 못 지워도 메모리 캐시는 비웠으니 다음 요청부터 다시 뽑는다.
  }
}
