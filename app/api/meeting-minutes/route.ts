import { NextResponse } from 'next/server'
import { buildReferenceContext, type ReferenceFile } from './attachments'

export const runtime = 'nodejs'
export const maxDuration = 300

const openAiCompatibleUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

const requiredEnv = (key: string) => {
  const value = process.env[key]
  if (!value) throw new Error(`Missing environment variable: ${key}`)
  return value
}

const buildMeetingPrompt = ({
  transcript, meetingTitle, meetingDate, meetingBackground, focusPoints, referenceContext,
}: {
  transcript: string
  meetingTitle: string
  meetingDate: string
  meetingBackground: string
  focusPoints: string
  referenceContext: string
}) => `你是一名严谨的医药行业研究助理。请将已核对的会议转写稿整理为可直接交付的中文 Markdown 会议纪要。

会议信息：
- 标题：${meetingTitle || '待确认'}
- 日期：${meetingDate || '待确认'}
- 背景：${meetingBackground || '无'}
- 重点关注：${focusPoints || '无'}

${referenceContext ? `以下为用户上传的参考附件。它们只用于核对名称、数据和会议背景；若与转写稿冲突，必须标注待确认，不能擅自裁定：\n${referenceContext}\n` : ''}

会议转写稿：
${transcript}

必须遵守：
1. 先完整梳理全部转写稿信息，再产出结果；不得因为主观判断省略任何与会议主题有关的实质信息、数字、时间、产品、临床数据、观点、风险或问题。
2. 只可依据转写稿、会议信息和参考附件，不得补造数据、结论、公司/产品名称或参会人。听不清或无法核实时写 **【待确认：原音 00:00】**；时间不清时写 **【待确认：原音时间待核】**。
3. 删除“这个、那个、然后、我觉得”等口语词；将“我们”改为公司或管理层；改成完整书面语句。药物剂量使用 mg；临床分期用 I、II、III 期；保留英文缩写（如 ORR、PFS、OS、BD、NCCN）。
4. 管理层反复强调的内容保留首次完整表述，后续仅在确有新增信息时补充；不得删除问答信息。
5. 不出现任何券商、同事或参会专家姓名；上市公司管理层姓名可以保留。附件并非公开来源，不要伪造“资料来源”或链接。
6. 不要解释写作过程，也不要输出原始 ASR 文本。

严格以如下结构输出：
# ${meetingTitle || '会议'}纪要

**会议时间：** ${meetingDate || '待确认'}
**会议形式：** 待确认
**参会人员：** 待确认
**会议主题：** ${meetingTitle || '待确认'}

## 一、核心摘要
以 3-8 条完整要点概括最重要结论，必须保留关键数字、口径与前提。

## 二、会议内容纪要
按会议实际逻辑设置加粗小标题（如公司概况、业绩与经营、产品/管线进展、临床数据、商业化、BD、竞争格局、未来规划）。每个主题下完整、清晰地记录管理层陈述；如没有对应内容不要硬凑标题。

## 三、Q&A
每一组使用 **Q：** 和 **A：**。可合并紧邻的同类问题，但答案内的所有信息都要保留；每组 Q&A 之间空一行。若会议没有问答，写“本次会议未形成独立 Q&A 环节”。

## 四、逐字稿纪要
按“管理层阐述”与“Q&A”顺序记录会议所有相关信息。这里是经书面化、去口语化、理顺逻辑的全量记录，而不是压缩摘要。保留发言者角色（如“管理层：”“提问：”），不得人为漏记。

## 五、待确认事项
仅列出转写听不清、资料存在冲突或会议明确尚未确认的事项；没有则写“无”。`

const generateMeetingMinutes = async (prompt: string) => {
  const response = await fetch(openAiCompatibleUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${requiredEnv('DASHSCOPE_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.DASHSCOPE_LLM_MODEL || 'qwen-plus',
      messages: [
        { role: 'system', content: '你是专业、严谨且不编造事实的医药行业会议纪要撰写助手。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
    }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok)
    throw new Error(payload?.error?.message || payload?.message || `生成会议纪要失败：${response.status}`)
  const meetingMinutes = payload?.choices?.[0]?.message?.content
  if (!meetingMinutes) throw new Error('模型未返回会议纪要。')
  return meetingMinutes as string
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const transcript = String(body.transcript || '').trim()
    if (!transcript) return NextResponse.json({ error: '请先完成音视频转文字。' }, { status: 400 })
    const references = Array.isArray(body.references) ? body.references as ReferenceFile[] : []
    const referenceContext = await buildReferenceContext(references)
    const meetingMinutes = await generateMeetingMinutes(buildMeetingPrompt({
      transcript,
      meetingTitle: String(body.meeting_title || ''),
      meetingDate: String(body.meeting_date || ''),
      meetingBackground: String(body.meeting_background || ''),
      focusPoints: String(body.focus_points || ''),
      referenceContext,
    }))
    return NextResponse.json({ meeting_minutes: meetingMinutes })
  }
  catch (error: any) {
    return NextResponse.json({ error: error.message || '生成会议纪要失败。' }, { status: 500 })
  }
}
