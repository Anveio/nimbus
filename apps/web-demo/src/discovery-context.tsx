import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query'

import { fetchDiscoveryMetadata, type DiscoveryResult } from './aws/discovery'

interface DiscoveryContextValue {
  readonly region: string | null
  setRegion(region: string | null): void
  readonly query: UseQueryResult<DiscoveryResult>
  readonly isConfigured: boolean
}

const DiscoveryContext = createContext<DiscoveryContextValue | null>(null)

function hasDiscoveryEndpoint(): boolean {
  const endpoint = import.meta.env.VITE_MANA_DISCOVERY_ENDPOINT
  return typeof endpoint === 'string' && endpoint.trim().length > 0
}

export function DiscoveryProvider({
  children,
}: {
  readonly children: ReactNode
}) {
  const defaultRegion =
    import.meta.env.VITE_MANA_SIGNER_DEFAULT_REGION?.trim() || null
  const [region, setRegion] = useState<string | null>(defaultRegion)
  const isConfigured = hasDiscoveryEndpoint()

  const query = useQuery({
    queryKey: ['discovery', region],
    queryFn: () => fetchDiscoveryMetadata(region ?? undefined),
    enabled: isConfigured,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  })

  const value = useMemo<DiscoveryContextValue>(
    () => ({
      region,
      setRegion,
      query,
      isConfigured,
    }),
    [region, query, isConfigured],
  )

  return (
    <DiscoveryContext.Provider value={value}>
      {children}
    </DiscoveryContext.Provider>
  )
}

export function useDiscovery(): DiscoveryContextValue {
  const ctx = useContext(DiscoveryContext)
  if (!ctx) {
    throw new Error('useDiscovery must be used within a DiscoveryProvider')
  }
  return ctx
}

export function DiscoveryQueryProvider({
  children,
}: {
  readonly children: ReactNode
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
          },
        },
      }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
