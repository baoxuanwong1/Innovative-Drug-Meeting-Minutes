# 医药会议纪要生成器

This fork turns the original Dify conversation web app template into a direct meeting-minutes web app.

The app lets users upload an `mp3`, `m4a`, `wav`, `mp4`, or `mov` file, stores it in Aliyun OSS, sends a temporary OSS URL to Bailian / DashScope Paraformer ASR, and then calls Qwen to generate Markdown meeting minutes.

It does not require a Dify Workflow.

## Workflow Shape

```text
Browser upload
-> Next.js API route creates an OSS signed upload URL
-> Browser uploads the file directly to Aliyun OSS
-> Next.js API route receives the OSS signed download URL
-> DashScope Paraformer ASR
-> Download transcription JSON
-> Extract transcript
-> DashScope Qwen meeting-minutes generation
-> Browser Markdown preview
```

## Environment Variables

Create `.env.local` from `.env.example`.

```bash
cp .env.example .env.local
```

Fill in:

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

Keep all keys server-side. Do not use `NEXT_PUBLIC_*` for Aliyun credentials or DashScope keys.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deployment Notes

- The server running this app must be able to reach Aliyun OSS and DashScope.
- `ALI_OSS_REGION` must match the real region of `ALI_OSS_BUCKET`.
- The OSS bucket needs CORS enabled for browser uploads. Allow your local/Vercel origin, method `PUT`, and header `Content-Type`.
- The OSS signed URL expiry should be long enough for ASR processing. Start with `3600`.
- Long recordings may exceed Vercel request time limits. Start with short recordings, then adjust `DASHSCOPE_ASR_MAX_ATTEMPTS` and deployment timeout as needed.
