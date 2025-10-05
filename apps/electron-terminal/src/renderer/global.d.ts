export {}

declare global {
  interface Window {
    mana?: {
      readonly version: string
    }
  }
}
