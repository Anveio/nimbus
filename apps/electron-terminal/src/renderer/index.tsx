import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Failed to locate root container')
}

createRoot(rootElement).render(<App />)

function App(): JSX.Element {
  const [version, setVersion] = useState<string>('0.0.0')

  useEffect(() => {
    setVersion(window.mana?.version ?? '0.0.0')
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: '1rem',
      }}
    >
      <h1>Mana Electron Terminal</h1>
      <p>Renderer scaffolding is live. Mana app version: {version}</p>
    </div>
  )
}
