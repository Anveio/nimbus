import { type Stack, Tags } from 'aws-cdk-lib'

export const OWNER_ENV_KEYS = [
  'MANA_RESOURCE_OWNER',
  'MANA_DEV_SSH_OWNER',
  'USER',
  'USERNAME',
]

export interface NimbusTagOptions {
  readonly purpose: string
  readonly additionalTags?: Record<string, string>
}

export function ownerFromEnvironment(): string {
  for (const key of OWNER_ENV_KEYS) {
    const value = process.env[key]
    if (value && value.trim().length > 0) {
      return value.trim()
    }
  }
  return 'unknown'
}

export function determineOwner(stack: Stack): string {
  const contextOwner = (
    stack.node.tryGetContext('owner') as string | undefined
  )?.trim()
  if (contextOwner && contextOwner.length > 0) {
    return contextOwner
  }

  return ownerFromEnvironment()
}

export function applyNimbusTags(stack: Stack, options: NimbusTagOptions) {
  const owner = determineOwner(stack)
  Tags.of(stack).add('mana:owner', owner)
  Tags.of(stack).add('mana:purpose', options.purpose)
  Tags.of(stack).add('mana:repository', 'mana-ssh-web')

  if (options.additionalTags) {
    for (const [key, value] of Object.entries(options.additionalTags)) {
      Tags.of(stack).add(key, value)
    }
  }
}
