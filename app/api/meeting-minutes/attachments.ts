import JSZip from 'jszip'

export type ReferenceFile = {
  name: string
  url: string
  type?: string
}

const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_TEXT_LENGTH = 48_000

const cleanText = (value: string) => value
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const clip = (value: string) => value.length > MAX_TEXT_LENGTH
  ? `${value.slice(0, MAX_TEXT_LENGTH)}\n【附件文字过长，以下内容已截断】`
  : value

const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() || ''

const extractZipXml = async (buffer: ArrayBuffer, paths: RegExp[]) => {
  const zip = await JSZip.loadAsync(buffer)
  const matches = Object.keys(zip.files)
    .filter(path => paths.some(pattern => pattern.test(path)))
    .sort()

  const parts = await Promise.all(matches.map(async (path) => {
    const xml = await zip.file(path)?.async('string')
    return cleanText(xml || '')
  }))

  return parts.filter(Boolean).join('\n\n')
}

const extractPdf = async (buffer: ArrayBuffer) => {
  // pdf-parse is CommonJS; require also avoids forcing a declaration file into the client build.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const parse = require('pdf-parse') as (input: Buffer) => Promise<{ text?: string }>
  const result = await parse(Buffer.from(buffer))
  return String(result.text || '')
}

const extractText = async (file: ReferenceFile) => {
  const extension = extensionOf(file.name)
  const response = await fetch(file.url)

  if (!response.ok)
    throw new Error(`无法读取附件「${file.name}」。`)

  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > MAX_FILE_BYTES)
    return `【附件「${file.name}」超过 20 MB，未提取正文；请以录音和其他附件为准。】`

  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > MAX_FILE_BYTES)
    return `【附件「${file.name}」超过 20 MB，未提取正文；请以录音和其他附件为准。】`

  if (['txt', 'md', 'csv', 'json', 'rtf'].includes(extension))
    return new TextDecoder('utf-8').decode(buffer)

  if (extension === 'pdf')
    return extractPdf(buffer)

  if (extension === 'docx')
    return extractZipXml(buffer, [/^word\/document\.xml$/])

  if (extension === 'pptx')
    return extractZipXml(buffer, [/^ppt\/slides\/slide\d+\.xml$/])

  if (extension === 'xlsx')
    return extractZipXml(buffer, [/^xl\/sharedStrings\.xml$/, /^xl\/worksheets\/sheet\d+\.xml$/])

  if (['doc', 'ppt', 'xls'].includes(extension))
    return `【附件「${file.name}」为旧版 Office 格式，已作为会议背景保留但无法稳定提取正文。建议另存为 DOCX、PPTX 或 XLSX 后上传。】`

  return `【附件「${file.name}」已上传，但当前仅支持提取 PDF、DOCX、PPTX、XLSX、CSV、TXT、MD、JSON、RTF 的正文。】`
}

export const buildReferenceContext = async (files: ReferenceFile[]) => {
  if (!files.length)
    return ''

  const extracts = await Promise.all(files.map(async (file) => {
    try {
      const text = cleanText(await extractText(file))
      return `【参考附件：${file.name}】\n${clip(text || '未识别到可用文字。')}`
    }
    catch (error: any) {
      return `【参考附件：${file.name}】\n读取失败：${error.message || '未知错误'}`
    }
  }))

  return extracts.join('\n\n')
}
