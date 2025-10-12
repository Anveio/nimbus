import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Stack, type StackProps } from 'aws-cdk-lib'
import {
  Instance,
  InstanceType,
  MachineImage,
  OperatingSystemType,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  UserData,
  Vpc,
} from 'aws-cdk-lib/aws-ec2'
import {
  HttpApi,
  HttpMethod,
  CorsHttpMethod,
} from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import { Runtime } from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs'
import { CfnOutput } from 'aws-cdk-lib'
import type { Construct } from 'constructs'
import { applyNimbusTags } from './tags'

interface DevSshStackProps extends StackProps {}

export class DevSshStack extends Stack {
  constructor(scope: Construct, id: string, props?: DevSshStackProps) {
    super(scope, id, props)

    applyNimbusTags(this, {
      purpose: 'instance-connect-dev',
    })

    const keyName = this.node.tryGetContext('keyName') as string | undefined

    const allowedIp =
      (this.node.tryGetContext('allowedIp') as string | undefined) ??
      (this.node.tryGetContext('allowedCidr') as string | undefined)

    if (!allowedIp) {
      throw new Error(
        'Context variable "allowedIp" (CIDR, e.g. 203.0.113.4/32) is required. Provide via: cdk deploy --context allowedIp=$(curl -s https://checkip.amazonaws.com)/32',
      )
    }

    const instanceTypeContext =
      (this.node.tryGetContext('instanceType') as string | undefined) ??
      't3.micro'
    const instanceType = new InstanceType(instanceTypeContext)

    const architecture =
      (this.node.tryGetContext('arch') as string | undefined) ?? 'x86_64'

    const vpcId = this.node.tryGetContext('vpcId') as string | undefined
    const vpc =
      vpcId !== undefined
        ? Vpc.fromLookup(this, 'SpecifiedVpc', { vpcId })
        : Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true })

    const securityGroup = new SecurityGroup(this, 'DevSshSecurityGroup', {
      vpc,
      description: 'Nimbus dev SSH security group',
      allowAllOutbound: true,
    })
    securityGroup.addIngressRule(
      Peer.ipv4(allowedIp),
      Port.tcp(22),
      'Allow SSH from developer workstation',
    )

    const amiSsmParameter =
      architecture === 'arm64'
        ? '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64'
        : '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64'

    // Pull the standard AL2023 image via SSM so we ride the latest non ECS-optimized AMI and keep EIC preinstalled.
    const machineImage = MachineImage.fromSsmParameter(amiSsmParameter, {
      os: OperatingSystemType.LINUX,
    })

    const userData = UserData.forLinux()
    userData.addCommands('set -euxo pipefail')
    const bootstrapScript = readFileSync(
      path.join(__dirname, 'user-data.sh'),
      'utf8',
    )
    userData.addCommands(`cat <<'EOF' >/tmp/bootstrap.sh
${bootstrapScript}
EOF
chmod +x /tmp/bootstrap.sh
/tmp/bootstrap.sh`)

    const instance = new Instance(this, 'DevSshInstance', {
      vpc,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      instanceType,
      machineImage,
      securityGroup,
      ...(keyName ? { keyName } : {}),
      userData,
    })

    const defaultSignerEndpoint =
      (this.node.tryGetContext('signerEndpoint') as string | undefined) ??
      'wss://prod.us-west-2.oneclickv2-proxy.ec2.aws.dev/proxy/instance-connect'
    const signerService =
      (this.node.tryGetContext('signerService') as string | undefined) ??
      'ec2-instance-connect'
    const maxExpiresContext = Number.parseInt(
      (this.node.tryGetContext('signerMaxExpires') as string | undefined) ?? '',
      10,
    )
    const defaultExpiresContext = Number.parseInt(
      (this.node.tryGetContext('signerDefaultExpires') as string | undefined) ??
        '',
      10,
    )
    const maxExpires =
      Number.isFinite(maxExpiresContext) && maxExpiresContext > 0
        ? maxExpiresContext
        : 300
    const defaultExpires =
      Number.isFinite(defaultExpiresContext) && defaultExpiresContext > 0
        ? defaultExpiresContext
        : 60

    const signerToken = randomBytes(32).toString('hex')
    const repositoryTagValue = 'mana-ssh-web'

    const signerFunction = new NodejsFunction(this, 'SigV4SignerFunction', {
      runtime: Runtime.NODEJS_LATEST,
      entry: path.join(__dirname, 'signer', 'handler.ts'),
      handler: 'handler',
      bundling: {
        target: 'node20',
        format: OutputFormat.CJS,
        externalModules: [],
      },
      environment: {
        SIGNER_TOKEN: signerToken,
        DEFAULT_ENDPOINT: defaultSignerEndpoint,
        DEFAULT_REGION: Stack.of(this).region,
        DEFAULT_SERVICE: signerService,
        MAX_EXPIRES: String(maxExpires),
        DEFAULT_EXPIRES: String(defaultExpires),
      },
    })

    const discoveryFunction = new NodejsFunction(
      this,
      'InfraDiscoveryFunction',
      {
        runtime: Runtime.NODEJS_LATEST,
        entry: path.join(__dirname, 'discovery', 'handler.ts'),
        handler: 'handler',
        bundling: {
          target: 'node20',
          format: OutputFormat.CJS,
          externalModules: [],
        },
        environment: {
          SIGNER_TOKEN: signerToken,
          DEFAULT_REGION: Stack.of(this).region,
          REPOSITORY_TAG_VALUE: repositoryTagValue,
        },
      },
    )

    const signerIntegration = new HttpLambdaIntegration(
      'SigV4SignerIntegration',
      signerFunction,
    )
    const discoveryIntegration = new HttpLambdaIntegration(
      'InfraDiscoveryIntegration',
      discoveryFunction,
    )
    const signerApi = new HttpApi(this, 'SigV4SignerApi', {
      corsPreflight: {
        allowHeaders: ['authorization', 'content-type'],
        allowMethods: [CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
        allowOrigins: ['*'],
      },
    })

    signerApi.addRoutes({
      path: '/sign',
      methods: [HttpMethod.POST],
      integration: signerIntegration,
    })
    signerApi.addRoutes({
      path: '/discovery',
      methods: [HttpMethod.POST],
      integration: discoveryIntegration,
    })

    new CfnOutput(this, 'InstanceId', {
      value: instance.instanceId,
      description: 'EC2 instance ID',
    })

    new CfnOutput(this, 'PublicDnsName', {
      value: instance.instancePublicDnsName,
      description: 'Public DNS name for SSH',
    })

    new CfnOutput(this, 'PublicIp', {
      value: instance.instancePublicIp ?? '0.0.0.0',
      description: 'Public IP address for SSH',
    })

    new CfnOutput(this, 'SignerEndpoint', {
      value: `${signerApi.apiEndpoint}/sign`,
      description: 'HTTPS endpoint for obtaining SigV4 signed websocket URLs',
    })

    new CfnOutput(this, 'SignerToken', {
      value: signerToken,
      description: 'Bearer token required to use the SigV4 signer endpoint',
    })

    new CfnOutput(this, 'SignerDefaults', {
      value: JSON.stringify({
        endpoint: defaultSignerEndpoint,
        region: Stack.of(this).region,
        service: signerService,
        maxExpires,
        defaultExpires,
      }),
      description: 'Default signing configuration for the SigV4 signer',
    })

    new CfnOutput(this, 'DiscoveryEndpoint', {
      value: `${signerApi.apiEndpoint}/discovery`,
      description:
        'HTTPS endpoint for discovering Nimbus-tagged infrastructure (filtered via mana:* tags)',
    })
  }
}
