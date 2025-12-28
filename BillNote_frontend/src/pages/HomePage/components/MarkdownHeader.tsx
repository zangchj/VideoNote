'use client'

import { useEffect, useState } from 'react'
import { Copy, Download, BrainCircuit } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { exportMarkdownWithImages } from '@/utils/exportMarkdown'

interface VersionNote {
  ver_id: string
  model_name?: string
  style?: string
  created_at?: string
  // content may exist on version objects
  content?: string
}

interface NoteHeaderProps {
  currentTask?: {
    markdown: VersionNote[] | string
    audioMeta?: { title?: string }
  }
  isMultiVersion: boolean
  currentVerId: string
  setCurrentVerId: (id: string) => void
  modelName: string
  style: string
  noteStyles: { value: string; label: string }[]
  onCopy: () => void
  createAt?: string | Date
  setShowTranscribe: (show: boolean) => void
  showTranscribe?: boolean
  viewMode: 'map' | 'preview'
  setViewMode: (m: 'map' | 'preview') => void
}

function sanitizeExportBaseName(name = '') {
  // allow Unicode letters (including Chinese), keep numbers, whitespace, dash, dot and underscore
  // remove characters forbidden in filenames on Windows
  return name
    .replace(/[<>:"\\|?*]/g, '_') // remove forbidden chars
    .replace(/\//g, '_') // replace forward slashes
    .replace(/\s+/g, '_')
    .replace(/__+/g, '_')
    .trim()
    .slice(0, 120)
}

export function MarkdownHeader(props: NoteHeaderProps) {
  const {
    currentTask,
    isMultiVersion,
    currentVerId,
    setCurrentVerId,
    modelName,
    style,
    noteStyles,
    onCopy,
    createAt,
    showTranscribe,
    setShowTranscribe,
    viewMode,
    setViewMode,
  } = props
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let timer: NodeJS.Timeout
    if (copied) {
      timer = setTimeout(() => setCopied(false), 2000)
    }
    return () => clearTimeout(timer)
  }, [copied])

  const handleCopy = () => {
    onCopy()
    setCopied(true)
  }

  const styleName = noteStyles.find(v => v.value === style)?.label || style

  const formatDate = (date: string | Date | undefined) => {
    if (!date) return ''
    const d = typeof date === 'string' ? new Date(date) : date
    if (isNaN(d.getTime())) return ''
    return d
      .toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      .replace(/\//g, '-')
  }

  // helper to derive a friendly export base name from available info
  const deriveExportBaseName = (): string => {
    // prefer audioMeta.title
    if (currentTask?.audioMeta?.title) return String(currentTask.audioMeta.title)
    // if markdown is a string, take first 40 chars
    if (typeof currentTask?.markdown === 'string') return (currentTask.markdown as string).slice(0, 40)
    // if markdown is array, try to extract content field or first string entry
    if (Array.isArray(currentTask?.markdown) && currentTask.markdown.length > 0) {
      const first: any = currentTask.markdown[0]
      if (typeof first === 'string') return String(first).slice(0, 40)
      if (first && typeof first === 'object') {
        const c = (first.content || first.markdown || first.title || '') as string
        return String(c).slice(0, 40)
      }
    }
    return currentVerId || 'note'
  }

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-white/95 px-4 py-2 backdrop-blur-sm">
      {/* 左侧区域：版本 + 标签 + 创建时间 */}
      <div className="flex flex-wrap items-center gap-3">
        {isMultiVersion && (
          <Select value={currentVerId} onValueChange={setCurrentVerId}>
            <SelectTrigger className="h-8 w-[160px] text-sm">
              <div className="flex items-center">
                {(() => {
                  const idx = Array.isArray(currentTask?.markdown)
                    ? currentTask!.markdown.findIndex((v: VersionNote) => v.ver_id === currentVerId)
                    : -1
                  return idx !== -1 ? `版本（${currentVerId.slice(-6)}）` : ''
                })()}
              </div>
            </SelectTrigger>

            <SelectContent>
              {(Array.isArray(currentTask?.markdown) ? currentTask!.markdown : []).map((v: VersionNote) => {
                const shortId = v.ver_id.slice(-6)
                return (
                  <SelectItem key={v.ver_id} value={v.ver_id}>
                    {`版本（${shortId}）`}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        )}

        <Badge variant="secondary" className="bg-pink-100 text-pink-700 hover:bg-pink-200">
          {modelName}
        </Badge>
        <Badge variant="secondary" className="bg-cyan-100 text-cyan-700 hover:bg-cyan-200">
          {styleName}
        </Badge>

        {createAt && (
          <div className="text-muted-foreground text-sm">创建时间: {formatDate(createAt)}</div>
        )}
      </div>

      {/* 右侧操作按钮 */}
      <div className="flex items-center gap-1">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={() => {
                  setViewMode(viewMode == 'preview' ? 'map' : 'preview')
                }}
                variant="ghost"
                size="sm"
                className="h-8 px-2"
              >
                <BrainCircuit className="mr-1.5 h-4 w-4" />
                <span className="text-sm">{viewMode == 'preview' ? '思维导图' : 'markdown'}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>思维导图</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={handleCopy} variant="ghost" size="sm" className="h-8 px-2">
                <Copy className="mr-1.5 h-4 w-4" />
                <span className="text-sm">{copied ? '已复制' : '复制'}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>复制内容</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={async() => {
                 try{
                   // extract markdown safely
                   let markdownContent = ''
                   if (!currentTask) markdownContent = ''
                   else if (typeof currentTask.markdown === 'string') markdownContent = currentTask.markdown
                   else if (Array.isArray(currentTask.markdown) && currentTask.markdown.length>0) {
                     const first = currentTask.markdown[0]
                     if (typeof first === 'string') markdownContent = first
                     else if (first && typeof first === 'object') {
                       // first is likely VersionNote
                       const f = first as VersionNote
                       markdownContent = f.content || (f as any).markdown || ''
                     }
                   }

                  // ensure relative image URLs that start with /static are converted to backend absolute URLs
                  const rawApi = String(import.meta.env.VITE_API_BASE_URL || '')
                  const apiBase = rawApi ? rawApi.replace(/\/api\/?$/, '').replace(/\/$/, '') : ''


                  // compute a friendly filename base
                  const title = deriveExportBaseName()
                  const safe = sanitizeExportBaseName(String(title))
                  const outFilename = `${(safe && safe.length>0) ? safe : 'note'}.zip`

                  // For export, use the original markdownContent so image URLs match files/paths in backend/static and the exporter can fetch them (it will call proxy when needed)

                  await exportMarkdownWithImages(markdownContent, { includeImages: true, proxyUrl: '/api/proxy-image', filename: outFilename })
                 }catch(e){
                   console.error('导出失败', e)
                 }
               }} variant="ghost" size="sm" className="h-8 px-2">
                <Download className="mr-1.5 h-4 w-4" />
                <span className="text-sm">导出 Markdown</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>下载为 Markdown 文件（包含图片）</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={() => {
                  setShowTranscribe(!showTranscribe)
                }}
                variant="ghost"
                size="sm"
                className="h-8 px-2"
              >
                {/*<Download className="mr-1.5 h-4 w-4" />*/}
                <span className="text-sm">原文参照</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>原文参照</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  )
}
