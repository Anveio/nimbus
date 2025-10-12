import { type Stack, Tags } from 'aws-cdk-lib'

export const OWNER_ENV_KEYS = [
  'NIMBUS_RESOURCE_OWNER',
  'NIMBUS_EV_SSH_OWNER',
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
  Tags.of(stack).add('nimbus:owner', owner)
  Tags.of(stack).add('nimbus:purpose', options.purpose)
  Tags.of(stack).add('nimbus:repository', 'nimbus/react-demo')

  if (options.additionalTags) {
    for (const [key, value] of Object.entries(options.additionalTags)) {
      Tags.of(stack).add(key, value)
    }
  }
}
