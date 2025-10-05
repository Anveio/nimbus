/// <reference types="vite/client" />

declare global {
  interface ImportMetaEnv {
    readonly VITE_E2E?: string
  }
}

export {}
