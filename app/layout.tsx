import type { Metadata } from 'next'

import './styles/globals.css'

export const metadata: Metadata = {
  title: '创新药会议纪要助手',
  description: '将会议录音、视频与参考资料整理为全量、可核对的医药行业会议纪要。',
  openGraph: {
    title: '创新药会议纪要助手',
    description: '录音、视频、PPT、PDF → 全量可核对纪要',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/og.png'],
  },
}

const LocaleLayout = ({
  children,
}: {
  children: React.ReactNode
}) => {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="h-full">
        <div className="min-h-screen overflow-x-auto">
          <div className="min-h-screen min-w-[300px]">
            {children}
          </div>
        </div>
      </body>
    </html>
  )
}

export default LocaleLayout
