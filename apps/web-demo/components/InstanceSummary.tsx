import React from 'react'
import type { Ec2InstanceSummary } from '@/lib/ec2'

export function InstanceSummary(props: {
  readonly instance: Ec2InstanceSummary
}): React.ReactElement {
  const { instance } = props
  const detailRows: Array<[string, string]> = [
    ['Instance ID', instance.instanceId],
    ['Region', instance.region],
    ['Availability zone', instance.availabilityZone ?? '—'],
    ['State', instance.state ?? 'unknown'],
    ['Instance type', instance.instanceType ?? '—'],
    ['Public DNS', instance.publicDnsName ?? '—'],
    ['Public IP', instance.publicIpAddress ?? '—'],
    ['Private IP', instance.privateIpAddress ?? '—'],
  ]
  if (instance.launchTime) {
    detailRows.push([
      'Launch time',
      new Date(instance.launchTime).toLocaleString(),
    ])
  }
  return (
    <section
      style={{
        borderRadius: '16px',
        padding: '1.75rem',
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        border: '1px solid rgba(148, 163, 184, 0.35)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: '1.25rem',
          fontWeight: 600,
          color: 'rgba(226, 232, 240, 0.95)',
        }}
      >
        {instance.name ?? instance.instanceId}
      </h2>
      <p
        style={{
          marginTop: '0.75rem',
          marginBottom: '1.25rem',
          color: 'rgba(203, 213, 225, 0.85)',
          fontSize: '0.95rem',
        }}
      >
        Metadata for the selected EC2 instance. Verify networking (port 22) and
        IAM permissions before starting a terminal session.
      </p>
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(140px, 1fr) minmax(220px, 2fr)',
          gap: '0.5rem 1.5rem',
          margin: 0,
          fontSize: '0.95rem',
          color: 'rgba(226, 232, 240, 0.9)',
        }}
      >
        {detailRows.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt
              style={{
                fontWeight: 600,
                color: 'rgba(148, 163, 184, 0.9)',
              }}
            >
              {label}
            </dt>
            <dd style={{ margin: 0 }}>{value}</dd>
          </React.Fragment>
        ))}
      </dl>
    </section>
  )
}
