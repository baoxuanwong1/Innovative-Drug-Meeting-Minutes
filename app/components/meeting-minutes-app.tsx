'use client'

import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type SubmitState = 'idle' | 'uploading' | 'running' | 'done' | 'error'

const defaultTemplate = `# 会议纪要

## 一、会议基本信息
- 会议主题：
- 会议日期：
- 涉及公司/标的：
- 涉及产品/管线：
- 主要发言人/角色：

## 二、核心结论

## 三、会议内容纪要

## 四、重点公司/产品信息

## 五、问答纪要

## 六、风险点与待确认事项

## 七、关键数据与原文依据`

const parseResponse = async (response: Response) => {
  const text = await response.text()

  if (!text)
    return {}

  try {
    return JSON.parse(text)
  }
  catch {
    return {
      error: text,
    }
  }
}

const MeetingMinutesApp = () => {
  const [file, setFile] = useState<File | null>(null)
  const [meetingTitle, setMeetingTitle] = useState('')
  const [meetingDate, setMeetingDate] = useState('')
  const [meetingBackground, setMeetingBackground] = useState('')
  const [focusPoints, setFocusPoints] = useState('')
  const [templateStyle, setTemplateStyle] = useState(defaultTemplate)
  const [minutes, setMinutes] = useState('')
  const [error, setError] = useState('')
  const [state, setState] = useState<SubmitState>('idle')

  const statusText = useMemo(() => {
    if (state === 'uploading')
      return '正在上传音视频到 OSS'
    if (state === 'running')
      return '正在调用 Dify 工作流生成会议纪要'
    if (state === 'done')
      return '会议纪要已生成'
    if (state === 'error')
      return '生成失败'
    return '等待上传'
  }, [state])

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0]
    setError('')
    setMinutes('')

    if (!nextFile) {
      setFile(null)
      return
    }

    const extension = nextFile.name.split('.').pop()?.toLowerCase()
    const isAllowed = extension && ['mp3', 'm4a', 'wav', 'mp4', 'mov'].includes(extension)

    if (!isAllowed) {
      setFile(null)
      setError('请上传 mp3、m4a、wav、mp4 或 mov 文件。')
      return
    }

    setFile(nextFile)
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!file) {
      setError('请先选择会议录音或视频文件。')
      return
    }

    setError('')
    setMinutes('')
    setState('uploading')

    try {
      const uploadUrlResponse = await fetch('/api/oss-upload-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: file.name,
          content_type: file.type || 'application/octet-stream',
        }),
      })
      const uploadPayload = await parseResponse(uploadUrlResponse)

      if (!uploadUrlResponse.ok)
        throw new Error(uploadPayload.error || 'OSS 上传链接生成失败。')

      const ossResponse = await fetch(uploadPayload.upload_url, {
        method: 'PUT',
        headers: {
          'Content-Type': uploadPayload.content_type,
        },
        body: file,
      })

      if (!ossResponse.ok) {
        const message = await ossResponse.text().catch(() => '')
        throw new Error(message || `OSS 上传失败：${ossResponse.status}`)
      }

      setState('running')
      const response = await fetch('/api/meeting-minutes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audio_url: uploadPayload.audio_url,
          meeting_title: meetingTitle,
          meeting_date: meetingDate,
          meeting_background: meetingBackground,
          focus_points: focusPoints,
          template_style: templateStyle,
        }),
      })

      const payload = await parseResponse(response)

      if (!response.ok)
        throw new Error(payload.error || '会议纪要生成失败。')

      setMinutes(payload.meeting_minutes || '')
      setState('done')
    }
    catch (err: any) {
      setState('error')
      setError(err.message || '会议纪要生成失败。')
    }
  }

  const handleCopy = async () => {
    if (minutes)
      await navigator.clipboard.writeText(minutes)
  }

  const handleDownload = () => {
    if (!minutes)
      return

    const blob = new Blob([minutes], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${meetingTitle || 'meeting-minutes'}.md`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-2 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal text-slate-950">医药会议纪要生成器</h1>
            <p className="mt-1 text-sm text-slate-500">上传录音或视频，自动转写并按模板生成投研会议纪要。</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            {statusText}
          </div>
        </header>

        <div className="grid flex-1 gap-5 py-5 lg:grid-cols-[420px_minmax(0,1fr)]">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-slate-700">会议录音/视频</span>
              <input
                type="file"
                accept=".mp3,.m4a,.wav,.mp4,.mov,audio/*,video/mp4,video/quicktime"
                onChange={handleFileChange}
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
              />
              {file && (
                <span className="text-xs text-slate-500">
                  {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
                </span>
              )}
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-slate-700">会议标题</span>
              <input
                value={meetingTitle}
                onChange={event => setMeetingTitle(event.target.value)}
                placeholder="例如：某创新药公司专家交流会"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-600"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-slate-700">会议日期</span>
              <input
                value={meetingDate}
                onChange={event => setMeetingDate(event.target.value)}
                placeholder="例如：2026-06-03"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-600"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-slate-700">会议背景</span>
              <textarea
                value={meetingBackground}
                onChange={event => setMeetingBackground(event.target.value)}
                rows={4}
                placeholder="公司、行业、参会人、会议主题等背景。"
                className="resize-none rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-600"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-slate-700">特别关注点</span>
              <textarea
                value={focusPoints}
                onChange={event => setFocusPoints(event.target.value)}
                rows={3}
                placeholder="例如：管线进展、临床数据、商业化、BD、财务、风险。"
                className="resize-none rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-600"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-slate-700">会议纪要模板</span>
              <textarea
                value={templateStyle}
                onChange={event => setTemplateStyle(event.target.value)}
                rows={9}
                className="resize-none rounded-md border border-slate-300 px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-slate-600"
              />
            </label>

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={state === 'uploading' || state === 'running'}
              className="rounded-md bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {state === 'uploading' || state === 'running' ? '生成中...' : '生成会议纪要'}
            </button>
          </form>

          <section className="flex min-h-[640px] flex-col rounded-md border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-base font-semibold text-slate-900">会议纪要</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={!minutes}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                >
                  复制
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={!minutes}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
                >
                  下载
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto px-5 py-4">
              {minutes ? (
                <article className="prose prose-slate max-w-none prose-headings:tracking-normal prose-h1:text-2xl prose-h2:text-lg prose-p:leading-7">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{minutes}</ReactMarkdown>
                </article>
              ) : (
                <div className="flex h-full min-h-[520px] items-center justify-center text-sm text-slate-400">
                  生成后的会议纪要会显示在这里。
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

export default MeetingMinutesApp
