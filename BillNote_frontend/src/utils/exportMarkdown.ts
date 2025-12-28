import JSZip from 'jszip'

/**
 * Export Markdown along with images as a ZIP.
 * Supports data:, blob: and remote images (with optional proxy fallback).
 */

type ExportOptions = {
  includeImages?: boolean
  proxyUrl?: string
  filename?: string // base filename for the download (zip). Example: 'note-mytitle.zip' or 'notes.zip'
}

function filenameFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const pathname = u.pathname
    const name = pathname.substring(pathname.lastIndexOf('/') + 1) || 'image'
    return name.split('?')[0] || 'image'
  } catch {
    // for non-URL inputs (blob:, data:, or arbitrary strings) produce a safer short token
    return url.replace(/[^a-z0-9.-]/gi, '_').slice(0, 80) || 'image'
  }
}

function sanitizeFileName(name: string) {
  return name.replace(/[<>:"|?*]/g, '_').replace(/\s+/g, '_').slice(0, 150)
}

async function fetchAsBlob(url: string, proxyUrl?: string): Promise<Blob> {
  try {
    const resp = await fetch(url, { mode: 'cors' })
    if (!resp.ok) throw new Error(`Fetch failed ${resp.status}`)
    return await resp.blob()
  } catch {
    if (proxyUrl) {
      // Defensive cleaning: try to decode any percent-encodings, strip trailing junk (--- and anything after),
      // then re-encode for the proxy call. This avoids proxied requests containing encoded comment fragments that
      // the backend proxy can't handle and return 502.
      let clean = String(url)
      try {
        // decode where possible (if url is already decoded, this will throw and we'll keep original)
        clean = decodeURIComponent(clean)
      } catch {
        // ignore decode errors
      }
      // remove trailing separators like '---' and everything after, and also remove trailing encoded hashes/comments
      clean = clean.replace(/[-]{2,}.*$/g, '')
      clean = clean.replace(/[#%].*$/g, '')
      clean = clean.trim()
      const proxied = `${proxyUrl}?url=${encodeURIComponent(clean)}`
      const resp = await fetch(proxied)
      if (!resp.ok) throw new Error(`Proxy fetch failed ${resp.status}`)
      return await resp.blob()
    }
    throw new Error('fetch failed')
  }
}

function dataURLtoBlob(dataurl: string): Blob {
  const arr = dataurl.split(',')
  const mime = arr[0].match(/:(.*?);/)?.[1] || ''
  const bstr = atob(arr[1] || '')
  let n = bstr.length
  const u8arr = new Uint8Array(n)
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n)
  }
  return new Blob([u8arr], { type: mime })
}

async function blobUrlToBlob(blobUrl: string): Promise<Blob> {
  try {
    const r = await fetch(blobUrl)
    if (r.ok) return await r.blob()
  } catch {
    // ignore and fallback to canvas method
  }
  const img = Array.from(document.images).find(i => i.src === blobUrl)
  if (!img) throw new Error('对应的 <img> 未找到')
  return await imageElementToBlob(img)
}

function imageElementToBlob(img: HTMLImageElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return reject(new Error('无法获取 canvas context'))
    ctx.drawImage(img, 0, 0, w, h)
    canvas.toBlob((b) => {
      if (!b) return reject(new Error('canvas toBlob failed'))
      resolve(b)
    }, 'image/png')
  })
}

function mimeToExtension(mime: string): string | null {
  if (!mime) return null
  const m = mime.split('/')[1]
  if (!m) return null
  if (m.includes('jpeg')) return 'jpg'
  if (m.includes('svg')) return 'svg'
  if (m.includes('png')) return 'png'
  if (m.includes('gif')) return 'gif'
  return m.split(';')[0]
}

const imgMdRegex = /!\[([^\]]*)\]\(([^)]+)\)/g

function extractUrlFromParentheses(raw: string): string {
  // raw may contain: <url> "title"  or url "title" or url)--- etc.
  let s = raw.trim()
  // remove surrounding angle brackets
  if (s.startsWith('<') && s.includes('>')) {
    const idx = s.indexOf('>')
    s = s.slice(1, idx)
  }
  // match first token (url)
  const m = s.match(/^([^\s]+)/)
  const candidate = m ? m[1] : s
  // strip trailing punctuation like ) or ] or quotes and trailing dashes
  return candidate.replace(/[)\]"'\s]+$/g, '').replace(/-+$/g, '')
}

// normalize URL-like tokens for mapping and comparison.
function normalizeUrlKey(u: string): string {
  if (!u) return u
  let s = String(u).trim()
  // decode common encodings if possible
  try {
    s = decodeURIComponent(s)
  } catch {
    // ignore
  }
  // remove any trailing triple-dash separator and everything after (commonly appears in generated links)
  s = s.replace(/[-]{2,}.*$/g, '')
  // also remove encoded dash sequences
  s = s.replace(/(?:%2D){2,}.*$/gi, '')
  // remove trailing punctuation and spaces
  s = s.replace(/[)\]"'\s]+$/g, '')
  // strip surrounding < > if still present
  if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1)
  return s
}

/**
 * Collect images referenced in markdown and return new markdown with local image paths plus array of blobs to include in the ZIP.
 * This version first extracts all image URLs, downloads them, builds a mapping original->images/<name>, then performs a single replace.
 */
async function collectImagesFromMarkdown(markdown: string, proxyUrl?: string) {
  const images: Array<{ path: string; blob: Blob }> = []
  const mapping = new Map<string, string>()
  const failed: string[] = []

  // 1) collect all original urls in appearance order
  const found: string[] = []
  let m: RegExpExecArray | null
  while ((m = imgMdRegex.exec(markdown)) !== null) {
    const raw = m[2].trim()
    if (!found.includes(raw)) found.push(raw)
  }

  // 2) process each found url sequentially
  for (let i = 0; i < found.length; i++) {
    const originalRaw = found[i]
    let rawUrl = originalRaw
    try {
      rawUrl = decodeURIComponent(rawUrl)
    } catch {
      // ignore decode errors
    }

    // extract pure URL part (remove titles, angle brackets, trailing punctuation and repeated '-')
    let pure = extractUrlFromParentheses(rawUrl)
    pure = pure.replace(/\*+$/g, '')
    pure = pure.trim()

    // if still empty, skip
    if (!pure) continue

    // compute fetchUrl
    let fetchUrl = pure
    try {
      const u = new URL(pure, window.location.origin)
      // sanitize path characters
      u.pathname = u.pathname.replace(/[<>:"|?*]/g, '')
      fetchUrl = u.toString()
    } catch {
      // keep fetchUrl as-is
    }

    try {
      if (pure.startsWith('data:')) {
        const b = dataURLtoBlob(pure)
        const ext = mimeToExtension(b.type) || 'png'
        let fname = `image_${Date.now()}_${i}.${ext}`
        fname = sanitizeFileName(fname)
        images.push({ path: `images/${fname}`, blob: b })
        // set multiple keys so replacement is resilient (use ./images/ in markdown)
        mapping.set(originalRaw, `./images/${fname}`)
        mapping.set(pure, `./images/${fname}`)
        mapping.set(normalizeUrlKey(originalRaw), `./images/${fname}`)
        mapping.set(normalizeUrlKey(pure), `./images/${fname}`)
      } else if (pure.startsWith('blob:')) {
        const blob = await blobUrlToBlob(fetchUrl)
        const ext = mimeToExtension(blob.type) || 'png'
        // prefer extracted name if it's meaningful, otherwise generate a timestamped image name
        let candidate = filenameFromUrl(pure)
        if (!candidate || /^pasted_image/i.test(candidate) || candidate === 'image') candidate = `image_${Date.now()}_${i}.${ext}`
        if (!/\.[a-z0-9]+$/i.test(candidate)) candidate = `${candidate}.${ext}`
        const fname = sanitizeFileName(candidate)
        images.push({ path: `images/${fname}`, blob })
        mapping.set(originalRaw, `./images/${fname}`)
        mapping.set(pure, `./images/${fname}`)
        mapping.set(normalizeUrlKey(originalRaw), `./images/${fname}`)
        mapping.set(normalizeUrlKey(pure), `./images/${fname}`)
      } else {
        const blob = await fetchAsBlob(fetchUrl, proxyUrl)
        const ext = mimeToExtension(blob.type) || 'png'
        let fname = filenameFromUrl(pure)
        if (!fname || fname === 'image') fname = `image_${Date.now()}_${i}`
        if (!/\.[a-z0-9]+$/i.test(fname) && ext) fname = `${fname}.${ext}`
        fname = sanitizeFileName(fname)
        images.push({ path: `images/${fname}`, blob })
        // set mapping for several possible matching keys: original raw, pure, full fetchUrl, and pathname
        mapping.set(originalRaw, `./images/${fname}`)
        mapping.set(pure, `./images/${fname}`)
        mapping.set(normalizeUrlKey(originalRaw), `./images/${fname}`)
        mapping.set(normalizeUrlKey(pure), `./images/${fname}`)
        try {
          const uu = new URL(fetchUrl)
          mapping.set(uu.toString(), `./images/${fname}`)
          mapping.set(uu.pathname + (uu.search || '') + (uu.hash || ''), `./images/${fname}`)
          // also set without leading slash
          if (uu.pathname.startsWith('/')) mapping.set(uu.pathname.slice(1) + (uu.search || ''), `./images/${fname}`)
          // normalized keys as well
          mapping.set(normalizeUrlKey(uu.toString()), `./images/${fname}`)
          mapping.set(normalizeUrlKey(uu.pathname + (uu.search || '') + (uu.hash || '')), `./images/${fname}`)
        } catch {
          // ignore URL parsing failures
        }
      }
    } catch (err) {
      console.warn(`下载图片失败 ${fetchUrl}`, err)
      failed.push(pure)
      // leave mapping unset so replacement keeps original; but also add a decoded fallback
      try {
        const dec = decodeURIComponent(pure)
        mapping.set(dec, `./images/${sanitizeFileName(filenameFromUrl(dec) || `image_${i}.png`)}`)
        mapping.set(normalizeUrlKey(dec), `./images/${sanitizeFileName(filenameFromUrl(dec) || `image_${i}.png`)}`)
      } catch {
        // ignore
      }
    }
  }

  // 3) build new markdown by replacing only the URL portion inside image links
  const newMarkdown = markdown.replace(imgMdRegex, (whole, alt, url) => {
    const raw = url.trim()
    const pure = extractUrlFromParentheses(raw)
    // try several keys
    const candidates = [raw, pure, normalizeUrlKey(raw), normalizeUrlKey(pure)]
    for (const c of candidates) {
      if (mapping.has(c)) return `![${alt}](${mapping.get(c)})`
      try {
        const dec = decodeURIComponent(c)
        if (mapping.has(dec)) return `![${alt}](${mapping.get(dec)})`
      } catch {
        // ignore
      }
    }
    return whole
  })

  return { md: newMarkdown, images, failed }
}

function deriveFilenameFromDocument(): string {
  // try common locations for the note title used in the UI
  try {
    // 1) React header title in the page (look for h1 or elements with known classes)
    const selectors = [
      'h1',
      '.note-title',
      '.markdown-title',
      '.doc-title',
      '.title',
      '.note-header',
      '.page-title',
    ]
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (el && el.textContent && el.textContent.trim().length > 0) {
        return sanitizeFileName(el.textContent.trim()).slice(0, 80)
      }
    }
    // 2) fallback to document.title
    if (document.title && document.title.trim().length > 0) {
      return sanitizeFileName(document.title.trim()).slice(0, 80)
    }
  } catch {
    // ignore
  }
  return 'notes'
}

export async function exportMarkdownWithImages(markdown: string, options: ExportOptions = {}) {
  const { includeImages = true, proxyUrl, filename } = options

  // dynamic import file-saver at runtime to avoid Vite static import resolution errors when the package is not installed
  let saveAs: ((data: Blob | string, filename?: string) => void) | null = null
  try {
    // build module id dynamically so Vite's static import analysis won't fail if the package is missing
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const moduleId = 'file' + '-saver'
    // use @vite-ignore to prevent Vite from statically analyzing this import
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
    // @ts-ignore
    const mod = await import(/* @vite-ignore */ (moduleId as any)).catch(() => null)
    if (mod) {
      // file-saver exports either named saveAs or default
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      saveAs = (mod as any).saveAs || (mod as any).default || null
    }
  } catch {
    // ignore; fallback to anchor download below
  }

  // derive base name for internal markdown file and non-zip download
  let baseName = 'notes'
  if (filename) {
    // strip extension if user passed .zip or .md
    baseName = filename.replace(/\.(zip|md)$/i, '')
  } else {
    // try to obtain a useful base name from the DOM/document title when not explicitly provided
    baseName = deriveFilenameFromDocument()
  }

  // normalize baseName a bit
  baseName = sanitizeFileName(baseName) || 'notes'

  if (!includeImages) {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    // prefer explicit filename if user passed a .md filename, otherwise use baseName + .md
    const outMdName = filename && /\.md$/i.test(filename) ? filename : `${baseName || 'notes'}.md`
    console.info('[exportMarkdown] downloading markdown with filename:', outMdName)
    if (saveAs) saveAs(blob, outMdName)
    else {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = outMdName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
    return
  }

  const { md: newMarkdown, images, failed } = await collectImagesFromMarkdown(markdown, proxyUrl)

  const zip = new JSZip()
  // use baseName for internal markdown filename
  zip.file(`${baseName || 'notes'}.md`, newMarkdown)
  const imgFolder = zip.folder('images')
  for (const img of images) {
    const arrayBuffer = await img.blob.arrayBuffer()
    const nameInZip = img.path.replace(/^\.\//, '').replace(/^images\//, '')
    imgFolder?.file(nameInZip, arrayBuffer)
  }
  if (failed.length > 0) {
    imgFolder?.file('FAILED_IMAGES.txt', failed.join('\n'))
  }
  const content = await zip.generateAsync({ type: 'blob' })

  // Determine output ZIP filename
  let outName = ''
  if (filename && filename.length > 0) {
    // if caller passed a .md filename but requested images, convert to zip
    if (/\.md$/i.test(filename)) {
      outName = filename.replace(/\.md$/i, '.zip')
    } else {
      outName = filename
    }
  } else {
    outName = `${baseName || 'notes'}_with_images.zip`
  }

  console.info('[exportMarkdown] downloading zip with filename:', outName)
  if (saveAs) saveAs(content, outName)
  else {
    const url = URL.createObjectURL(content)
    const a = document.createElement('a')
    a.href = url
    a.download = outName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }
}
