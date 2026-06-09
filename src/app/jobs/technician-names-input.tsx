'use client'

import { useEffect, useMemo, useRef } from 'react'
import {
  joinTechnicianNames,
  normalizeTechnicianSearchText,
  resolveTechnicianName,
  splitTechnicianInput,
} from '@/lib/jobs/technicians'

type TechnicianNamesInputProps = {
  id: string
  value: string
  technicians: string[]
  onValueChange: (value: string) => void
  onBlur?: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function TechnicianNamesInput({
  id,
  value,
  technicians,
  onValueChange,
  onBlur,
  placeholder = 'Zadej jedno nebo více jmen oddělených čárkou',
  disabled = false,
  className = '',
}: TechnicianNamesInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const techniciansByNormalized = useMemo(() => {
    const map = new Map<string, string>()

    technicians.forEach((name) => {
      const trimmed = name.trim()
      if (!trimmed) return

      map.set(normalizeTechnicianSearchText(trimmed), trimmed)
    })

    return map
  }, [technicians])

  useEffect(() => {
    if (!inputRef.current) return

    const currentValue = inputRef.current.value
    if (currentValue !== value) {
      inputRef.current.value = value
    }
  }, [value])

  function completeValue(nextRawValue: string) {
    const parts = nextRawValue.split(',')
    const normalizedParts = parts.map((part) => part.trim())

    const resolvedParts = normalizedParts.map((part, index) => {
      if (!part) return ''

      const resolved = resolveTechnicianName(
        part,
        Array.from(techniciansByNormalized.values())
      )

      if (resolved) {
        return resolved
      }

      if (index !== normalizedParts.length - 1) {
        return part
      }

      return part
    })

    const joined = joinTechnicianNames(
      resolvedParts.filter((part) => part.length > 0)
    )

    const lastSegment = normalizedParts[normalizedParts.length - 1] ?? ''
    const resolvedLast = resolveTechnicianName(
      lastSegment,
      Array.from(techniciansByNormalized.values())
    )

    if (
      resolvedLast &&
      normalizeTechnicianSearchText(lastSegment).length >= 3 &&
      !nextRawValue.trimEnd().endsWith(',')
    ) {
      return `${joined}, `
    }

    return joined
  }

  function handleChange(nextRawValue: string) {
    const nextValue = completeValue(nextRawValue)
    onValueChange(nextValue)
  }

  function handleBlur() {
    const resolved = splitTechnicianInput(value)
      .map((part) => {
        const resolvedName = resolveTechnicianName(
          part,
          Array.from(techniciansByNormalized.values())
        )

        return resolvedName ?? part.trim()
      })
      .filter((part) => part.length > 0)

    const nextValue = joinTechnicianNames(resolved)

    onValueChange(nextValue)
    onBlur?.(nextValue)
  }

  return (
    <input
      ref={inputRef}
      id={id}
      type="text"
      value={value}
      disabled={disabled}
      autoComplete="off"
      placeholder={placeholder}
      onChange={(event) => handleChange(event.target.value)}
      onBlur={handleBlur}
      className={className}
    />
  )
}
