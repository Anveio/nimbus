import Link from 'next/link'
import { InstanceSummary } from '@/components/InstanceSummary'
import { InstructionPanel } from '@/components/InstructionPanel'
import { TerminalPreview } from '@/components/TerminalPreview'
import { getEc2InstanceById } from '@/lib/ec2'
import type { InstanceConnectPresignResult } from '@/lib/instance-connect-presign'
import { generateInstanceConnectUrlAction } from './actions'

export const dynamic = 'force-dynamic'

interface PageParams {
  readonly instanceId: string
}

interface PageProps {
  readonly params: Promise<PageParams>
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function InstanceConnectPage(
  props: PageProps,
): Promise<React.ReactElement> {
  const { instanceId } = await props.params
  const query = (await props.searchParams) ?? {}
  const regionParam =
    typeof query.region === 'string' ? query.region.trim() : undefined

  const result = await getEc2InstanceById(instanceId, regionParam)

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
  let presignResult: InstanceConnectPresignResult | null = null
  let presignError: string | null = null

  try {
    presignResult = await generateInstanceConnectUrlAction({
      instanceId,
      region: instance.region ?? regionParam,
      addressFamily: 'ipv4',
      port: 22,
    })
  } catch (error) {
    presignError =
      error instanceof Error ? error.message : String(error ?? 'Unknown error')
  }

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
          description="Use the websocket bridge deployed by the infra helpers and request a SigV4 signed websocket URL directly from this page."
          steps={[
            {
              heading: 'Provision the websocket proxy',
              detail:
                'Run `npm run infra:deploy` or the testing equivalent to deploy the WebSocket/SSH bridge. The bridge exposes an AQMP websocket endpoint compatible with EC2 Instance Connect.',
            },
            {
              heading: 'Trigger the server action signer',
              detail:
                'This page invokes `generateInstanceConnectUrlAction` on the server to presign a websocket URL using your configured AWS credentials.',
            },
            {
              heading: 'Forward runtime responses',
              detail:
                'Inside this page, wire the Nimbus terminal runtime’s `onRuntimeResponse` events back into your transport so EC2 Instance Connect receives mouse reports and command sequences.',
            },
          ]}
        />
        <section
          style={{
            borderRadius: '16px',
            padding: '1.75rem',
            backgroundColor: 'rgba(15, 23, 42, 0.7)',
            border: '1px solid rgba(59, 130, 246, 0.35)',
            color: 'rgba(226, 232, 240, 0.92)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.85rem',
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: '1.05rem',
              fontWeight: 600,
            }}
          >
            Server action presigned URL
          </h3>
          {presignResult ? (
            <>
              <p
                style={{
                  margin: 0,
                  fontSize: '0.9rem',
                  color: 'rgba(191, 219, 254, 0.85)',
                }}
              >
                Expires in {presignResult.expiresIn} seconds using service{' '}
                <code
                  style={{
                    fontSize: '0.85rem',
                    backgroundColor: 'rgba(30, 64, 175, 0.25)',
                    padding: '0.05rem 0.35rem',
                    borderRadius: '6px',
                  }}
                >
                  {presignResult.service}
                </code>{' '}
                in region{' '}
                <code
                  style={{
                    fontSize: '0.85rem',
                    backgroundColor: 'rgba(30, 64, 175, 0.25)',
                    padding: '0.05rem 0.35rem',
                    borderRadius: '6px',
                  }}
                >
                  {presignResult.region}
                </code>
                .
              </p>
              <code
                style={{
                  display: 'block',
                  fontSize: '0.82rem',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  padding: '1rem',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(30, 41, 59, 0.75)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                }}
              >
                {presignResult.url}
              </code>
            </>
          ) : (
            <p
              style={{
                margin: 0,
                fontSize: '0.9rem',
                color: 'rgba(248, 113, 113, 0.85)',
              }}
            >
              Unable to generate presigned URL: {presignError ?? 'unknown error'}
            </p>
          )}
          <p
            style={{
              margin: 0,
              fontSize: '0.82rem',
              color: 'rgba(148, 163, 184, 0.85)',
            }}
          >
            Need programmatic access? The legacy `/api/sign` route now proxies
            the same helper, so remote clients can still request signed URLs.
          </p>
        </section>
      </div>
    </div>
  )
}
