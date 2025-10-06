import type {
  RendererFrameOverlays,
  RendererTheme,
  TerminalProfile,
} from '../types'

const mergeOverlays = (
  previous: RendererFrameOverlays | undefined,
  next: Partial<RendererFrameOverlays> | undefined,
): RendererFrameOverlays | undefined => {
  if (!next) {
    return previous
  }
  return {
    selection: next.selection ?? previous?.selection ?? null,
    cursor: next.cursor ?? previous?.cursor ?? null,
    highlights: next.highlights ?? previous?.highlights,
    layers: next.layers ?? previous?.layers,
  }
}

const mergeTheme = (
  base: RendererTheme | undefined,
  patch: RendererTheme | undefined,
): RendererTheme | undefined => {
  if (!patch) {
    return base
  }
  if (!base) {
    return patch
  }
  return {
    background: patch.background ?? base.background,
    foreground: patch.foreground ?? base.foreground,
    cursor: {
      color: patch.cursor?.color ?? base.cursor?.color ?? '#ffffff',
      opacity: patch.cursor?.opacity ?? base.cursor?.opacity,
      shape: patch.cursor?.shape ?? base.cursor?.shape,
    },
    selection: patch.selection ?? base.selection,
    palette: {
      ansi: patch.palette?.ansi ?? base.palette?.ansi ?? [],
      extended: patch.palette?.extended ?? base.palette?.extended,
    },
  }
}

export const mergeTerminalProfile = (
  base: TerminalProfile,
  patch: TerminalProfile,
): TerminalProfile => {
  const theme = mergeTheme(base.theme, patch.theme)
  const accessibility =
    patch.accessibility || base.accessibility
      ? {
          highContrast:
            patch.accessibility?.highContrast ??
            base.accessibility?.highContrast ??
            false,
          reducedMotion:
            patch.accessibility?.reducedMotion ??
            base.accessibility?.reducedMotion,
          colorScheme:
            patch.accessibility?.colorScheme ?? base.accessibility?.colorScheme,
        }
      : undefined

  const overlays = mergeOverlays(base.overlays, patch.overlays)

  return {
    theme,
    accessibility,
    overlays,
  }
}
