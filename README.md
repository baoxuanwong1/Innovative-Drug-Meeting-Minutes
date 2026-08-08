# 创新药会议纪要助手

独立的 Next.js 会议纪要应用，不依赖任何工作流平台或外部对话应用。

它将会议录音/视频上传至阿里云 OSS，使用阿里云百炼 Paraformer 转写，并使用 Qwen 按医药投研会议纪要规范生成 Markdown。可额外上传 PPT、PDF、DOCX、XLSX、CSV、TXT、MD 等附件，系统会提取其中可读文字，用于核对产品名称、数据和会议背景。

在线体验：[创新药会议纪要助手](https://innovativedrug.vercel.app/)

处理流程为：**上传文件 → 音视频转文字 → 自动生成正式会议纪要**。系统会保留完整转写稿，用户可在结果中核对或修订后重新生成；会议纪要生成接口只接收文字稿，确保“转文字”是一个可复核的独立步骤。

## 输出规范

生成结果固定包含：

- 会议基本信息和核心摘要
- 按实际主题梳理的会议内容纪要
- Q&A
- 全量逐字稿纪要（书面化、去口语化，但不人为省略会议信息）
- 待确认事项

系统不会补造事实。转写听不清或资料相互冲突的内容会标记为“待确认”。

## 配置

复制 `.env.example` 为 `.env.local`，再填写：

```text
ALI_OSS_REGION=oss-cn-hangzhou
ALI_OSS_BUCKET=your-bucket
ALI_OSS_ACCESS_KEY_ID=your-access-key-id
ALI_OSS_ACCESS_KEY_SECRET=your-access-key-secret
ALI_OSS_SIGNED_URL_EXPIRES=3600

DASHSCOPE_API_KEY=your-bailian-api-key
DASHSCOPE_ASR_MODEL=paraformer-v2
DASHSCOPE_LLM_MODEL=qwen-plus
DASHSCOPE_ASR_MAX_ATTEMPTS=36
DASHSCOPE_ASR_POLL_INTERVAL_MS=5000
```

所有密钥都只应配置在服务端环境变量中。

## 本地运行

```bash
npm install
npm run dev
```

## 部署提示

- 文件上传使用带时效和对象范围限制的 OSS 表单签名，不需要为站点配置 OSS CORS 规则。
- 上传完成以服务端 OSS 文件校验为准：避免隐藏 iframe 的初始加载被误判为成功，并为最大 2 GB 的文件保留最长 10 分钟的确认窗口。
- 录音、视频和附件使用限时签名地址，仅供转写与本次生成过程读取。
- 超长录音会受到部署环境运行时长限制；可视需要提高 `DASHSCOPE_ASR_MAX_ATTEMPTS`，并在部署平台配置相应的函数超时。
