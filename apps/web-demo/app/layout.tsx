import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Nimbus Web Demo',
  description:
    'Discover EC2 hosts and launch the Nimbus terminal experience in your browser.',
}

export default function RootLayout(props: {
  readonly children: React.ReactNode
}): React.JSX.Element {
  const { children } = props
  return (
    <html lang="en">
      <body>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <header
            style={{
              padding: '1.25rem 2rem',
              borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
              background:
                'linear-gradient(135deg, rgba(30, 41, 59, 0.85) 0%, rgba(15, 23, 42, 0.65) 100%)',
            }}
          >
            <h1
              style={{
                margin: 0,
                fontSize: '1.5rem',
                fontWeight: 600,
              }}
            >
              Nimbus Terminal Demo
            </h1>
            <p
              style={{
                margin: '0.35rem 0 0',
                fontSize: '0.95rem',
                color: 'rgba(226, 232, 240, 0.75)',
              }}
            >
              Discover EC2 hosts and open an interactive terminal session powered
              by Nimbus.
            </p>
          </header>
          <main style={{ flex: 1 }}>{children}</main>
        </div>
      </body>
    </html>
  )
}
