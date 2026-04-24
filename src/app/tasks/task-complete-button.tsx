'use client'

import { useFormStatus } from 'react-dom'

type TaskCompleteButtonProps = {
  className: string
  idleLabel?: string
  pendingLabel?: string
}

export function TaskCompleteButton({
  className,
  idleLabel = 'HOTOVO',
  pendingLabel = 'UKLÁDÁM...',
}: TaskCompleteButtonProps) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className={`${className} disabled:cursor-not-allowed disabled:opacity-100`}
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  )
}
