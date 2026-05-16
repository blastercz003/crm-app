import { forwardRef } from 'react'
import styles from './snake.module.css'

export const SnakeCanvas = forwardRef<HTMLCanvasElement>(function SnakeCanvas(_, ref) {
  return <canvas ref={ref} className={styles.canvas} role="img" aria-label="Snake herní plocha" />
})
