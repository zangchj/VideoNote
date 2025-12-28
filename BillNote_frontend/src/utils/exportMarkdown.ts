import JSZip from 'jszip'

/**
 * Export Markdown along with images as a ZIP.
 * Supports data:, blob: and remote images (with optional proxy fallback).
 */

type ExportOptions = {
  includeImages?: boolean
  proxyUrl?: string
}

function filenameFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const pathname = u.pathname
    const name = pathname.substring(pathname.lastIndexOf('/') + 1) || 'image'
    return name.split('?')[0] || 'image'
  } catch {
    return url.replace(/[^a-z0-9]/gi, '_').slice(0, 40) || 'image'
  }
}

async function fetchAsBlob(url: string, proxyUrl?: string): Promise<Blob> {
  try {
    const resp = await fetch(url, { mode: 'cors' })
    if (!resp.ok) throw new Error(`Fetch failed ${resp.status}`)
    return await resp.blob()
  } catch (err) {
    if (proxyUrl) {
      const proxied = `${proxyUrl}?url=${encodeURIComponent(url)}`
      const resp = await fetch(proxied)
      if (!resp.ok) throw new Error(`Proxy fetch failed ${resp.status}`)
      return await resp.blob()
    }
    throw err
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
    // fallback to canvas method
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

/**
 * Collect images referenced in markdown and return new markdown with local image paths plus array of blobs to include in the ZIP.
 * This version first extracts all image URLs, downloads them, builds a mapping original->images/<name>, then performs a single replace.
 */
async function collectImagesFromMarkdown(markdown: string, proxyUrl?: string) {
  const images: Array<{ path: string; blob: Blob }> = []
  const mapping = new Map<string, string>()

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
    } catch {}
    if (rawUrl.endsWith('*---')) rawUrl = rawUrl.slice(0, -4)
    rawUrl = rawUrl.replace(/\*+$/g, '')
    rawUrl = rawUrl.trim()

    // compute fetchUrl
    let fetchUrl = rawUrl
    try {
      const u = new URL(rawUrl, window.location.origin)
      u.pathname = u.pathname.replace(/[<>:\"\|\?\*]/g, '')
      fetchUrl = u.toString()
    } catch {}

    try {
      if (rawUrl.startsWith('data:')) {
        const b = dataURLtoBlob(rawUrl)
        const fname = filenameFromUrl(rawUrl) || `image_${i}.png`
        images.push({ path: `images/${fname}`, blob: b })
        mapping.set(originalRaw, `images/${fname}`)
      } else if (rawUrl.startsWith('blob:')) {
        const blob = await blobUrlToBlob(fetchUrl)
        const fname = filenameFromUrl(rawUrl) || `image_${i}.png`
        images.push({ path: `images/${fname}`, blob })
        mapping.set(originalRaw, `images/${fname}`)
      } else {
        const blob = await fetchAsBlob(fetchUrl, proxyUrl)
        let fname = filenameFromUrl(rawUrl)
        const ext = mimeToExtension(blob.type)
        if (!/\.[a-z0-9]+$/i.test(fname) && ext) fname = `${fname}.${ext}`
        images.push({ path: `images/${fname}`, blob })
        mapping.set(originalRaw, `images/${fname}`)
      }
    } catch (err) {
      console.warn(`下载图片失败 ${fetchUrl}`, err)
      // leave mapping unset so replacement keeps original
    }
  }

  // 3) build new markdown by replacing only the URL portion inside image links
  const newMarkdown = markdown.replace(imgMdRegex, (whole, alt, url) => {
    const key = url.trim()
    const mapped = mapping.get(key)
    if (mapped) return `![${alt}](${mapped})`
    // try decoded key as fallback
    try {
      const dec = decodeURIComponent(key)
      if (mapping.has(dec)) return `![${alt}](${mapping.get(dec)})`
    } catch {}
    return whole
  })

  return { md: newMarkdown, images }
}

export async function exportMarkdownWithImages(markdown: string, options: ExportOptions = {}) {
  const { includeImages = true, proxyUrl } = options
  const saveModule = await import('file-saver').catch(() => null)
  const saveAs = saveModule ? (saveModule as any).saveAs || (saveModule as any).default : null

  if (!includeImages) {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    if (saveAs) saveAs(blob, 'notes.md')
    else {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'notes.md'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
    return
  }

  const { md: newMarkdown, images } = await collectImagesFromMarkdown(markdown, proxyUrl)

  const zip = new JSZip()
  zip.file('notes.md', newMarkdown)
  const imgFolder = zip.folder('images')
  for (const img of images) {
    const arrayBuffer = await img.blob.arrayBuffer()
    imgFolder?.file(img.path.replace(/^images\//, ''), arrayBuffer)
  }
  const content = await zip.generateAsync({ type: 'blob' })
  if (saveAs) saveAs(content, 'notes_with_images.zip')
  else {
    const url = URL.createObjectURL(content)
    const a = document.createElement('a')
    a.href = url
    a.download = 'notes_with_images.zip'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }
}
