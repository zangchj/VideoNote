import { FC, useEffect, useState } from 'react'
import HomeLayout from '@/layouts/HomeLayout.tsx'
import NoteForm from '@/pages/HomePage/components/NoteForm.tsx'
import MarkdownViewer from '@/pages/HomePage/components/MarkdownViewer.tsx'
import { useTaskStore } from '@/store/taskStore'
import History from '@/pages/HomePage/components/History.tsx'
import { useTaskPolling } from '@/hooks/useTaskPolling'
type ViewStatus = 'idle' | 'loading' | 'success' | 'failed'
export const HomePage: FC = () => {
  // start polling background tasks
  useTaskPolling(3000)
  const tasks = useTaskStore(state => state.tasks)
  const currentTaskId = useTaskStore(state => state.currentTaskId)
  const normalizeTitles = useTaskStore(state => state.normalizeTitles)

  const currentTask = tasks.find(t => t.id === currentTaskId)

  const [status, setStatus] = useState<ViewStatus>('idle')
  const content = currentTask?.markdown || ''

  useEffect(() => {
    if (!currentTask) {
      setStatus('idle')
    } else if (currentTask.status === 'SUCCESS') {
      setStatus('success')
    } else if (currentTask.status === 'FAILED') {
      setStatus('failed')
    } else {
      // Any other intermediate status (PARSING, DOWNLOADING, TRANSCRIBING, etc) => show loading/progress
      setStatus('loading')
    }
  }, [currentTask])

  // fix legacy titles (use filename when applicable)
  useEffect(() => {
    if (typeof normalizeTitles === 'function') {
      try {
        normalizeTitles()
      } catch (e) {
        // swallow to avoid crashing the page during HMR/persist mismatch
        console.warn('normalizeTitles failed:', e)
      }
    }
  }, [])

  // useEffect( () => {
  //     get_task_status('d4e87938-c066-48a0-bbd5-9bec40d53354').then(res=>{
  //         console.log('res1',res)
  //         setContent(res.data.result.markdown)
  //     })
  // }, [tasks]);
  return (
    <HomeLayout
      NoteForm={<NoteForm />}
      Preview={<MarkdownViewer content={content} status={status} />}
      History={<History />}
    />
  )
}
