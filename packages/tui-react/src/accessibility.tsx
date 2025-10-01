/** biome-ignore-all lint/performance/noBarrelFile: Module */
export type {
  AccessibilityAdapterOptions,
  ShortcutGuideConfig,
  ShortcutGuideReason,
  TerminalAccessibilityAdapter,
  TerminalShortcut,
  TerminalStatusLevel,
  TerminalStatusMessage,
} from './accessibility-layer'
export {
  TerminalAccessibilityLayer,
  useTerminalAccessibilityAdapter,
  useTerminalAccessibilityAdapter as useTerminalAccessibility,
} from './accessibility-layer'
