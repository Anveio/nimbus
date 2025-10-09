import * as path from 'node:path'
import { readFileSync } from 'node:fs'
import { Stack, StackProps } from 'aws-cdk-lib'
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
import { CfnOutput } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { applyManaTags } from './tags'

interface TestingInstanceConnectStackProps extends StackProps {}

const DEFAULT_TESTING_USER = 'mana-integ'

export class TestingInstanceConnectStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props?: TestingInstanceConnectStackProps,
  ) {
    super(scope, id, props)

    applyManaTags(this, {
      purpose: 'instance-connect-testing',
      additionalTags: {
        'mana:testing-stack': 'true',
      },
    })

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

    const securityGroup = new SecurityGroup(this, 'TestingSecurityGroup', {
      vpc,
      description: 'Mana testing SSH security group',
      allowAllOutbound: true,
    })
    securityGroup.addIngressRule(
      Peer.ipv4(allowedIp),
      Port.tcp(22),
      'Allow SSH from testing workstation',
    )

    const amiSsmParameter =
      architecture === 'arm64'
        ? '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64'
        : '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64'

    const machineImage = MachineImage.fromSsmParameter(amiSsmParameter, {
      os: OperatingSystemType.LINUX,
    })

    const userData = UserData.forLinux()
    userData.addCommands('set -euxo pipefail')
    const bootstrapScript = readFileSync(
      path.join(__dirname, 'testing-user-data.sh'),
      'utf8',
    )
    userData.addCommands(`cat <<'EOF' >/tmp/bootstrap.sh
${bootstrapScript}
EOF
chmod +x /tmp/bootstrap.sh
MANA_TESTING_USER=${DEFAULT_TESTING_USER} /tmp/bootstrap.sh`)

    const instance = new Instance(this, 'TestingInstance', {
      vpc,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      instanceType,
      machineImage,
      securityGroup,
      userData,
    })

    new CfnOutput(this, 'InstanceId', {
      value: instance.instanceId,
      description: 'EC2 instance ID used for integration tests',
    })

    new CfnOutput(this, 'PublicDnsName', {
      value: instance.instancePublicDnsName,
      description: 'Public DNS name for SSH',
    })

    new CfnOutput(this, 'PublicIp', {
      value: instance.instancePublicIp ?? '0.0.0.0',
      description: 'Public IP address for SSH',
    })

    new CfnOutput(this, 'TestingUser', {
      value: DEFAULT_TESTING_USER,
      description: 'Linux user configured for integration tests',
    })
  }
}
