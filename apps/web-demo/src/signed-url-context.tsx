import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

interface SignedUrlContextValue {
  readonly signedUrl: string
  setSignedUrl(url: string): void
  clearSignedUrl(): void
}

const SignedUrlContext = createContext<SignedUrlContextValue | null>(null)

export function SignedUrlProvider({
  children,
}: {
  readonly children: ReactNode
}) {
  const [signedUrl, setSignedUrl] = useState('')

  const value = useMemo<SignedUrlContextValue>(() => {
    const set = (url: string) => {
      setSignedUrl(url)
    }
    const clear = () => {
      setSignedUrl('')
    }
    return {
      signedUrl,
      setSignedUrl: set,
      clearSignedUrl: clear,
    }
  }, [signedUrl])

  return (
    <SignedUrlContext.Provider value={value}>
      {children}
    </SignedUrlContext.Provider>
  )
}

export function useSignedUrl(): SignedUrlContextValue {
  const ctx = useContext(SignedUrlContext)
  if (!ctx) {
    throw new Error('useSignedUrl must be used within a SignedUrlProvider')
  }
  return ctx
}
