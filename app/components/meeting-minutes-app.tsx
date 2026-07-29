'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type SubmitState = 'idle' | 'uploading' | 'transcribing' | 'transcribed' | 'writing' | 'done' | 'error'
type UploadedFile = { name: string; url: string; type: string }

const mediaExtensions = new Set(['mp3', 'm4a', 'wav', 'aac', 'ogg', 'flac', 'mp4', 'mov', 'mkv', 'webm'])
const maxMediaSize = 2 * 1024 * 1024 * 1024
const maxReferenceFiles = 8
const maxReferenceSize = 20 * 1024 * 1024

const parseResponse = async (response: Response) => {
  const text = await response.text()
  try { return text ? JSON.parse(text) : {} } catch { return { error: text } }
}

const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() || ''
const formatSize = (size: number) => `${(size / 1024 / 1024).toFixed(size > 1024 * 1024 * 1024 ? 0 : 1)} ${size > 1024 * 1024 * 1024 ? 'GB' : 'MB'}`

const statusLabels: Record<SubmitState, string> = {
  idle: '等待文件', uploading: '正在上传文件', transcribing: '正在将音视频转为文字',
  transcribed: '转写稿已就绪，等待生成纪要', writing: '正在按纪要规范整理全文',
  done: '会议纪要已完成', error: '处理失败',
}

const MeetingMinutesApp = () => {
  const [mediaFile, setMediaFile] = useState<File | null>(null)
  const [referenceFiles, setReferenceFiles] = useState<File[]>([])
  const [uploadedReferences, setUploadedReferences] = useState<UploadedFile[]>([])
  const [meetingTitle, setMeetingTitle] = useState('')
  const [meetingDate, setMeetingDate] = useState('')
  const [meetingBackground, setMeetingBackground] = useState('')
  const [focusPoints, setFocusPoints] = useState('')
  const [transcript, setTranscript] = useState('')
  const [minutes, setMinutes] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [state, setState] = useState<SubmitState>('idle')

  const isProcessing = ['uploading', 'transcribing', 'writing'].includes(state)
  const hasTranscript = Boolean(transcript.trim())

  const resetGeneratedContent = () => {
    setTranscript(''); setMinutes(''); setUploadedReferences([]); setNotice('')
    if (!isProcessing) setState('idle')
  }

  const handleMediaChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null
    setError(''); resetGeneratedContent()
    if (!file) return setMediaFile(null)
    if (!mediaExtensions.has(extensionOf(file.name))) {
      setMediaFile(null)
      return setError('请上传 mp3、wav、m4a、mp4、mov 等常见音视频文件。')
    }
    if (file.size > maxMediaSize) {
      setMediaFile(null)
      return setError('音视频文件不能超过 2 GB。')
    }
    setMediaFile(file)
  }

  const handleReferencesChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    setError(''); resetGeneratedContent()
    if (files.length > maxReferenceFiles) return setError(`一次最多添加 ${maxReferenceFiles} 个参考附件。`)
    if (files.some(file => file.size > maxReferenceSize)) return setError('单个参考附件不能超过 20 MB。')
    setReferenceFiles(files)
  }

  const uploadFile = async (file: File): Promise<UploadedFile> => {
    const signedUrlResponse = await fetch('/api/oss-upload-url', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, content_type: file.type || 'application/octet-stream' }),
    })
    const payload = await parseResponse(signedUrlResponse)
    if (!signedUrlResponse.ok) throw new Error(payload.error || `无法为「${file.name}」创建上传链接。`)
    const uploadResponse = await fetch(payload.upload_url, {
      method: 'PUT', headers: { 'Content-Type': payload.content_type }, body: file,
    })
    if (!uploadResponse.ok) throw new Error(`「${file.name}」上传失败。`)
    return { name: file.name, url: payload.file_url, type: file.type || 'application/octet-stream' }
  }

  const transcribe = async () => {
    if (!mediaFile) throw new Error('请先选择会议录音或视频文件。')
    setState('uploading')
    const [media, ...references] = await Promise.all([uploadFile(mediaFile), ...referenceFiles.map(uploadFile)])
    setUploadedReferences(references)
    setState('transcribing')
    const response = await fetch('/api/transcribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio_url: media.url }),
    })
    const payload = await parseResponse(response)
    if (!response.ok) throw new Error(payload.error || '音视频转文字失败。')
    setTranscript(payload.transcript || '')
    setState('transcribed')
    setNotice('转写稿已生成。请先核对、补充或修订，再生成正式会议纪要。')
  }

  const generateMinutes = async () => {
    if (!transcript.trim()) throw new Error('请先完成音视频转文字，并确认转写稿不为空。')
    setState('writing')
    const response = await fetch('/api/meeting-minutes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript, references: uploadedReferences, meeting_title: meetingTitle, meeting_date: meetingDate,
        meeting_background: meetingBackground, focus_points: focusPoints,
      }),
    })
    const payload = await parseResponse(response)
    if (!response.ok) throw new Error(payload.error || '会议纪要生成失败。')
    setMinutes(payload.meeting_minutes || '')
    setState('done')
    setNotice('会议纪要已生成。你可以复制或下载 Markdown 文件。')
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(''); setNotice('')
    try {
      if (hasTranscript) await generateMinutes()
      else await transcribe()
    }
    catch (err: any) {
      setState('error'); setError(err.message || '处理失败。')
    }
  }

  const downloadMarkdown = () => {
    if (!minutes) return
    const url = URL.createObjectURL(new Blob([minutes], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = `${meetingTitle || '会议纪要'}.md`; link.click(); URL.revokeObjectURL(url)
  }

  return (
    <main className="min-h-screen bg-[#f6f7f4] text-[#17211d]">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-[#dfe4dc] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#58715f]">Medical research workflow</p><h1 className="font-serif text-3xl font-semibold tracking-tight text-[#173d2a] sm:text-4xl">创新药会议纪要助手</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#66736b]">先将会议录音或视频转为完整文字稿，再由你确认后生成符合投研规范的全量会议纪要。</p></div>
          <div className="rounded-full border border-[#cbd8cc] bg-[#edf5ed] px-4 py-2 text-sm font-medium text-[#386044]">{statusLabels[state]}</div>
        </header>

        <ol className="my-6 grid gap-2 text-sm sm:grid-cols-3">
          {['上传音视频与资料', '音视频转文字并核对', '生成全量会议纪要'].map((step, index) => {
            const active = (index === 0 && !hasTranscript) || (index === 1 && hasTranscript && !minutes) || (index === 2 && Boolean(minutes))
            return <li key={step} className={`rounded-xl border px-4 py-3 ${active ? 'border-[#8eae91] bg-[#edf5ed] text-[#204d2e]' : 'border-[#dde4dc] bg-white text-[#718074]'}`}><span className="mr-2 font-serif text-base font-semibold">{index + 1}</span>{step}</li>
          })}
        </ol>

        <div className="grid gap-6 pb-6 lg:grid-cols-[410px_minmax(0,1fr)]">
          <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-[#dde4dc] bg-white p-5 shadow-[0_12px_32px_rgba(28,55,38,0.06)]">
            <section><div className="mb-3 flex items-baseline justify-between"><h2 className="font-serif text-lg font-semibold text-[#173d2a]">1. 会议文件</h2><span className="text-xs text-[#758177]">必填</span></div><label className="block rounded-xl border border-dashed border-[#aec2ae] bg-[#f7fbf6] p-4 transition hover:border-[#56805e]"><span className="block text-sm font-medium text-[#294a35]">录音或视频</span><span className="mt-1 block text-xs leading-5 text-[#6d7a70]">支持 mp3、wav、m4a、mp4、mov、mkv、webm，最大 2 GB。</span><input type="file" accept="audio/*,video/*,.m4a,.mkv" onChange={handleMediaChange} className="mt-3 block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-[#173d2a] file:px-3 file:py-2 file:text-xs file:font-medium file:text-white" />{mediaFile && <span className="mt-3 block break-all text-xs font-medium text-[#3f684b]">已选择：{mediaFile.name} · {formatSize(mediaFile.size)}</span>}</label></section>
            <section><div className="mb-3 flex items-baseline justify-between"><h2 className="font-serif text-lg font-semibold text-[#173d2a]">2. 参考资料</h2><span className="text-xs text-[#758177]">可选</span></div><label className="block rounded-xl border border-dashed border-[#d3ddd2] bg-[#fafcf9] p-4 transition hover:border-[#8ca58f]"><span className="block text-sm font-medium text-[#294a35]">PPT / PDF / Office / 文本附件</span><span className="mt-1 block text-xs leading-5 text-[#6d7a70]">支持同时上传 PPT、PDF、DOCX、XLSX、CSV、TXT、MD 等，作为转写稿核对依据。</span><input type="file" multiple onChange={handleReferencesChange} className="mt-3 block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-[#e8efe8] file:px-3 file:py-2 file:text-xs file:font-medium file:text-[#294a35]" />{!!referenceFiles.length && <ul className="mt-3 space-y-1 text-xs text-[#52705a]">{referenceFiles.map(file => <li key={`${file.name}-${file.size}`} className="break-all">• {file.name} · {formatSize(file.size)}</li>)}</ul>}</label></section>
            <section className="space-y-3"><h2 className="font-serif text-lg font-semibold text-[#173d2a]">3. 会议背景</h2><label className="block"><span className="mb-1.5 block text-sm font-medium text-[#405446]">会议标题</span><input value={meetingTitle} onChange={event => setMeetingTitle(event.target.value)} placeholder="例如：某创新药公司业绩交流会" className="w-full rounded-lg border border-[#d8dfd6] px-3 py-2.5 text-sm outline-none transition focus:border-[#497457] focus:ring-2 focus:ring-[#dceade]" /></label><label className="block"><span className="mb-1.5 block text-sm font-medium text-[#405446]">会议日期</span><input value={meetingDate} onChange={event => setMeetingDate(event.target.value)} placeholder="例如：2026-07-29" className="w-full rounded-lg border border-[#d8dfd6] px-3 py-2.5 text-sm outline-none transition focus:border-[#497457] focus:ring-2 focus:ring-[#dceade]" /></label><label className="block"><span className="mb-1.5 block text-sm font-medium text-[#405446]">会议背景</span><textarea value={meetingBackground} onChange={event => setMeetingBackground(event.target.value)} rows={3} placeholder="公司、参会管理层、会议目的等。" className="w-full resize-none rounded-lg border border-[#d8dfd6] px-3 py-2.5 text-sm outline-none transition focus:border-[#497457] focus:ring-2 focus:ring-[#dceade]" /></label><label className="block"><span className="mb-1.5 block text-sm font-medium text-[#405446]">特别关注点</span><textarea value={focusPoints} onChange={event => setFocusPoints(event.target.value)} rows={3} placeholder="例如：管线进度、临床数据、商业化、BD、财务、风险。" className="w-full resize-none rounded-lg border border-[#d8dfd6] px-3 py-2.5 text-sm outline-none transition focus:border-[#497457] focus:ring-2 focus:ring-[#dceade]" /></label></section>
            <div className="rounded-lg bg-[#f3f7f1] px-3 py-3 text-xs leading-5 text-[#55715c]">先得到可编辑的完整转写稿，再按你的会议纪要规范输出摘要、主题纪要、Q&A、全量逐字稿纪要与待确认事项。</div>
            {error && <div className="rounded-lg border border-[#f2c6c0] bg-[#fff5f3] px-3 py-2.5 text-sm text-[#9d3024]">{error}</div>}{notice && <div className="rounded-lg border border-[#b9d8c0] bg-[#f0faf2] px-3 py-2.5 text-sm text-[#2f6a3f]">{notice}</div>}
            <button type="submit" disabled={isProcessing} className="w-full rounded-lg bg-[#173d2a] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#24543a] disabled:cursor-not-allowed disabled:bg-[#92a893]">{isProcessing ? '正在处理，请勿关闭页面…' : hasTranscript ? '根据转写稿生成会议纪要' : '上传并将音视频转文字'}</button>
          </form>

          <section className="flex min-h-[720px] flex-col overflow-hidden rounded-2xl border border-[#dde4dc] bg-white shadow-[0_12px_32px_rgba(28,55,38,0.06)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e4e9e2] px-5 py-4"><div><h2 className="font-serif text-xl font-semibold text-[#173d2a]">{minutes ? '会议纪要' : '音视频转写稿'}</h2><p className="mt-1 text-xs text-[#778278]">{minutes ? '全量内容 · 可复制 · Markdown 下载' : '先核对和修订，再生成正式纪要'}</p></div>{minutes && <div className="flex gap-2"><button type="button" onClick={async () => { await navigator.clipboard.writeText(minutes); setNotice('会议纪要已复制。') }} className="rounded-lg border border-[#d3ddd2] px-3 py-2 text-sm text-[#405446] hover:bg-[#f5f8f4]">复制</button><button type="button" onClick={downloadMarkdown} className="rounded-lg bg-[#eaf2e9] px-3 py-2 text-sm font-medium text-[#315d3d] hover:bg-[#dfece0]">下载 .md</button></div>}</div>
            <div className="flex-1 overflow-auto px-6 py-6 sm:px-8">{minutes ? <><article className="prose prose-slate max-w-none prose-headings:font-serif prose-headings:text-[#173d2a] prose-h1:text-2xl prose-h2:mt-9 prose-h2:border-b prose-h2:border-[#dfe6dc] prose-h2:pb-2 prose-p:leading-7 prose-strong:text-[#244d31]"><ReactMarkdown remarkPlugins={[remarkGfm]}>{minutes}</ReactMarkdown></article><details className="mt-10 border-t border-[#e4e9e2] pt-5"><summary className="cursor-pointer text-sm font-medium text-[#315d3d]">查看/编辑用于生成的转写稿</summary><textarea value={transcript} onChange={event => setTranscript(event.target.value)} rows={16} className="mt-4 w-full rounded-lg border border-[#d8dfd6] p-3 text-sm leading-6 outline-none focus:border-[#497457]" /></details></> : hasTranscript ? <div><div className="mb-4 rounded-lg border border-[#b9d8c0] bg-[#f0faf2] px-4 py-3 text-sm text-[#2f6a3f]">转写已完成。请校对错别字、发言人、专有名词与数字；确认后点击左侧“根据转写稿生成会议纪要”。</div><textarea value={transcript} onChange={event => setTranscript(event.target.value)} rows={30} className="w-full resize-y rounded-xl border border-[#d8dfd6] p-4 font-mono text-sm leading-6 outline-none focus:border-[#497457] focus:ring-2 focus:ring-[#dceade]" /></div> : <div className="flex min-h-[600px] flex-col items-center justify-center text-center"><div className="rounded-full bg-[#edf5ed] px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#4d7555]">Step 2</div><h3 className="mt-5 font-serif text-xl font-semibold text-[#31523a]">先生成可核对的转写稿</h3><p className="mt-2 max-w-sm text-sm leading-6 text-[#738075]">上传音视频后，系统先执行语音转文字。你可以在这里修订转写稿，再生成正式会议纪要。</p></div>}</div>
          </section>
        </div>
      </div>
    </main>
  )
}

export default MeetingMinutesApp
