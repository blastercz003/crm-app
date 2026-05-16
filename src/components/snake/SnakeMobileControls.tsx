import type { Direction } from '@/lib/snake/types'
import styles from './snake.module.css'

export function SnakeMobileControls({
  onDirection,
}: {
  onDirection: (direction: Direction) => void
}) {
  return (
    <div className={styles.mobileControls} aria-label="Mobilní ovládání hada">
      <span />
      <button
        type="button"
        aria-label="Pohyb nahoru"
        className={styles.mobileControlButton}
        onClick={() => onDirection('up')}
      >
        ▲
      </button>
      <span />
      <button
        type="button"
        aria-label="Pohyb doleva"
        className={styles.mobileControlButton}
        onClick={() => onDirection('left')}
      >
        ◀
      </button>
      <span />
      <button
        type="button"
        aria-label="Pohyb doprava"
        className={styles.mobileControlButton}
        onClick={() => onDirection('right')}
      >
        ▶
      </button>
      <span />
      <button
        type="button"
        aria-label="Pohyb dolů"
        className={styles.mobileControlButton}
        onClick={() => onDirection('down')}
      >
        ▼
      </button>
      <span />
    </div>
  )
}
