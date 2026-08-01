import type { ReactNode } from 'react'

type ModalHeadingProps = {
  section: string
  title: ReactNode
  id?: string
  variant?: 'standard' | 'compact'
  className?: string
}

export function ModalHeading({
  section,
  title,
  id,
  variant = 'standard',
  className = '',
}: ModalHeadingProps) {
  return (
    <div
      className={`app-modal-heading app-modal-heading--${variant} min-w-0 ${className}`.trim()}
    >
      <div className="app-modal-heading__section">{section}</div>
      <h2 id={id} className="app-modal-heading__title">
        {title}
      </h2>
    </div>
  )
}
