import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { delete_task, generateNote } from '@/services/note.ts'
import { v4 as uuidv4 } from 'uuid'
import toast from 'react-hot-toast'


export type TaskStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED'

export interface AudioMeta {
  cover_url: string
  duration: number
  file_path: string
  platform: string
  raw_info: any
  title: string
  video_id: string
}

export interface Segment {
  start: number
  end: number
  text: string
}

export interface Transcript {
  full_text: string
  language: string
  raw: any
  segments: Segment[]
}
export interface Markdown {
  ver_id: string
  content: string
  style: string
  model_name: string
  created_at: string
}

export interface Task {
  id: string
  markdown: string|Markdown [] //为了兼容之前的笔记
  transcript: Transcript
  status: TaskStatus
  audioMeta: AudioMeta
  // store top-level platform for convenience (used in some places)
  platform?: string
  createdAt: string
  formData: {
    video_url?: string
    link: undefined | boolean
    screenshot: undefined | boolean
    platform?: string
    quality?: string
    model_name?: string
    provider_id?: string
    // optional fields used elsewhere
    style?: string
    extras?: string
    video_understanding?: boolean
    video_interval?: number
    grid_size?: any
    format?: any[]
  }
}

interface TaskStore {
  tasks: Task[]
  currentTaskId: string | null
  addPendingTask: (taskId: string, platform: string, formData?: any) => void
  updateTaskContent: (id: string, data: Partial<Omit<Task, 'id' | 'createdAt'>>) => void
  removeTask: (id: string) => void
  clearTasks: () => void
  setCurrentTask: (taskId: string | null) => void
  getCurrentTask: () => Task | null
  retryTask: (id: string) => void
  normalizeTitles: () => void
}

export const useTaskStore = create<TaskStore>()(
  persist(
    (set, get) => ({
      tasks: [],
      currentTaskId: null,

      addPendingTask: (taskId: string, platform: string, formData: any) =>
        set(state => {
          // derive a reasonable title: prefer provided video_url filename, then explicit title, then model_name
          let title = ''
          if (formData) {
            if (formData.video_url) {
              try {
                const u = String(formData.video_url)
                let name = u.split('/').pop() || u
                // strip extension if exists
                name = name.replace(/\.[^.]+$/, '')
                title = name
              } catch (e) {
                title = String(formData.video_url)
              }
            }
            if (!title) title = formData.title || formData.model_name || ''
          }

          return {
            tasks: [
              {
                formData: formData,
                id: taskId,
                status: 'PENDING',
                markdown: '',
                platform: platform,
                transcript: {
                  full_text: '',
                  language: '',
                  raw: null,
                  segments: [],
                },
                createdAt: new Date().toISOString(),
                audioMeta: {
                  cover_url: '',
                  duration: 0,
                  file_path: '',
                  platform: '',
                  raw_info: null,
                  title: title || '未命名笔记',
                  video_id: '',
                },
              },
              ...state.tasks,
            ],
            currentTaskId: taskId, // 默认设置为当前任务
          }
        }),

      updateTaskContent: (id, data) =>
          set(state => ({
            tasks: state.tasks.map(task => {
              if (task.id !== id) return task

              if (task.status === 'SUCCESS' && data.status === 'SUCCESS') return task

              // 如果是 markdown 字符串，封装为版本
              if (typeof data.markdown === 'string') {
                const prev = task.markdown
                const newVersion: Markdown = {
                  ver_id: `${task.id}-${uuidv4()}`,
                  content: data.markdown,
                  style: task.formData.style || '',
                  model_name: task.formData.model_name || '',
                  created_at: new Date().toISOString(),
                }

                let updatedMarkdown: Markdown[]
                if (Array.isArray(prev)) {
                  updatedMarkdown = [newVersion, ...prev]
                } else if (prev) {
                  // prev is a non-empty string
                  updatedMarkdown = [
                    newVersion,
                    {
                      ver_id: `${task.id}-${uuidv4()}`,
                      content: prev,
                      style: task.formData.style || '',
                      model_name: task.formData.model_name || '',
                      created_at: new Date().toISOString(),
                    },
                  ]
                } else {
                  updatedMarkdown = [newVersion]
                }

                return {
                  ...task,
                  ...data,
                  markdown: updatedMarkdown,
                }
              }

              return { ...task, ...data }
            }),
          })),


      getCurrentTask: () => {
        const currentTaskId = get().currentTaskId
        return get().tasks.find(task => task.id === currentTaskId) || null
      },
      retryTask: async (id: string, payload?: any) => {

        if (!id){
          toast.error('任务不存在')
          return
        }
        const task = get().tasks.find(task => task.id === id)
        console.log('retry',task)
        if (!task) return

        const newFormData = payload || task.formData
        await generateNote({
          ...newFormData,
          task_id: id,
        })

        set(state => ({
          tasks: state.tasks.map(t =>
              t.id === id
                  ? {
                    ...t,
                    formData: newFormData, // ✅ 显式更新 formData
                    status: 'PENDING',
                  }
                  : t
          ),
        }))
      },


      removeTask: async id => {
        const task = get().tasks.find(t => t.id === id)

        // 更新 Zustand 状态
        set(state => ({
          tasks: state.tasks.filter(task => task.id !== id),
          currentTaskId: state.currentTaskId === id ? null : state.currentTaskId,
        }))

        // 调用后端删除接口（如果找到了任务）
        if (task) {
          await delete_task({
            video_id: task.audioMeta.video_id,
            platform: task.platform || '',
          })
        }
      },

      clearTasks: () => set({ tasks: [], currentTaskId: null }),

      setCurrentTask: taskId => set({ currentTaskId: taskId }),

      // Normalize existing task titles: if title is empty or equals the model_name, use filename from formData.video_url without extension
      normalizeTitles: () =>
        set(state => ({
          tasks: state.tasks.map(t => {
            const curTitle = t.audioMeta?.title || ''
            if ((curTitle === '' || curTitle === t.formData?.model_name) && t.formData?.video_url) {
              try {
                const u = String(t.formData.video_url)
                let name = u.split('/').pop() || u
                name = name.replace(/\.[^.]+$/, '')
                return { ...t, audioMeta: { ...t.audioMeta, title: name } }
              } catch (e) {
                return t
              }
            }
            return t
          }),
        })),
     }),
     {
       name: 'task-storage',
     }
   )
 )
