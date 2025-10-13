import Link from 'next/link'
import { getEc2InstanceById } from '@/lib/ec2'
import { InstanceSummary } from '@/components/InstanceSummary'
import { InstructionPanel } from '@/components/InstructionPanel'
import { TerminalPreview } from '@/components/TerminalPreview'

export const dynamic = 'force-dynamic'

interface PageParams {
  readonly instanceId: string
}

export default async function InstanceConnectPage(
  props: { readonly params: Promise<PageParams> },
): Promise<React.ReactElement> {
  const { instanceId } = await props.params
  const result = await getEc2InstanceById(instanceId)

  if (result.kind === 'auth-error') {
    return (
      <div
        style={{
          padding: '2.5rem clamp(1.5rem, 5vw, 4rem) 4rem',
        }}
      >
        <InstructionPanel
          title="AWS authentication required"
          description="We could not authenticate against EC2 to load instance metadata."
          steps={[
            {
              heading: 'Check AWS credentials',
              detail:
                'Set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or attach an instance profile. The credential scope must allow ec2:DescribeInstances.',
            },
            {
              heading: 'Confirm NIMBUS_WEB_DEMO_REGIONS',
              detail:
                'Ensure the desired instance region is included in the configured region list.',
            },
          ]}
        />
      </div>
    )
  }

  if (result.kind === 'error') {
    return (
      <div
        style={{
          padding: '2.5rem clamp(1.5rem, 5vw, 4rem) 4rem',
        }}
      >
        <InstructionPanel
          title="Unable to load instance metadata"
          description="An unexpected error occurred while looking up the target EC2 instance."
          steps={[
            {
              heading: 'Error details',
              detail: result.message,
            },
            {
              heading: 'Return to the roster',
              detail:
                'Head back to the instance list and try again once connectivity is restored.',
            },
          ]}
          action={
            <Link
              href="/"
              style={{
                display: 'inline-block',
                padding: '0.6rem 1rem',
                borderRadius: '12px',
                backgroundColor: 'rgba(59, 130, 246, 0.25)',
                color: 'rgba(191, 219, 254, 0.95)',
                fontWeight: 600,
              }}
            >
              Back to instances
            </Link>
          }
        />
      </div>
    )
  }

  if (result.kind === 'not-found') {
    return (
      <div
        style={{
          padding: '2.5rem clamp(1.5rem, 5vw, 4rem) 4rem',
        }}
      >
        <InstructionPanel
          title="Instance not found"
          description={`The EC2 API did not return an instance with ID “${instanceId}”.`}
          steps={[
            {
              heading: 'Confirm the instance ID',
              detail:
                'Double-check the ID in the URL and verify the instance is still running.',
            },
            {
              heading: 'Refresh the roster',
              detail:
                'Instances can terminate or change regions. Return to the index page and pick an available host.',
            },
          ]}
          action={
            <Link
              href="/"
              style={{
                display: 'inline-block',
                padding: '0.6rem 1rem',
                borderRadius: '12px',
                backgroundColor: 'rgba(59, 130, 246, 0.25)',
                color: 'rgba(191, 219, 254, 0.95)',
                fontWeight: 600,
              }}
            >
              Back to instances
            </Link>
          }
        />
      </div>
    )
  }

  const { instance } = result

  return (
    <div
      style={{
        padding: '2.5rem clamp(1.5rem, 5vw, 4rem) 4rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '2rem',
      }}
    >
      <Link
        href="/"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.35rem 0',
          color: 'rgba(191, 219, 254, 0.95)',
          fontSize: '0.9rem',
        }}
      >
        ← Back to instances
      </Link>
      <InstanceSummary instance={instance} />
      <div
        style={{
          display: 'grid',
          gap: '2rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          alignItems: 'start',
        }}
      >
        <TerminalPreview />
        <InstructionPanel
          title="Connect Nimbus to EC2 Instance Connect"
          description="Use the Nimbus websocket proxy to bridge the terminal runtime to EC2 Instance Connect. The helper scripts in apps/web-demo/infra automate this flow."
          steps={[
            {
              heading: 'Provision the websocket proxy',
              detail:
                'Run `npm run infra:deploy` or the testing equivalent to deploy the WebSocket/SSH bridge and signer Lambda.',
            },
            {
              heading: 'Request a signed WebSocket URL',
              detail:
                'Call the signer endpoint with the target instance ID. The signer returns a SigV4 URL backing the AQMP websocket bridge.',
            },
            {
              heading: 'Forward runtime responses',
              detail:
                'Inside this page, wire the Nimbus terminal runtime’s `onRuntimeResponse` events back into your transport so EC2 Instance Connect receives mouse reports and command sequences.',
            },
          ]}
        />
      </div>
    </div>
  )
}
