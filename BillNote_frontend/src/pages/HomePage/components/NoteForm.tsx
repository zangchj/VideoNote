/* NoteForm.tsx ---------------------------------------------------- */
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form.tsx'
import { useEffect,useState } from 'react'
import { useForm, useWatch, FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { Info, Loader2, Plus } from 'lucide-react'
import { Alert } from 'antd'
import toast from 'react-hot-toast'

import { generateNote } from '@/services/note.ts'
import { uploadFile } from '@/services/upload.ts'
import { useTaskStore } from '@/store/taskStore'
import { useModelStore } from '@/store/modelStore'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip.tsx'
import { Checkbox } from '@/components/ui/checkbox.tsx'
import { Button } from '@/components/ui/button.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Textarea } from '@/components/ui/textarea.tsx'
import { noteStyles, noteFormats, videoPlatforms } from '@/constant/note.ts'
import { useNavigate } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'

/* -------------------- 校验 Schema -------------------- */
// 将 video_url 设为可选，避免在 zod 层面针对不同 platform 产生复杂验证
// 我们在 onSubmit 中做平台相关的运行时校验（例如 batchlocal 需有已上传的文件）
const formSchema = z.object({
  video_url: z.string().optional(),
  platform: z.string().nonempty('请选择平台'),
  quality: z.enum(['fast', 'medium', 'slow']),
  screenshot: z.boolean().optional(),
  link: z.boolean().optional(),
  model_name: z.string().nonempty('请选择模型'),
  format: z.array(z.string()).default([]),
  style: z.string().nonempty('请选择笔记生成风格'),
  extras: z.string().optional(),
  video_understanding: z.boolean().optional(),
  video_interval: z.coerce.number().min(1).max(30).default(4).optional(),
  grid_size: z
    .tuple([z.coerce.number().min(1).max(10), z.coerce.number().min(1).max(10)])
    .default([3, 3])
    .optional(),
})

export type NoteFormValues = z.infer<typeof formSchema>

/* -------------------- 可复用子组件 -------------------- */
const SectionHeader = ({ title, tip }: { title: string; tip?: string }) => (
  <div className="my-3 flex items-center justify-between">
    <h2 className="block">{title}</h2>
    {tip && (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="hover:text-primary h-4 w-4 cursor-pointer text-neutral-400" />
          </TooltipTrigger>
          <TooltipContent className="text-xs">{tip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )}
  </div>
)

const CheckboxGroup = ({
  value = [],
  onChange,
  disabledMap,
}: {
  value?: string[]
  onChange: (v: string[]) => void
  disabledMap: Record<string, boolean>
}) => (
  <div className="flex flex-wrap space-x-1.5">
    {noteFormats.map(({ label, value: v }) => (
      <label key={v} className="flex items-center space-x-2">
        <Checkbox
          checked={value.includes(v)}
          disabled={disabledMap[v]}
          onCheckedChange={checked =>
            onChange(checked ? [...value, v] : value.filter(x => x !== v))
          }
        />
        <span>{label}</span>
      </label>
    ))}
  </div>
)

/* -------------------- 主组件 -------------------- */
const NoteForm = () => {
  const navigate = useNavigate();
  const [isUploading, setIsUploading] = useState(false)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  // batch upload state for multiple local videos
  const [batchUploading, setBatchUploading] = useState(false)
  const [batchFiles, setBatchFiles] = useState<Array<{ id: string; name: string; url?: string; uploading?: boolean; error?: string }>>([])
  /* ---- 全局状态 ---- */
  // Use individual selectors to avoid pulling the whole store (prevents unnecessary rerenders)
  const addPendingTask = useTaskStore(state => state.addPendingTask)
  const currentTaskId = useTaskStore(state => state.currentTaskId)
  const setCurrentTask = useTaskStore(state => state.setCurrentTask)
  const getCurrentTask = useTaskStore(state => state.getCurrentTask)
  const retryTask = useTaskStore(state => state.retryTask)

  // 从 modelStore 只需要这些方法 / 数据；select individually
  const loadEnabledModels = useModelStore(state => state.loadEnabledModels)
  const modelList = useModelStore(state => state.modelList)

  /* ---- 表单 ---- */
  // Use a relaxed form type to avoid resolver / RHF type conflicts
  const form = useForm<any>({
    resolver: zodResolver(formSchema) as any,
    defaultValues: {
      platform: 'bilibili',
      quality: 'medium',
      model_name: (modelList && modelList[0] && modelList[0].model_name) || '',
      style: 'minimal',
      video_interval: 4,
      grid_size: [3, 3],
      format: [],
    },
  })
  const currentTask = getCurrentTask()

  /* ---- 派生状态（只 watch 一次，提高性能） ---- */
  const platform = useWatch({ control: form.control, name: 'platform' }) as string
  const videoUnderstandingEnabled = useWatch({ control: form.control, name: 'video_understanding' })
  const videoUrl = useWatch({ control: form.control, name: 'video_url' }) as string | undefined
  const editing = currentTask && currentTask.id

  const goModelAdd = () => {
    navigate("/settings/model");
  };
  /* ---- 副作用 ---- */
  useEffect(() => {
    loadEnabledModels()

    return
  }, [])
  useEffect(() => {
    if (!currentTask) return
    const formData: any = currentTask.formData

    console.log('currentTask.formData.platform:', formData.platform)

    form.reset({
      platform: formData.platform || 'bilibili',
      video_url: formData.video_url || '',
      model_name: formData.model_name || modelList[0]?.model_name || '',
      style: formData.style || 'minimal',
      quality: formData.quality || 'medium',
      extras: formData.extras || '',
      screenshot: formData.screenshot ?? false,
      link: formData.link ?? false,
      video_understanding: formData.video_understanding ?? false,
      video_interval: formData.video_interval ?? 4,
      grid_size: formData.grid_size ?? [3, 3],
      format: formData.format ?? [],
    })
  }, [
    // 当下面任意一个变了，就重新 reset
    currentTaskId,
    // modelList 用来兜底 model_name
    modelList.length,
    // 还要加上 formData 的各字段，或者直接 currentTask
    currentTask?.formData,
  ])

  /* ---- 帮助函数 ---- */
  const isGenerating = () => !['SUCCESS', 'FAILED', undefined].includes(getCurrentTask()?.status)
  const generating = isGenerating()
  const handleFileUpload = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    setIsUploading(true)
    setUploadSuccess(false)

    try {
      // uploadFile through request interceptor returns the `data` payload directly
      const resData = await uploadFile(formData)
      // support a few possible shapes: string -> '/uploads/..', { url }, { data: { url } }
      let url: string | undefined
      const anyRes = resData as any
      if (!anyRes) url = undefined
      else if (typeof anyRes === 'string') url = anyRes
      else url = anyRes.url || (anyRes.data && anyRes.data.url)
      console.log('上传返回:', resData, 'resolved url:', url)
      if (url) {
        // set form value explicitly so the top input shows uploaded path
        try { form.setValue('video_url', url) } catch (e) {}
        // don't rely on external field.onChange (may be different instances); use form state directly
        setUploadSuccess(true)
        try { form.trigger('video_url') } catch (e) {}
        // debug log to verify value is applied
        try { console.log('form.video_url after setValue:', form.getValues('video_url')) } catch (e) {}
        toast.success('上传成功!')
        // clear success indicator after 3s so UI resets
        setTimeout(() => setUploadSuccess(false), 3000)
      } else {
        // handle unexpected response shape by notifying user
        toast.error('上传成功但未返回文件地址，无法回显，请检查后端返回')
      }
    } catch (err) {
      console.error('上传失败:', err)
      toast.error('上传失败，请重试')
    } finally {
      setIsUploading(false)
    }
  }

  // Handle multiple files upload (for batchlocal)
  const handleBatchFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    if (fileArray.length === 0) return
    setBatchUploading(true)

    // initialize entries with unique ids to avoid name collisions
    const entries = fileArray.map(f => ({ id: uuidv4(), name: f.name, uploading: true }))
    setBatchFiles(prev => [...prev, ...entries])

    let successCount = 0
    await Promise.all(
      fileArray.map(async (f, idx) => {
        // use idx to map back to the corresponding entry id (avoids unused variable warnings)
        const entryId = entries[idx].id
        try {
          const form = new FormData()
          form.append('file', f)
          const res = await uploadFile(form)
          const url = (res && (res as any).url) || (res && (res as any).data && (res as any).data.url)
          if (url) {
            setBatchFiles(prev => {
              const copy = [...prev]
              // place the url in the first matching uploading entry by id
              const i = copy.findIndex(item => item.id === entryId)
              if (i !== -1) copy[i] = { ...copy[i], url, uploading: false }
              else copy.push({ id: entryId, name: f.name, url, uploading: false })
              return copy
            })
            successCount += 1
            // optional success toast per file (quiet)
            // toast.success(`${f.name} 上传成功`)
          } else {
            setBatchFiles(prev => prev.map(p => (p.id === entryId ? { ...p, uploading: false, error: '上传失败' } : p)))
          }
        } catch (e) {
          setBatchFiles(prev => prev.map(p => (p.id === entryId ? { ...p, uploading: false, error: '上传失败' } : p)))
        }
      })
    )

    setBatchUploading(false)
    // show a single toast if at least one file uploaded successfully
    if (successCount > 0) {
      toast.success(`批量上传完成，已上传 ${successCount} 个文件`)
    } else {
      toast.error('批量上传完成，但没有文件上传成功')
    }
  }

  const removeBatchFile = (id: string) => {
    setBatchFiles(prev => prev.filter(p => p.id !== id))
  }

  const onSubmit = async (values: NoteFormValues) => {
    // 平台相关运行时校验：将针对 batchlocal、local 与第三方链接分别校验，避免 zod 在提交前阻断批量上传流程
    // batchlocal: 必须至少有一个已上传的文件 url
    if (values.platform === 'batchlocal') {
      const urls = batchFiles.filter(f => f.url).map(f => f.url!)
      if (urls.length === 0) {
        toast.error('请先上传至少一个本地视频')
        return
      }
    } else if (values.platform === 'local') {
      // local: 需要有单个本地视频的 url（单文件上传会把 video_url 填上）
      if (!values.video_url) {
        toast.error('请先上传或选择本地视频')
        return
      }
    } else {
      // 其它平台（bilibili, youtube 等）：需要填写并校验为合法 URL
      if (!values.video_url) {
        toast.error('请输入视频链接')
        return
      }
      try {
        const u = new URL(values.video_url)
        if (!['http:', 'https:'].includes(u.protocol)) {
          toast.error('请输入正确的视频链接')
          return
        }
      } catch (e) {
        toast.error('请输入正确的视频链接')
        return
      }
    }

    // 构造公共 payload 基本字段（不含 task_id 与 video_url）
    const modelSelected = modelList.find(m => m.model_name === values.model_name)
    if (!modelSelected) {
      toast.error('请先选择模型')
      return
    }

    const basePayload = {
      ...values,
      provider_id: modelSelected.provider_id,
    }

    // 如果是重试且已有 currentTaskId，则直接触发 retryTask（后端会复用 task_id）
    if (currentTaskId) {
      try {
        retryTask(currentTaskId)
        toast.success('已重新提交任务')
      } catch (e) {
        console.error('Retry task failed', e)
        toast.error('重新提交任务失败')
      }
      return
    }

    // If batchlocal, create a task per uploaded url (optimistic: create taskId locally and add pending task before backend call)
    if (values.platform === 'batchlocal') {
      const urls = batchFiles.filter(f => f.url).map(f => f.url!)
      for (const url of urls) {
        // generate a client-side task id and add pending entry immediately so UI shows waiting
        const tempId = uuidv4()
        // backend expects platform 'local' for file paths; map 'batchlocal' -> 'local' for the request
        const p = {
          ...basePayload,
          video_url: url,
          task_id: tempId,
          platform: 'local',
        }
        // show as local in history as well
        addPendingTask(tempId, 'local', p)
        // call backend and let it use the provided task_id
        try {
          console.log('Submitting batch local job', tempId, url)
          const res = await generateNote(p as any)
          console.log('batch submit res', res)
          toast.success('任务已提交，已加入等待队列')
        } catch (e: any) {
          console.error('批量任务提交失败', e)
          // remove the optimistic pending task because backend rejected it
          try { setTimeout(() => { /* allow UI to show briefly */ }, 100) } catch (ignored) {}
          toast.error('提交任务失败: ' + (e?.message || '未知错误'))
          // remove the failed optimistic task from task store if such API exists
          try { useTaskStore.getState().removeTask?.(tempId) } catch (err) { /* ignore if not available */ }
        }
      }
      toast.success('已为每个本地视频提交任务')
      return
    }

    // 单视频模式：先生成本地 task id 并立即加入历史（optimistic），再调用后端
    const newTaskId = uuidv4()
    const singlePayload = {
      ...basePayload,
      task_id: newTaskId,
    }

    // optimistic add so right-side shows waiting immediately
    addPendingTask(newTaskId, values.platform, singlePayload)
    try {
      const res = await generateNote(singlePayload as any)
      console.log('single submit res', res)
      // if backend returned a non-ok payload with code/msg, ensure we log it
      if (res && (res.code || res.msg)) console.error('generateNote returned:', res)
      toast.success('任务已提交，已加入等待队列')
    } catch (e: any) {
      console.error('提交任务失败', e)
      toast.error('提交任务失败: ' + (e?.message || '未知错误'))
      // remove optimistic task if submission failed
      try { useTaskStore.getState().removeTask?.(newTaskId) } catch (err) { /* ignore if not implemented */ }
    }
  }

  const onInvalid = (errors: FieldErrors<NoteFormValues>) => {
    console.warn('表单校验失败：', errors)
    // 尽量展示第一个错误给用户
    const getFirstError = (errObj: any): string | null => {
      if (!errObj) return null
      for (const k of Object.keys(errObj)) {
        const v = errObj[k]
        if (v?.message) return String(v.message)
        // nested
        if (typeof v === 'object') {
          const nested = getFirstError(v)
          if (nested) return nested
        }
      }
      return null
    }

    const first = getFirstError(errors)
    if (first) toast.error(first)
  }
  const handleCreateNew = () => {
    // 🔁 这里清空当前任务状态
    // 比如调用 resetCurrentTask() 或者 navigate 到一个新页面
    setCurrentTask(null)

    // Clear upload / batch states and reset form fields to defaults
    setBatchFiles([])
    setIsUploading(false)
    setUploadSuccess(false)
    setBatchUploading(false)

    // Reset form to sensible defaults (use modelList[0] as fallback for model_name)
    form.reset({
      platform: 'bilibili',
      video_url: '',
      model_name: modelList[0]?.model_name || '',
      style: 'minimal',
      quality: 'medium',
      extras: '',
      screenshot: false,
      link: false,
      video_understanding: false,
      video_interval: 4,
      grid_size: [3, 3],
      format: [],
    })
  }
  const FormButton = () => {
    const label = generating ? '正在生成…' : editing ? '重新生成' : '生成笔记'

    return (
      <div className="flex gap-2">
        <Button
          type="submit"
          className={!editing ? 'w-full' : 'w-2/3 bg-primary'}
          disabled={generating || modelList.length === 0}
        >
          {generating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {label}
        </Button>

        {editing && (
          <Button type="button" variant="outline" className="w-1/3" onClick={handleCreateNew}>
            <Plus className="mr-2 h-4 w-4" />
            新建笔记
          </Button>
        )}
      </div>
    )
  }

  /* -------------------- 渲染 -------------------- */
  return (
    <div className="h-full w-full">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-4">
          {/* 顶部按钮 */}
          <FormButton></FormButton>

          {/* 视频链接 & 平台 */}
          <SectionHeader title="视频链接" tip="支持 B 站、YouTube 等平台" />
          <div className="flex gap-2 items-center">
            {/* 平台选择 */}

            <FormField
              control={form.control}
              name="platform"
              render={({ field }) => (
                <FormItem>
                  <Select
                    disabled={!!editing}
                    value={field.value}
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger className="w-32 h-10 flex items-center">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {videoPlatforms?.map(p => (
                        <SelectItem key={p.value} value={p.value}>
                          <div className="flex items-center justify-center gap-2">
                            <div className="h-4 w-4">{p.logo()}</div>
                            <span>{p.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage style={{ display: 'none' }} />
                </FormItem>
              )}
            />

            {/* Inline compact input bound to video_url (keeps sync with the upload area below) */}
            <div className="flex-1">
              <Input
                className="h-10"
                value={videoUrl || ''}
                onChange={e => form.setValue('video_url', e.target.value)}
                disabled={!!editing}
                placeholder={platform === 'local' ? '请输入本地视频路径' : '请输入视频网站链接'}
              />
            </div>
          </div>

          <FormField
            control={form.control}
            name="video_url"
            render={({ field }) => (
              <FormItem className="flex-1">
                {platform === 'local' ? (
                  <>
                    <div
                      className="hover:border-primary mt-2 flex h-40 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-gray-300 transition-colors"
                      onDragOver={e => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                      onDrop={e => {
                        e.preventDefault()
                        const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('video/'))
                        if (files.length > 1) {
                          // switch to batch mode and reuse batch handler
                          form.setValue('platform', 'batchlocal')
                          handleBatchFiles(files)
                        } else {
                          const file = files?.[0]
                          if (file) handleFileUpload(file)
                        }
                      }}
                      onClick={() => {
                        const input = document.createElement('input')
                        input.type = 'file'
                        input.accept = 'video/*'
                        input.multiple = true
                        input.onchange = e => {
                          const files = Array.from((e.target as HTMLInputElement).files || []).filter(f => f.type.startsWith('video/'))
                          if (files.length > 1) {
                            form.setValue('platform', 'batchlocal')
                            handleBatchFiles(files)
                          } else {
                            const file = files?.[0]
                            if (file) handleFileUpload(file)
                          }
                        }
                        input.click()
                      }}
                    >
                      {isUploading ? (
                        <p className="text-center text-sm text-blue-500">上传中，请稍候…</p>
                      ) : uploadSuccess ? (
                        <p className="text-center text-sm text-green-500">上传成功！</p>
                      ) : (
                        <p className="text-center text-sm text-gray-500">
                          拖拽文件到这里上传 <br />
                          <span className="text-xs text-gray-400">或点击选择文件</span>
                        </p>
                      )}
                    </div>
                  </>
                ) : platform === 'batchlocal' ? (
                  <>
                    <div
                      className="hover:border-primary mt-2 flex h-40 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-gray-300 transition-colors"
                      onDragOver={e => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                      onDrop={e => {
                        e.preventDefault()
                        const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('video/'))
                        if (files.length) handleBatchFiles(files)
                      }}
                      onClick={() => {
                        const input = document.createElement('input')
                        input.type = 'file'
                        input.accept = 'video/*'
                        input.multiple = true
                        input.onchange = e => {
                          const files = Array.from((e.target as HTMLInputElement).files || []).filter(f => f.type.startsWith('video/'))
                          if (files.length) handleBatchFiles(files)
                        }
                        input.click()
                      }}
                    >
                      {batchUploading ? (
                        <p className="text-center text-sm text-blue-500">批量上传中…</p>
                      ) : (
                        <p className="text-center text-sm text-gray-500">
                          拖拽多个视频到这里上传 <br />
                          <span className="text-xs text-gray-400">或点击选择多个文件</span>
                        </p>
                      )}
                    </div>

                    {/* 已添加的批量文件列表 */}
                    <div className="mt-2 max-h-40 overflow-auto">
                      {batchFiles.length === 0 ? (
                        <p className="text-sm text-gray-400">尚未上传任何本地视频</p>
                      ) : (
                        <ul className="space-y-1">
                          {batchFiles.map(file => (
                            <li key={file.id} className="flex items-center justify-between rounded border px-2 py-1">
                              <div className="truncate text-sm">
                                {file.name}
                                {file.uploading && <span className="ml-2 text-xs text-blue-500">（上传中）</span>}
                                {file.error && <span className="ml-2 text-xs text-red-500">（上传失败）</span>}
                                {file.url && <span className="ml-2 text-xs text-green-600">（已上传）</span>}
                              </div>
                              <div className="flex items-center space-x-2">
                                <button
                                  type="button"
                                  onClick={() => removeBatchFile(file.id)}
                                  className="text-xs text-red-500"
                                >
                                  删除
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                ) : (
                  // no visible input here; keep a hidden native input to preserve RHF binding
                  <input type="hidden" {...field} />
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-2">
            {/* 模型选择 */}
            {modelList.length > 0 ? (
              <div className="w-full">
                <FormField
                  control={form.control}
                  name="model_name"
                  render={({ field }) => (
                    <FormItem>
                      <SectionHeader title="模型选择" tip="不同模型效果不同，建议自行测试" />
                      <Select
                        onOpenChange={() => {
                          loadEnabledModels()
                        }}
                        value={field.value}
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full min-w-0 truncate">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {modelList.map(m => (
                            <SelectItem key={m.id} value={m.model_name}>
                              {m.model_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            ) : (
              <FormItem>
                <SectionHeader title="模型选择" tip="不同模型效果不同，建议自行测试" />
                <Button type={'button'} variant={'outline'} onClick={() => goModelAdd()}>
                  请先添加模型
                </Button>
                <FormMessage />
              </FormItem>
            )}

            {/* 笔记风格 */}
            <div className="w-full">
              <FormField
                control={form.control}
                name="style"
                render={({ field }) => (
                  <FormItem>
                    <SectionHeader title="笔记风格" tip="选择生成笔记的呈现风格" />
                    <Select value={field.value} onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full min-w-0 truncate">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {noteStyles.map(({ label, value }) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          {/* 视频理解 */}
          <SectionHeader title="视频理解" tip="将视频截图发给多模态模型辅助分析" />
          <div className="flex flex-col gap-2">
            <FormField
              control={form.control}
              name="video_understanding"
              render={() => (
                <FormItem>
                  <div className="flex items-center gap-2">
                    <FormLabel>启用</FormLabel>
                    <Checkbox
                      checked={videoUnderstandingEnabled}
                      onCheckedChange={v => form.setValue('video_understanding', Boolean(v))}
                    />
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              {/* 采样间隔 */}
              <FormField
                control={form.control}
                name="video_interval"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>采样间隔（秒）</FormLabel>
                    <Input disabled={!videoUnderstandingEnabled} type="number" {...field} />
                    <FormMessage />
                  </FormItem>
                )}
              />
              {/* 拼图大小 */}
              <FormField
                control={form.control}
                name="grid_size"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>拼图尺寸（列 × 行）</FormLabel>
                    <div className="flex items-center space-x-2">
                      <Input
                        disabled={!videoUnderstandingEnabled}
                        type="number"
                        value={field.value?.[0] || 3}
                        onChange={e => field.onChange([+e.target.value, field.value?.[1] || 3])}
                        className="w-16"
                      />
                      <span>x</span>
                      <Input
                        disabled={!videoUnderstandingEnabled}
                        type="number"
                        value={field.value?.[1] || 3}
                        onChange={e => field.onChange([field.value?.[0] || 3, +e.target.value])}
                        className="w-16"
                      />
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <Alert
              closable
              type="error"
              message={
                <div>
                  <strong>提示：</strong>
                  <p>视频理解功能必须使用多模态模型。</p>
                </div>
              }
              className="text-sm"
            />
          </div>

          {/* 笔记格式 */}
          <FormField
            control={form.control}
            name="format"
            render={({ field }) => (
              <FormItem>
                <SectionHeader title="笔记格式" tip="选择要包含的笔记元素" />
                <CheckboxGroup
                  value={field.value}
                  onChange={field.onChange}
                  disabledMap={{
                    link: platform === 'local',
                    screenshot: !videoUnderstandingEnabled,
                  }}
                />
                <FormMessage />
              </FormItem>
            )}
          />

          {/* 备注 */}
          <FormField
            control={form.control}
            name="extras"
            render={({ field }) => (
              <FormItem>
                <SectionHeader title="备注" tip="可在 Prompt 结尾附加自定义说明" />
                <Textarea placeholder="笔记需要罗列出 xxx 关键点…" {...field} />
                <FormMessage />
              </FormItem>
            )}
          />

        </form>
      </Form>
    </div>
  )
}

export default NoteForm
