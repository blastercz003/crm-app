'use client'

import { useFormStatus } from 'react-dom'

type DepotToggleButtonProps = {
  label: string
  className: string
  disabled?: boolean
}

export function DepotToggleButton({
  label,
  className,
  disabled = false,
}: DepotToggleButtonProps) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      className={[
        className,
        pending ? 'cursor-wait opacity-75' : '',
      ].join(' ')}
    >
      {pending ? 'MĚNÍM...' : label}
    </button>
  )
}
