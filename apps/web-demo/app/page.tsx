import Link from 'next/link'
import { InstancesTable } from '@/components/InstancesTable'
import { InstructionPanel } from '@/components/InstructionPanel'
import { listEc2Instances } from '@/lib/ec2'

export const dynamic = 'force-dynamic'

export default async function HomePage(): Promise<React.ReactElement> {
  const result = await listEc2Instances()

  return (
    <div
      style={{
        padding: '2.5rem clamp(1.5rem, 5vw, 4rem) 4rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '2.5rem',
      }}
    >
      {result.kind === 'success' && result.instances.length > 0 ? (
        <section>
          <p
            style={{
              margin: 0,
              marginBottom: '1rem',
              fontSize: '1rem',
              color: 'rgba(226, 232, 240, 0.78)',
            }}
          >
            Select an instance to launch the Nimbus terminal. We automatically
            pull metadata from the EC2 API so you always connect to the correct
            host.
          </p>
          <InstancesTable instances={result.instances} />
        </section>
      ) : null}

      {result.kind === 'success' && result.instances.length === 0 ? (
        <InstructionPanel
          title="No EC2 instances found"
          description="Launch an EC2 instance that supports EC2 Instance Connect, then reload this page to attach the Nimbus terminal."
          steps={[
            {
              heading: 'Provision an instance with EC2 Instance Connect',
              detail:
                'Use the AWS console, CLI, or CDK to launch an instance based on Amazon Linux 2 or another AMI with EC2 Instance Connect enabled. Ensure port 22 is open from your corporate or development CIDR block.',
            },
            {
              heading: 'Attach an IAM role with instance-connect permissions',
              detail:
                'The instance profile must allow the ec2-instance-connect:SendSSHPublicKey action. We recommend the managed “AmazonEC2InstanceConnect” policy.',
            },
            {
              heading: 'Reload this demo',
              detail:
                'Once the instance is reachable and EC2 returns it in DescribeInstances, the table above will populate automatically.',
            },
          ]}
        />
      ) : null}

      {result.kind === 'auth-error' ? (
        <InstructionPanel
          title="Configure AWS credentials"
          description="Nimbus fetches EC2 metadata directly from AWS. We were unable to authenticate with the current execution environment."
          steps={[
            {
              heading: 'Export AWS credentials locally',
              detail:
                'Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and optionally AWS_SESSION_TOKEN before starting `npm run dev`. Scope credentials to a role that can call ec2:DescribeInstances.',
            },
            {
              heading: 'Or attach an instance profile',
              detail:
                'If running this demo on EC2, attach an IAM role with the necessary permissions so the SDK can source credentials with Instance Metadata Service (IMDS).',
            },
            {
              heading: 'Specify the regions to scan',
              detail:
                'Set NIMBUS_WEB_DEMO_REGIONS="us-west-2,us-east-1" (comma separated) or rely on AWS_REGION. The demo queries each configured region.',
            },
          ]}
          action={
            <Link
              href="https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html"
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.6rem 1rem',
                borderRadius: '12px',
                backgroundColor: 'rgba(59, 130, 246, 0.25)',
                color: 'rgba(191, 219, 254, 0.95)',
                fontWeight: 600,
              }}
            >
              AWS credential setup guide ↗
            </Link>
          }
        />
      ) : null}

      {result.kind === 'error' ? (
        <InstructionPanel
          title="Failed to query EC2"
          description="We hit an unexpected error while gathering instance metadata."
          steps={[
            {
              heading: 'Error details',
              detail: result.message,
            },
            {
              heading: 'Retry later',
              detail:
                'Transient throttling or region outages can trigger this path. Wait a few moments and refresh.',
            },
            {
              heading: 'Verify connectivity',
              detail:
                'Ensure this deployment can reach the EC2 public API endpoints for the configured regions.',
            },
          ]}
        />
      ) : null}
    </div>
  )
}
