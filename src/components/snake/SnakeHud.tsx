import styles from './snake.module.css'

type SnakeHudProps = {
  score: number
  level: number
  difficultyLabel: string
  localBest: number
  onlineRank: number | null
}

export function SnakeHud({ score, level, difficultyLabel, localBest, onlineRank }: SnakeHudProps) {
  return (
    <div className={styles.hudGrid}>
      <HudItem label="Score" value={String(score)} />
      <HudItem label="Level" value={String(level)} />
      <HudItem label="Difficulty" value={difficultyLabel} />
      <HudItem label="Local best" value={String(localBest)} />
      <HudItem label="Online rank" value={onlineRank ? `#${onlineRank}` : '-'} />
    </div>
  )
}

function HudItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white/85 px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.07em] text-zinc-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-zinc-900">{value}</p>
    </div>
  )
}
