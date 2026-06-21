'use client'

import { useState } from 'react'

function normalizeCurrencyInput(value: string, allowNegative: boolean) {
  const trimmed = value.trim()
  if (!trimmed) return ''

  const hasNegative = allowNegative && trimmed.includes('-')
  const digitsOnly = trimmed.replaceAll(/[^\d]/g, '')

  if (!digitsOnly) {
    return hasNegative ? '-' : ''
  }

  return hasNegative ? `-${digitsOnly}` : digitsOnly
}

function formatCurrencyDisplay(value: string, allowNegative: boolean) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return ''

  const absolute = Math.abs(Math.round(parsed))
  const formatted = new Intl.NumberFormat('cs-CZ', {
    maximumFractionDigits: 0,
  })
    .format(absolute)
    .replaceAll(/\s+/g, '.')

  const prefix = allowNegative && parsed < 0 ? '-' : ''
  return `${prefix}${formatted},- Kč`
}

type MoneyInputProps = {
  id?: string
  name: string
  defaultValue?: string | number | null
  placeholder?: string
  required?: boolean
  allowNegative?: boolean
  className?: string
}

export function MoneyInput({
  id,
  name,
  defaultValue = null,
  placeholder = 'Např. 3.000,- Kč',
  required = false,
  allowNegative = false,
  className = '',
}: MoneyInputProps) {
  const [rawValue, setRawValue] = useState(() =>
    normalizeCurrencyInput(String(defaultValue ?? ''), allowNegative)
  )
  const [isFocused, setIsFocused] = useState(false)

  const displayValue =
    isFocused || !rawValue ? rawValue : formatCurrencyDisplay(rawValue, allowNegative)
  const inputId = id ?? name

  return (
    <>
      <input type="hidden" name={name} value={rawValue} />
      <input
        id={inputId}
        type="text"
        inputMode="decimal"
        required={required}
        value={displayValue}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onChange={(event) => setRawValue(normalizeCurrencyInput(event.target.value, allowNegative))}
      />
    </>
  )
}
