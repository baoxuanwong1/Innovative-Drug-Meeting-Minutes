import OSS from 'ali-oss'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const requiredEnv = (key: string) => {
  const value = process.env[key]
  if (!value) throw new Error(`Missing environment variable: ${key}`)
  return value
}

const getOssClient = () => new OSS({
  region: requiredEnv('ALI_OSS_REGION'),
  accessKeyId: requiredEnv('ALI_OSS_ACCESS_KEY_ID'),
  accessKeySecret: requiredEnv('ALI_OSS_ACCESS_KEY_SECRET'),
  bucket: requiredEnv('ALI_OSS_BUCKET'),
  secure: true,
})

export async function POST(request: Request) {
  try {
    const { object_name: objectName } = await request.json()
    if (typeof objectName !== 'string' || !objectName.startsWith('meeting-media/'))
      return NextResponse.json({ error: '无效的上传文件。' }, { status: 400 })
    const result = await getOssClient().head(objectName)
    return NextResponse.json({ uploaded: true, size: Number(result.res?.headers?.['content-length'] || 0) })
  }
  catch {
    return NextResponse.json({ uploaded: false }, { status: 404 })
  }
}
