import { createRoot } from 'react-dom/client'
import { ElectronTerminalApp } from './app'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Failed to locate root container')
}

createRoot(rootElement).render(<ElectronTerminalApp />)
