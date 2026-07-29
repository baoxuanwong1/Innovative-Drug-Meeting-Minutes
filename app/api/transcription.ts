const dashscopeApiUrl = 'https://dashscope.aliyuncs.com/api/v1'

const requiredEnv = (key: string) => {
  const value = process.env[key]
  if (!value) throw new Error(`Missing environment variable: ${key}`)
  return value
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const submitTask = async (audioUrl: string) => {
  const response = await fetch(`${dashscopeApiUrl}/services/audio/asr/transcription`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requiredEnv('DASHSCOPE_API_KEY')}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model: process.env.DASHSCOPE_ASR_MODEL || 'paraformer-v2',
      input: { file_urls: [audioUrl] },
      parameters: {
        language_hints: ['zh', 'en'],
        disfluency_removal_enabled: true,
        timestamp_alignment_enabled: true,
        diarization_enabled: true,
      },
    }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.message || payload?.error || `提交转写任务失败：${response.status}`)
  if (!payload?.output?.task_id) throw new Error('语音转写服务未返回任务 ID。')
  return payload.output.task_id as string
}

const waitForTask = async (taskId: string) => {
  const maxAttempts = Number(process.env.DASHSCOPE_ASR_MAX_ATTEMPTS || 36)
  const intervalMs = Number(process.env.DASHSCOPE_ASR_POLL_INTERVAL_MS || 5000)
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(`${dashscopeApiUrl}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${requiredEnv('DASHSCOPE_API_KEY')}` },
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(payload?.message || payload?.error || `查询转写任务失败：${response.status}`)
    const status = payload?.output?.task_status
    if (status === 'SUCCEEDED') {
      const transcriptionUrl = payload?.output?.results?.[0]?.transcription_url
      if (!transcriptionUrl) throw new Error('转写任务已完成，但未返回转写结果。')
      return { transcriptionUrl, task: payload }
    }
    if (status === 'FAILED' || status === 'CANCELED')
      throw new Error(payload?.output?.message || payload?.message || `转写任务${status}。`)
    await sleep(intervalMs)
  }
  throw new Error('转写任务仍在处理中。请尝试较短的录音，或提高轮询次数。')
}

const collectTextValues = (value: any, texts: string[]) => {
  if (!value) return
  if (Array.isArray(value)) {
    value.forEach(item => collectTextValues(item, texts))
    return
  }
  if (typeof value === 'object') {
    const text = value.text || value.sentence || value.transcript
    if (typeof text === 'string' && text.trim()) texts.push(text.trim())
    Object.keys(value).forEach((key) => {
      if (!['text', 'sentence', 'transcript'].includes(key)) collectTextValues(value[key], texts)
    })
  }
}

const downloadTranscript = async (url: string) => {
  const response = await fetch(url)
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`下载转写结果失败：${response.status}`)
  const texts: string[] = []
  collectTextValues(payload?.transcripts || payload?.sentences || payload, texts)
  const transcript = texts.filter((text, index) => texts.indexOf(text) === index).join('\n')
  if (!transcript) throw new Error('转写结果中未找到可用文字。')
  return transcript
}

export const transcribeMedia = async (audioUrl: string) => {
  const taskId = await submitTask(audioUrl)
  const { transcriptionUrl, task } = await waitForTask(taskId)
  const transcript = await downloadTranscript(transcriptionUrl)
  return { transcript, taskId, task }
}
