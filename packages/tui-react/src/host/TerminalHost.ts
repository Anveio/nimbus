export interface TerminalHost {
  onData(callback: (data: Uint8Array) => void): () => void
  write(data: Uint8Array): void
  resize?(rows: number, columns: number): void
  dispose(): void
}

export type TerminalHostFactory = (
  options: TerminalHostFactoryOptions,
) => TerminalHost

export interface TerminalHostFactoryOptions {
  readonly onError?: (error: unknown) => void
}
