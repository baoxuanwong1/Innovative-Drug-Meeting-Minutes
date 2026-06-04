import OSS from 'ali-oss'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 300

const dashscopeApiUrl = 'https://dashscope.aliyuncs.com/api/v1'
const openAiCompatibleUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

const requiredEnv = (key: string) => {
  const value = process.env[key]
  if (!value)
    throw new Error(`Missing environment variable: ${key}`)
  return value
}

const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_')

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const getOssClient = () => {
  return new OSS({
    region: requiredEnv('ALI_OSS_REGION'),
    accessKeyId: requiredEnv('ALI_OSS_ACCESS_KEY_ID'),
    accessKeySecret: requiredEnv('ALI_OSS_ACCESS_KEY_SECRET'),
    bucket: requiredEnv('ALI_OSS_BUCKET'),
    secure: true,
  })
}

const buildError = (message: string, status = 500) => {
  return NextResponse.json({ error: message }, { status })
}

const dashscopeHeaders = () => ({
  Authorization: `Bearer ${requiredEnv('DASHSCOPE_API_KEY')}`,
  'Content-Type': 'application/json',
})

const submitTranscriptionTask = async (audioUrl: string) => {
  const response = await fetch(`${dashscopeApiUrl}/services/audio/asr/transcription`, {
    method: 'POST',
    headers: {
      ...dashscopeHeaders(),
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model: process.env.DASHSCOPE_ASR_MODEL || 'paraformer-v2',
      input: {
        file_urls: [audioUrl],
      },
      parameters: {
        language_hints: ['zh', 'en'],
        disfluency_removal_enabled: true,
        timestamp_alignment_enabled: true,
        diarization_enabled: true,
      },
    }),
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const message = payload?.message || payload?.error || `Failed to submit ASR task: ${response.status}`
    throw new Error(message)
  }

  const taskId = payload?.output?.task_id
  if (!taskId)
    throw new Error('Bailian ASR did not return output.task_id.')

  return taskId
}

const queryTranscriptionTask = async (taskId: string) => {
  const response = await fetch(`${dashscopeApiUrl}/tasks/${taskId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${requiredEnv('DASHSCOPE_API_KEY')}`,
    },
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const message = payload?.message || payload?.error || `Failed to query ASR task: ${response.status}`
    throw new Error(message)
  }

  return payload
}

const waitForTranscription = async (taskId: string) => {
  const maxAttempts = Number(process.env.DASHSCOPE_ASR_MAX_ATTEMPTS || 36)
  const intervalMs = Number(process.env.DASHSCOPE_ASR_POLL_INTERVAL_MS || 5000)

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const payload = await queryTranscriptionTask(taskId)
    const status = payload?.output?.task_status

    if (status === 'SUCCEEDED') {
      const transcriptionUrl = payload?.output?.results?.[0]?.transcription_url
      if (!transcriptionUrl)
        throw new Error('ASR task succeeded, but no transcription_url was returned.')
      return { payload, transcriptionUrl }
    }

    if (status === 'FAILED' || status === 'CANCELED') {
      const message = payload?.output?.message || payload?.message || `ASR task ${status}.`
      throw new Error(message)
    }

    await sleep(intervalMs)
  }

  throw new Error('ASR task is still running. Try a shorter audio/video, or increase DASHSCOPE_ASR_MAX_ATTEMPTS.')
}

const downloadTranscription = async (transcriptionUrl: string) => {
  const response = await fetch(transcriptionUrl)
  const payload = await response.json().catch(() => null)

  if (!response.ok)
    throw new Error(`Failed to download transcription JSON: ${response.status}`)

  return payload
}

const collectTextValues = (value: any, texts: string[]) => {
  if (!value)
    return

  if (Array.isArray(value)) {
    value.forEach(item => collectTextValues(item, texts))
    return
  }

  if (typeof value === 'object') {
    const text = value.text || value.sentence || value.transcript
    if (typeof text === 'string' && text.trim())
      texts.push(text.trim())

    Object.keys(value).forEach((key) => {
      if (!['text', 'sentence', 'transcript'].includes(key))
        collectTextValues(value[key], texts)
    })
  }
}

const extractTranscript = (payload: any) => {
  const texts: string[] = []

  collectTextValues(payload?.transcripts || payload?.sentences || payload, texts)

  const uniqueTexts = texts.filter((text, index) => texts.indexOf(text) === index)
  const transcript = uniqueTexts.join('\n')

  if (!transcript)
    throw new Error('No transcript text was found in the ASR result.')

  return transcript
}

const buildMeetingPrompt = ({
  transcript,
  meetingTitle,
  meetingDate,
  meetingBackground,
  focusPoints,
  templateStyle,
}: {
  transcript: string
  meetingTitle: string
  meetingDate: string
  meetingBackground: string
  focusPoints: string
  templateStyle: string
}) => {
  return `请根据以下会议转写稿生成会议纪要。

会议标题：
${meetingTitle}

会议日期：
${meetingDate}

会议背景：
${meetingBackground}

特别关注点：
${focusPoints}

用户提供的模板或风格要求：
${templateStyle}

会议转写稿：
${transcript}

要求：
1. 只基于转写稿和用户提供的背景信息，不得编造事实、数据、日期、公司名、药品名或结论。
2. 如果信息不确定，必须标注“待确认”。
3. 重点提取公司、产品管线、适应症、临床数据、审批进展、商业化、BD、风险点和待确认事项。
4. 如果会议中存在问答内容，整理为“问：/答：”格式。
5. 输出中文 Markdown。
6. 不要输出原始逐字稿，不要说明处理过程。`
}

const generateMeetingMinutes = async (prompt: string) => {
  const response = await fetch(openAiCompatibleUrl, {
    method: 'POST',
    headers: dashscopeHeaders(),
    body: JSON.stringify({
      model: process.env.DASHSCOPE_LLM_MODEL || 'qwen-plus',
      messages: [
        {
          role: 'system',
          content: '你是资深医药行业会议纪要撰写助手，擅长将会议转写稿整理成正式、清晰、适合投研使用的会议纪要。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
    }),
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `Failed to generate meeting minutes: ${response.status}`
    throw new Error(message)
  }

  const meetingMinutes = payload?.choices?.[0]?.message?.content

  if (!meetingMinutes)
    throw new Error('Qwen did not return meeting minutes.')

  return { meetingMinutes, payload }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')

    if (!(file instanceof File))
      return buildError('No audio or video file was uploaded.', 400)

    const buffer = Buffer.from(await file.arrayBuffer())
    const objectName = `meeting-media/${Date.now()}-${safeName(file.name)}`
    const ossClient = getOssClient()

    await ossClient.put(objectName, buffer, {
      headers: {
        'content-type': file.type || 'application/octet-stream',
      },
    })

    const expires = Number(process.env.ALI_OSS_SIGNED_URL_EXPIRES || 3600)
    const audioUrl = ossClient.signatureUrl(objectName, {
      expires,
      method: 'GET',
    })

    const meetingTitle = String(formData.get('meeting_title') || '')
    const meetingDate = String(formData.get('meeting_date') || '')
    const meetingBackground = String(formData.get('meeting_background') || '')
    const focusPoints = String(formData.get('focus_points') || '')
    const templateStyle = String(formData.get('template_style') || '')

    const taskId = await submitTranscriptionTask(audioUrl)
    const { transcriptionUrl, payload: taskPayload } = await waitForTranscription(taskId)
    const transcriptionPayload = await downloadTranscription(transcriptionUrl)
    const transcript = extractTranscript(transcriptionPayload)
    const prompt = buildMeetingPrompt({
      transcript,
      meetingTitle,
      meetingDate,
      meetingBackground,
      focusPoints,
      templateStyle,
    })
    const { meetingMinutes, payload: llmPayload } = await generateMeetingMinutes(prompt)

    return NextResponse.json({
      meeting_minutes: meetingMinutes,
      transcript,
      audio_url: audioUrl,
      asr_task_id: taskId,
      asr_task: taskPayload,
      llm: llmPayload,
    })
  }
  catch (error: any) {
    return buildError(error.message || 'Failed to generate meeting minutes.')
  }
}
