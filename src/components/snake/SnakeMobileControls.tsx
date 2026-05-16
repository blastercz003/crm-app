import type { Direction } from '@/lib/snake/types'
import styles from './snake.module.css'

function ArrowIcon({ direction }: { direction: Direction }) {
  const rotation =
    direction === 'up'
      ? 'rotate(0 12 12)'
      : direction === 'right'
        ? 'rotate(90 12 12)'
        : direction === 'down'
          ? 'rotate(180 12 12)'
          : 'rotate(270 12 12)'

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.mobileControlIcon}>
      <path transform={rotation} d="M12 5l6 10h-12z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function SnakeMobileControls({
  onDirection,
}: {
  onDirection: (direction: Direction) => void
}) {
  const handleDirectionPress = (direction: Direction) => {
    onDirection(direction)
  }

  return (
    <div className={styles.mobileControls} aria-label="Mobilní ovládání hada">
      <span />
      <button
        type="button"
        aria-label="Pohyb nahoru"
        className={styles.mobileControlButton}
        onPointerDown={(event) => {
          event.preventDefault()
          handleDirectionPress('up')
        }}
      >
        <ArrowIcon direction="up" />
      </button>
      <span />
      <button
        type="button"
        aria-label="Pohyb doleva"
        className={styles.mobileControlButton}
        onPointerDown={(event) => {
          event.preventDefault()
          handleDirectionPress('left')
        }}
      >
        <ArrowIcon direction="left" />
      </button>
      <span />
      <button
        type="button"
        aria-label="Pohyb doprava"
        className={styles.mobileControlButton}
        onPointerDown={(event) => {
          event.preventDefault()
          handleDirectionPress('right')
        }}
      >
        <ArrowIcon direction="right" />
      </button>
      <span />
      <button
        type="button"
        aria-label="Pohyb dolů"
        className={styles.mobileControlButton}
        onPointerDown={(event) => {
          event.preventDefault()
          handleDirectionPress('down')
        }}
      >
        <ArrowIcon direction="down" />
      </button>
      <span />
    </div>
  )
}
