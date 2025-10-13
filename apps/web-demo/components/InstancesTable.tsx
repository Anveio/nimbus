import React from 'react'
import Link from 'next/link'
import type { Ec2InstanceSummary } from '@/lib/ec2'

export interface InstancesTableProps {
  readonly instances: readonly Ec2InstanceSummary[]
}

const headerStyle: React.CSSProperties = {
  textAlign: 'left',
  fontSize: '0.85rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'rgba(148, 163, 184, 0.9)',
  padding: '0.75rem 0.75rem',
  borderBottom: '1px solid rgba(148, 163, 184, 0.25)',
  backgroundColor: 'rgba(15, 23, 42, 0.65)',
}

const cellStyle: React.CSSProperties = {
  padding: '0.75rem',
  verticalAlign: 'top',
  fontSize: '0.95rem',
  color: 'rgba(226, 232, 240, 0.92)',
}

function resolveDisplayName(instance: Ec2InstanceSummary): string {
  return instance.name ?? instance.instanceId
}

function describeAddress(instance: Ec2InstanceSummary): string {
  const addresses = [
    instance.publicDnsName,
    instance.publicIpAddress,
    instance.privateIpAddress,
  ].filter(Boolean)
  if (addresses.length === 0) {
    return '—'
  }
  return addresses.join('\n')
}

export function InstancesTable(
  props: InstancesTableProps,
): React.ReactElement {
  const { instances } = props
  return (
    <div
      style={{
        borderRadius: '16px',
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(148, 163, 184, 0.25)',
        overflow: 'hidden',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={headerStyle}>Name</th>
            <th style={headerStyle}>Instance ID</th>
            <th style={headerStyle}>State</th>
            <th style={headerStyle}>Type</th>
            <th style={headerStyle}>Zone</th>
            <th style={headerStyle}>Region</th>
            <th style={headerStyle}>Addresses</th>
            <th style={headerStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {instances.map((instance) => (
            <tr key={`${instance.region}:${instance.instanceId}`}>
              <td style={cellStyle}>
                <strong>{resolveDisplayName(instance)}</strong>
              </td>
              <td style={cellStyle}>
                <code>{instance.instanceId}</code>
              </td>
              <td style={cellStyle}>{instance.state ?? 'unknown'}</td>
              <td style={cellStyle}>{instance.instanceType ?? '—'}</td>
              <td style={cellStyle}>{instance.availabilityZone ?? '—'}</td>
              <td style={cellStyle}>{instance.region}</td>
              <td style={{ ...cellStyle, whiteSpace: 'pre-wrap' }}>
                {describeAddress(instance)}
              </td>
              <td style={cellStyle}>
                <Link
                  href={`/ec2-instance-connect/${encodeURIComponent(
                    instance.instanceId,
                  )}`}
                  style={{
                    display: 'inline-block',
                    padding: '0.4rem 0.9rem',
                    borderRadius: '9999px',
                    background:
                      'linear-gradient(135deg, #22d3ee 0%, #6366f1 100%)',
                    color: '#020617',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    transition: 'transform 120ms ease',
                  }}
                >
                  Connect
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
