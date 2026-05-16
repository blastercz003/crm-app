import styles from './snake.module.css'

export function SnakeGameOverDialog({
  score,
  level,
  foodEaten,
  isNewLocalBest,
  submitState,
  onPlayAgain,
  isHyperHd,
}: {
  score: number
  level: number
  foodEaten: number
  isNewLocalBest: boolean
  submitState: string
  onPlayAgain: () => void
  isHyperHd?: boolean
}) {
  return (
    <div className={styles.overlay}>
      <div className={`${styles.overlayCard} ${isHyperHd ? styles.hyperHdOverlayCard : ''}`}>
        <h2 className="text-lg font-semibold">KONEC HRY</h2>
        <p className="mt-2 text-sm text-slate-200">Skóre: {score}</p>
        <p className="text-sm text-slate-200">Level: {level}</p>
        <p className="text-sm text-slate-200">Snědené jídlo: {foodEaten}</p>
        <p className="text-sm text-slate-200">Nový local best: {isNewLocalBest ? 'Ano' : 'Ne'}</p>
        <p className="mt-2 text-xs text-slate-300">{submitState}</p>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonPrimary} ${isHyperHd ? styles.hyperHdPrimaryButton : ''} mt-4 w-full px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em]`}
          onClick={onPlayAgain}
        >
          HRÁT ZNOVU
        </button>
      </div>
    </div>
  )
}
