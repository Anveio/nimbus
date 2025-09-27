import type {
  C1HandlingMode,
  Mutable,
  ParserOptions,
  ParserSpec,
  ParserStringLimits,
} from '../types'

interface SpecDefaults {
  readonly c1Handling: C1HandlingMode
  readonly acceptEightBitControls: boolean
  readonly stringLimits: ParserStringLimits
}

const baseLimits = (
  overrides: Partial<ParserStringLimits> = {},
): ParserStringLimits => ({
  osc: 4096,
  dcs: 4096,
  sosPmApc: 4096,
  ...overrides,
})

export const SPEC_FALLBACK: ParserSpec = 'vt220'

export const SPEC_DEFAULTS: Record<ParserSpec, SpecDefaults> = {
  vt100: {
    c1Handling: 'escaped',
    acceptEightBitControls: false,
    stringLimits: baseLimits({ osc: 2048, dcs: 2048, sosPmApc: 2048 }),
  },
  vt220: {
    c1Handling: 'spec',
    acceptEightBitControls: true,
    stringLimits: baseLimits(),
  },
  vt320: {
    c1Handling: 'spec',
    acceptEightBitControls: true,
    stringLimits: baseLimits({ dcs: 8192 }),
  },
  vt420: {
    c1Handling: 'spec',
    acceptEightBitControls: true,
    stringLimits: baseLimits({ osc: 8192, dcs: 8192 }),
  },
  vt520: {
    c1Handling: 'spec',
    acceptEightBitControls: true,
    stringLimits: baseLimits({ osc: 12288, dcs: 12288, sosPmApc: 4096 }),
  },
  vt525: {
    c1Handling: 'spec',
    acceptEightBitControls: true,
    stringLimits: baseLimits({ osc: 12288, dcs: 12288, sosPmApc: 4096 }),
  },
  xterm: {
    c1Handling: 'spec',
    acceptEightBitControls: true,
    stringLimits: baseLimits({ osc: 16384, dcs: 16384, sosPmApc: 8192 }),
  },
}

export const resolveSpecOptions = (options: ParserOptions): ParserOptions => {
  if (!options.spec) {
    return options
  }

  const { spec, ...rest } = options
  const defaults = SPEC_DEFAULTS[spec] ?? SPEC_DEFAULTS[SPEC_FALLBACK]

  const merged: Mutable<ParserOptions> = {
    ...defaults,
    ...rest,
  }

  const overrideLimits = rest.stringLimits
  merged.stringLimits = {
    ...defaults.stringLimits,
    ...(overrideLimits ?? {}),
  }

  return merged
}
