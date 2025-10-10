import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { SignedUrlProvider } from './signed-url-context'
import {
  DiscoveryProvider,
  DiscoveryQueryProvider,
} from './discovery-context'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DiscoveryQueryProvider>
      <SignedUrlProvider>
        <DiscoveryProvider>
          <App />
        </DiscoveryProvider>
      </SignedUrlProvider>
    </DiscoveryQueryProvider>
  </StrictMode>,
)
