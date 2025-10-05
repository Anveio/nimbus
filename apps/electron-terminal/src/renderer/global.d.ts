export {}

declare global {
  interface Window {
    mana?: {
      readonly version: string
      readonly session: {
        open(
          options?: import('../shared/session-types').SessionOpenOptions,
        ): Promise<void>
        close(): Promise<void>
        send(data: Uint8Array): void
        resize(
          dimensions: import('../shared/session-types').SessionResize,
        ): void
        onData(listener: (data: Uint8Array) => void): () => void
        onStatus(
          listener: (
            status: import('../shared/session-types').SessionStatus,
          ) => void,
        ): () => void
        onDiagnostic(
          listener: (
            diagnostic: import('../shared/session-types').SessionDiagnostic,
          ) => void,
        ): () => void
        getDefaultOptions(): import('../shared/session-types').SessionOpenOptions
      }
    }
  }
}
