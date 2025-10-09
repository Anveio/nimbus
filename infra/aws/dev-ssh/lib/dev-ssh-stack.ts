import * as path from 'node:path'
import { readFileSync } from 'node:fs'
import { Stack, StackProps } from 'aws-cdk-lib'
import {
  AmazonLinuxCpuType,
  AmazonLinuxGeneration,
  Instance,
  InstanceType,
  MachineImage,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  UserData,
  Vpc,
} from 'aws-cdk-lib/aws-ec2'
import { CfnOutput } from 'aws-cdk-lib'

interface DevSshStackProps extends StackProps {}

export class DevSshStack extends Stack {
  constructor(scope: Stack, id: string, props?: DevSshStackProps) {
    super(scope, id, props)

    const keyName = this.node.tryGetContext('keyName') as string | undefined
    if (!keyName) {
      throw new Error(
        'Context variable "keyName" is required. Supply via: cdk deploy --context keyName=your-key-pair',
      )
    }

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
      description: 'Mana dev SSH security group',
      allowAllOutbound: true,
    })
    securityGroup.addIngressRule(
      Peer.ipv4(allowedIp),
      Port.tcp(22),
      'Allow SSH from developer workstation',
    )

    const machineImage =
      architecture === 'arm64'
        ? MachineImage.latestAmazonLinux({
            generation: AmazonLinuxGeneration.AMAZON_LINUX_2023,
            cpuType: AmazonLinuxCpuType.ARM_64,
          })
        : MachineImage.latestAmazonLinux({
            generation: AmazonLinuxGeneration.AMAZON_LINUX_2023,
            cpuType: AmazonLinuxCpuType.X86_64,
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
      keyName,
      userData,
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
  }
}
