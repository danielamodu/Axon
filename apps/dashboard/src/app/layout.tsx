import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Axon — Protocol Operations Dashboard',
  description: 'Autonomous governance and execution infrastructure for decentralized protocols',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
