import { randomBytes } from 'node:crypto'
import {
  CloudFormationClient,
  DescribeStacksCommand,
  type Stack,
} from '@aws-sdk/client-cloudformation'
import { DescribeInstancesCommand, EC2Client } from '@aws-sdk/client-ec2'
import {
  EC2InstanceConnectClient,
  SendSSHPublicKeyCommand,
} from '@aws-sdk/client-ec2-instance-connect'
import nacl from 'tweetnacl'

const DEFAULT_STACK_NAME = 'nimbus-dev-ssh-instance'
const DEFAULT_OS_USER = 'ec2-user'
const INSTANCE_CONNECT_TTL_MS = 60_000

export interface InstanceTarget {
  readonly stackName: string
  readonly region: string
  readonly instanceId: string
  readonly availabilityZone: string
  readonly publicDnsName: string | undefined
  readonly stackTags: Record<string, string>
}

export interface PublishOptions {
  readonly stackName?: string
  readonly region?: string
  readonly instanceId?: string
  readonly osUser?: string
  readonly comment?: string
}

export interface PublishResult extends InstanceTarget {
  readonly sshPublicKey: string
  readonly privateKey: string
  readonly expiresAt: string
  readonly user: string
}

function uint32BE(value: number) {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value, 0)
  return buffer
}

function encodeString(input: Buffer | string) {
  const buffer = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return Buffer.concat([uint32BE(buffer.length), buffer])
}

function wrapOpenSshPrivateKey(body: Buffer) {
  const base64 = body.toString('base64')
  const wrapped = base64.match(/.{1,70}/g)?.join('\n') ?? base64
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${wrapped}\n-----END OPENSSH PRIVATE KEY-----\n`
}

function buildOpenSshKeyPair(comment: string) {
  const keyPair = nacl.sign.keyPair()
  const publicKey = Buffer.from(keyPair.publicKey)
  const privateKey = Buffer.from(keyPair.secretKey)

  const keyType = 'ssh-ed25519'
  const publicKeyBlob = Buffer.concat([
    encodeString(keyType),
    encodeString(publicKey),
  ])
  const authorizedKey =
    `${keyType} ${publicKeyBlob.toString('base64')}` +
    (comment.length > 0 ? ` ${comment}` : '')

  const checkInt1 = randomBytes(4).readUInt32BE(0)
  const checkInt2 = randomBytes(4).readUInt32BE(0)

  let privateKeyInner = Buffer.concat([
    uint32BE(checkInt1),
    uint32BE(checkInt2),
    encodeString(keyType),
    encodeString(publicKey),
    encodeString(privateKey),
    encodeString(comment),
  ])

  const blockSize = 8
  const remainder = privateKeyInner.length % blockSize
  if (remainder !== 0) {
    const paddingLength = blockSize - remainder
    const padding = Buffer.alloc(paddingLength)
    for (let i = 0; i < paddingLength; i += 1) {
      padding[i] = i + 1
    }
    privateKeyInner = Buffer.concat([privateKeyInner, padding])
  }

  const privateKeyBlob = Buffer.concat([
    Buffer.from('openssh-key-v1\0'),
    encodeString('none'),
    encodeString('none'),
    encodeString(Buffer.alloc(0)),
    uint32BE(1),
    encodeString(publicKeyBlob),
    encodeString(privateKeyInner),
  ])

  return {
    authorizedKey,
    privateKey: wrapOpenSshPrivateKey(privateKeyBlob),
  }
}

export function resolveRegion(option?: string) {
  return (
    option ??
    process.env.AWS_REGION ??
    process.env.AWS_DEFAULT_REGION ??
    process.env.CDK_DEFAULT_REGION ??
    null
  )
}

export async function resolveInstanceTarget(params: {
  readonly region: string
  readonly stackName: string
  readonly instanceIdHint?: string
}): Promise<InstanceTarget> {
  const cloudFormation = new CloudFormationClient({ region: params.region })

  let stack: Stack | undefined
  if (params.instanceIdHint) {
    stack = (
      await cloudFormation.send(
        new DescribeStacksCommand({ StackName: params.stackName }),
      )
    ).Stacks?.[0]
  } else {
    const describeStacks = await cloudFormation.send(
      new DescribeStacksCommand({ StackName: params.stackName }),
    )
    stack = describeStacks.Stacks?.[0]
  }

  if (!stack) {
    throw new Error(
      `Stack ${params.stackName} not found. Deploy the stack before requesting an Instance Connect key.`,
    )
  }

  const stackTags: Record<string, string> = {}
  if (stack.Tags) {
    for (const tag of stack.Tags) {
      if (tag.Key) {
        stackTags[tag.Key] = tag.Value ?? ''
      }
    }
  }

  const instanceId =
    params.instanceIdHint ??
    stack.Outputs?.find((output) => output.OutputKey === 'InstanceId')
      ?.OutputValue

  if (!instanceId) {
    throw new Error(
      `Stack ${params.stackName} does not expose an InstanceId output.`,
    )
  }

  const ec2 = new EC2Client({ region: params.region })
  const describeInstances = await ec2.send(
    new DescribeInstancesCommand({ InstanceIds: [instanceId] }),
  )

  const reservation = describeInstances.Reservations?.[0]
  const instance = reservation?.Instances?.[0]
  if (!instance) {
    throw new Error(
      `Instance ${instanceId} not found or not in a running state.`,
    )
  }

  if (instance.State?.Name !== 'running') {
    throw new Error(
      `Instance ${instanceId} is not running (current state: ${instance.State?.Name}).`,
    )
  }

  const availabilityZone = instance.Placement?.AvailabilityZone
  if (!availabilityZone) {
    throw new Error(
      `Unable to determine availability zone for instance ${instanceId}.`,
    )
  }

  const publicDnsName = instance.PublicDnsName?.length
    ? instance.PublicDnsName
    : undefined

  return {
    stackName: params.stackName,
    region: params.region,
    instanceId,
    availabilityZone,
    publicDnsName,
    stackTags,
  }
}

export async function publishEphemeralKey(
  options: PublishOptions = {},
): Promise<PublishResult> {
  const region = resolveRegion(options.region)
  if (!region) {
    throw new Error(
      'Unable to determine AWS region. Set AWS_REGION or pass region explicitly.',
    )
  }

  const stackName =
    options.stackName ??
    process.env.MANA_DEV_SSH_STACK_NAME ??
    DEFAULT_STACK_NAME
  const osUser = options.osUser ?? DEFAULT_OS_USER
  const comment = options.comment ?? ''

  const target = await resolveInstanceTarget({
    region,
    stackName,
    instanceIdHint: options.instanceId,
  })

  const keyPair = buildOpenSshKeyPair(comment)

  const instanceConnect = new EC2InstanceConnectClient({ region })
  await instanceConnect.send(
    new SendSSHPublicKeyCommand({
      InstanceId: target.instanceId,
      AvailabilityZone: target.availabilityZone,
      InstanceOSUser: osUser,
      SSHPublicKey: keyPair.authorizedKey,
    }),
  )

  const expiresAt = new Date(Date.now() + INSTANCE_CONNECT_TTL_MS).toISOString()

  return {
    ...target,
    sshPublicKey: keyPair.authorizedKey,
    privateKey: keyPair.privateKey,
    expiresAt,
    user: osUser,
  }
}
