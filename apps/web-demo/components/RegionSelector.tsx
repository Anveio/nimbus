'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type React from 'react'
import { useTransition } from 'react'

interface RegionSelectorProps {
  readonly regions: readonly string[]
  readonly selectedRegion: string
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '1rem',
  padding: '1.25rem 1.5rem',
  borderRadius: '16px',
  backgroundColor: 'rgba(15, 23, 42, 0.65)',
  border: '1px solid rgba(148, 163, 184, 0.25)',
}

const labelStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.95rem',
  color: 'rgba(226, 232, 240, 0.85)',
  fontWeight: 500,
}

const selectStyle: React.CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderRadius: '12px',
  backgroundColor: 'rgba(30, 41, 59, 0.9)',
  color: 'rgba(226, 232, 240, 0.95)',
  border: '1px solid rgba(100, 116, 139, 0.45)',
  fontSize: '0.95rem',
}

export function RegionSelector(props: RegionSelectorProps): React.ReactElement {
  const { regions, selectedRegion } = props
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextRegion = event.target.value
    const params = new URLSearchParams(searchParams.toString())
    if (nextRegion === 'all') {
      params.delete('region')
    } else {
      params.set('region', nextRegion)
    }
    startTransition(() => {
      const query = params.toString()
      router.push(query.length > 0 ? `${pathname}?${query}` : pathname)
    })
  }

const options: Array<{ label: string; value: string }> = regions.map(
  (region) => ({ label: region, value: region }),
)

  return (
    <div style={containerStyle}>
      <p style={labelStyle}>
        {pending ? 'Switching regions…' : 'Viewing instances for:'}
      </p>
      <select
        style={selectStyle}
        value={selectedRegion}
        onChange={handleChange}
        disabled={pending}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
