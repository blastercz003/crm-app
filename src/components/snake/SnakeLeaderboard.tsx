import type { DifficultyFilter, LeaderboardResponse, PeriodFilter } from '@/lib/snake/types'
import styles from './snake.module.css'

export function SnakeLeaderboard({
  data,
  loading,
  error,
  difficulty,
  period,
  onDifficultyChange,
  onPeriodChange,
}: {
  data: LeaderboardResponse
  loading: boolean
  error: string | null
  difficulty: DifficultyFilter
  period: PeriodFilter
  onDifficultyChange: (value: DifficultyFilter) => void
  onPeriodChange: (value: PeriodFilter) => void
}) {
  return (
    <section className={`${styles.card} ${styles.panelCard} flex h-[300px] flex-col p-4 sm:h-[340px] lg:h-auto lg:min-h-0 lg:flex-1`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={styles.sectionTitle}>ŽEBŘÍČEK</h2>
        <div className="flex gap-2">
          <select
            value={difficulty}
            onChange={(event) => onDifficultyChange(event.target.value as DifficultyFilter)}
            className={`${styles.select} px-2 py-1 text-xs`}
          >
            <option value="all">VŠE</option>
            <option value="easy">LEHKÁ</option>
            <option value="normal">NORMÁLNÍ</option>
            <option value="hard">TĚŽKÁ</option>
            <option value="expert">EXPERT</option>
          </select>
          <select
            value={period}
            onChange={(event) => onPeriodChange(event.target.value as PeriodFilter)}
            className={`${styles.select} px-2 py-1 text-xs`}
          >
            <option value="today">DNES</option>
            <option value="week">TENTO TÝDEN</option>
            <option value="all">CELKEM</option>
          </select>
        </div>
      </div>

      {loading ? <p className="mt-3 text-sm text-slate-300">Načítám leaderboard…</p> : null}
      {error ? <p className="mt-3 text-sm text-amber-700">{error}</p> : null}

      <div className="mt-3 min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-xs uppercase tracking-[0.07em] text-slate-300">
              <th className="py-2 pr-2">#</th>
              <th className="py-2 pr-2">Jméno</th>
              <th className="py-2 pr-2">Score</th>
              <th className="py-2 pr-2">Lvl</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry) => (
              <tr
                key={`${entry.rank}-${entry.displayName}-${entry.createdAt}`}
                className={`border-b border-slate-800 ${entry.isCurrentPlayer ? 'bg-blue-950/50' : ''}`}
              >
                <td className="py-2 pr-2 font-medium text-slate-200">{entry.rank}</td>
                <td className="py-2 pr-2">
                  <p className="font-medium text-slate-100">{entry.displayName}</p>
                  <p className="text-xs text-slate-400">{entry.difficulty}</p>
                </td>
                <td className="py-2 pr-2 font-semibold text-slate-100">{entry.score}</td>
                <td className="py-2 pr-2 text-slate-200">{entry.level}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.entries.length === 0 ? (
          <p className="py-4 text-sm text-slate-400">Zatím žádné výsledky.</p>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-slate-300">
        Tvé nejlepší skóre: {data.currentPlayerBest ? `#${data.currentPlayerBest.rank} (${data.currentPlayerBest.score})` : '-'}
      </p>
    </section>
  )
}
