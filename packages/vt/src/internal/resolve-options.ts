import type { Mutable, ParserOptionOverrides, ParserOptions } from '../types'
import { resolveEmulatorOverlay } from './emulator-quirks'
import { resolveSpecOptions, SPEC_FALLBACK } from './spec-defaults'

const pickOverrides = (options: ParserOptions): ParserOptionOverrides => {
  const overrides: Mutable<Partial<ParserOptionOverrides>> = {}

  if (options.c1Handling !== undefined) {
    overrides.c1Handling = options.c1Handling
  }
  if (options.acceptEightBitControls !== undefined) {
    overrides.acceptEightBitControls = options.acceptEightBitControls
  }
  if (options.maxStringLength !== undefined) {
    overrides.maxStringLength = options.maxStringLength
  }
  if (options.stringLimits !== undefined) {
    overrides.stringLimits = { ...options.stringLimits }
  }

  return overrides
}

const mergeOverrides = (
  base: ParserOptionOverrides,
  overlay: ParserOptionOverrides,
): ParserOptionOverrides => {
  const merged: Mutable<Partial<ParserOptionOverrides>> = { ...base }

  if (overlay.c1Handling !== undefined) {
    merged.c1Handling = overlay.c1Handling
  }
  if (overlay.acceptEightBitControls !== undefined) {
    merged.acceptEightBitControls = overlay.acceptEightBitControls
  }
  if (overlay.maxStringLength !== undefined) {
    merged.maxStringLength = overlay.maxStringLength
  }
  if (overlay.stringLimits !== undefined) {
    merged.stringLimits = {
      ...(merged.stringLimits ?? {}),
      ...overlay.stringLimits,
    }
  }

  return merged
}

export const resolveParserOptions = (options: ParserOptions): ParserOptions => {
  const emulatorOverlay = resolveEmulatorOverlay(options)

  const spec = options.spec ?? emulatorOverlay.spec ?? SPEC_FALLBACK

  const combinedOverrides = mergeOverrides(
    emulatorOverlay.overrides,
    pickOverrides(options),
  )

  const resolved = resolveSpecOptions({
    spec,
    ...combinedOverrides,
  })

  return resolved
}
