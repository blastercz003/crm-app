import styles from './snake.module.css'

export function SnakeGameOverDialog({
  score,
  level,
  foodEaten,
  isNewLocalBest,
  submitState,
  onPlayAgain,
}: {
  score: number
  level: number
  foodEaten: number
  isNewLocalBest: boolean
  submitState: string
  onPlayAgain: () => void
}) {
  return (
    <div className={styles.overlay}>
      <div className={styles.overlayCard}>
        <h2 className="text-lg font-semibold">KONEC HRY</h2>
        <p className="mt-2 text-sm text-slate-200">Skóre: {score}</p>
        <p className="text-sm text-slate-200">Level: {level}</p>
        <p className="text-sm text-slate-200">Snědené jídlo: {foodEaten}</p>
        <p className="text-sm text-slate-200">Nový local best: {isNewLocalBest ? 'Ano' : 'Ne'}</p>
        <p className="mt-2 text-xs text-slate-300">{submitState}</p>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonPrimary} mt-4 w-full px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em]`}
          onClick={onPlayAgain}
        >
          HRÁT ZNOVU
        </button>
      </div>
    </div>
  )
}
