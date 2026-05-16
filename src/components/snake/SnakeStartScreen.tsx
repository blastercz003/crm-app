import styles from './snake.module.css'

export function SnakeStartScreen({
  onStart,
  modeLabel,
  difficultyLabel,
  isHyperHd,
}: {
  onStart: () => void
  modeLabel: string
  difficultyLabel: string
  isHyperHd?: boolean
}) {
  return (
    <div className={`${styles.overlay} hidden sm:flex`}>
      <div className={`${styles.overlayCard} ${isHyperHd ? styles.hyperHdOverlayCard : ''}`}>
        <h2 className="text-lg font-semibold">{isHyperHd ? 'B-SNAKE • HYPER HD' : 'Snake'}</h2>
        <p className="mt-2 text-sm text-slate-200">
          Ovládání: šipky nebo WASD. Mezerník pozastaví/pokračuje. Enter restartuje po game over.
        </p>
        <p className="mt-2 text-xs uppercase tracking-[0.08em] text-slate-300">
          Mód: {modeLabel} • Obtížnost: {difficultyLabel}
        </p>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonPrimary} ${isHyperHd ? styles.hyperHdPrimaryButton : ''} mt-4 w-full px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em]`}
          onClick={onStart}
        >
          SPUSTIT
        </button>
      </div>
    </div>
  )
}
