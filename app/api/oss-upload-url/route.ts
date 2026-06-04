import OSS from 'ali-oss'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const requiredEnv = (key: string) => {
  const value = process.env[key]
  if (!value)
    throw new Error(`Missing environment variable: ${key}`)
  return value
}

const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_')

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

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const filename = String(body.filename || 'meeting-media')
    const contentType = String(body.content_type || 'application/octet-stream')
    const expires = Number(process.env.ALI_OSS_SIGNED_URL_EXPIRES || 3600)
    const objectName = `meeting-media/${Date.now()}-${safeName(filename)}`
    const ossClient = getOssClient()

    const uploadUrl = ossClient.signatureUrl(objectName, {
      expires,
      method: 'PUT',
      'Content-Type': contentType,
    })
    const audioUrl = ossClient.signatureUrl(objectName, {
      expires,
      method: 'GET',
    })

    return NextResponse.json({
      upload_url: uploadUrl,
      audio_url: audioUrl,
      content_type: contentType,
      object_name: objectName,
    })
  }
  catch (error: any) {
    return buildError(error.message || 'Failed to create OSS upload URL.')
  }
}
