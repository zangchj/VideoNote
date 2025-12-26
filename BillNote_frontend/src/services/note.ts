import request from '@/utils/request'
import toast from 'react-hot-toast'

export const generateNote = async (data: {
  video_url: string
  platform: string
  quality: string
  model_name: string
  provider_id: string
  task_id?: string
  format: Array<string>
  style: string
  extras?: string
  video_understand?: boolean
  video_interval?: number
  grid_size: Array<number>
}): Promise<any | null> => {
  try {
    console.log('generateNote', data)
    const response: any = await request.post('/generate_note', data)

    // Defensive checks: ensure we have a response and a data payload
    if (!response || !response.data) {
      toast.error('请求失败，未收到有效响应')
      return null
    }

    // If backend returns an error message in data.msg, show it and bail
    if (response.data.msg) {
      toast.error(response.data.msg)
      return null
    }

    toast.success('笔记生成任务已提交！')

    console.log('res', response)
    return response
  } catch (e: any) {
    console.error('❌ 请求出错', e)
    // Allow caller to handle error details
    throw e
  }
}

export const delete_task = async ({ video_id, platform }: { video_id: string; platform: string }): Promise<any> => {
  try {
    const data = {
      video_id,
      platform,
    }
    const res: any = await request.post('/delete_task', data)

    toast.success('任务已成功删除')
    return res
  } catch (e: any) {
    toast.error('请求异常，删除任务失败')
    console.error('❌ 删除任务失败:', e)
    throw e
  }
}

export const get_task_status = async (task_id: string): Promise<any> => {
  try {
    const res: any = await request.get('/task_status/' + task_id)
    return res
  } catch (e: any) {
    console.error('❌ 请求出错', e)
    throw e
  }
}
