import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { SignedUrlProvider } from './signed-url-context'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SignedUrlProvider>
      <App />
    </SignedUrlProvider>
  </StrictMode>,
)
