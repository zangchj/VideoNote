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
}): Promise<any> => {
  try {
    console.log('generateNote', data)
    // NOTE: `request` interceptor usually returns the backend `data` payload (request.ts returns res.data)
    // but be defensive: handle both the payload shape and the full IResponse shape.
    const response: any = await request.post('/generate_note', data)

    // Normalize response to payload (the meaningful data part)
    let payload: any = response

    // If we accidentally received the full wrapper { code, msg, data }, unwrap it
    if (response && typeof response === 'object' && 'code' in response) {
      if (response.code === 0) {
        payload = response.data
      } else {
        console.error('generateNote: server returned error wrapper', response)
        toast.error(response.msg || '服务器返回错误')
        throw new Error(response.msg || 'Server error')
      }
    }

    // At this point payload should be the backend data object (e.g. { task_id: '...' })
    if (!payload) {
      console.error('generateNote: invalid response payload from server', response)
      toast.error('请求失败，未收到有效响应')
      throw new Error('No response data')
    }

    // If payload contains an error-like structure, surface it
    if (payload && (payload.msg || payload.error)) {
      console.error('generateNote: payload indicates error', payload)
      toast.error(payload.msg || payload.error || '服务器返回错误')
      throw new Error(payload.msg || payload.error || 'Server error')
    }

    // success
    toast.success('笔记生成任务已提交！')
    console.log('generateNote result payload:', payload)
    return payload
  } catch (e: any) {
    // request.ts interceptor already shows a toast for network/backend errors. Add logging and rethrow
    console.error('❌ generateNote 请求出错', e)
    // If the thrown object contains a user-friendly msg, show it
    if (e && e.msg) {
      toast.error(e.msg)
    }
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
