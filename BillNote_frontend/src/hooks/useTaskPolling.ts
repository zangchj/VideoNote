import { useEffect, useRef } from 'react'
import { useTaskStore } from '@/store/taskStore'
import { get_task_status } from '@/services/note.ts'

export const useTaskPolling = (interval = 3000) => {
  // tasksRef will be updated via subscribe; avoid using useTaskStore hook directly here
  const tasksRef = useRef<any[]>(useTaskStore.getState().tasks || [])

  // Grab a stable reference to the updateTaskContent function via store getter (avoid creating a hook subscription)
  const updateTaskContent = useRef(useTaskStore.getState().updateTaskContent).current

  useEffect(() => {
    // subscribe to tasks changes and update the ref; this avoids useSyncExternalStore/getSnapshot warnings
    const unsub = useTaskStore.subscribe((state: any) => {
      tasksRef.current = state?.tasks || []
    })

    return () => unsub()
  }, [])

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const pendingTasks = (tasksRef.current || []).filter(
          (task: any) => task.status !== 'SUCCESS' && task.status !== 'FAILED'
        )

        for (const task of pendingTasks) {
          try {
            console.log('🔄 正在轮询任务：', task.id)
            const res = await get_task_status(task.id)
            const resp: any = res
            const status = resp?.status

            if (status && status !== task.status) {
              if (status === 'SUCCESS') {
                const { markdown, transcript, audio_meta } = resp.result || {}
                console.log('笔记生成成功', task.id)
                updateTaskContent(task.id, {
                  status,
                  markdown,
                  transcript,
                  audioMeta: audio_meta,
                })
              } else if (status === 'FAILED') {
                updateTaskContent(task.id, { status })
                console.warn(`⚠️ 任务 ${task.id} 失败`)
              } else {
                updateTaskContent(task.id, { status })
              }
            }
          } catch (e) {
            console.error('❌ 单个任务轮询失败，稍后重试：', e)
          }
        }
      } catch (e) {
        console.error('❌ 任务轮询循环发生错误：', e)
      }
    }, interval)

    return () => clearInterval(timer)
  }, [interval, updateTaskContent])
}
