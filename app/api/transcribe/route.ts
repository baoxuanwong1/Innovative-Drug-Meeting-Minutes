import { NextResponse } from 'next/server'
import { transcribeMedia } from '../transcription'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const audioUrl = String(body.audio_url || '')
    if (!audioUrl)
      return NextResponse.json({ error: '请先上传会议录音或视频文件。' }, { status: 400 })
    return NextResponse.json(await transcribeMedia(audioUrl))
  }
  catch (error: any) {
    return NextResponse.json({ error: error.message || '音视频转文字失败。' }, { status: 500 })
  }
}
