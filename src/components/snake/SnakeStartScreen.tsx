import styles from './snake.module.css'

export function SnakeStartScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className={`${styles.overlay} hidden sm:flex`}>
      <div className={styles.overlayCard}>
        <h2 className="text-lg font-semibold">Snake</h2>
        <p className="mt-2 text-sm text-slate-200">
          Ovládání: šipky nebo WASD. Mezerník pozastaví/pokračuje. Enter restartuje po game over.
        </p>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonPrimary} mt-4 w-full px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em]`}
          onClick={onStart}
        >
          SPUSTIT
        </button>
      </div>
    </div>
  )
}
