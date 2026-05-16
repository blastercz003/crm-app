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
      <div className="flex flex-wrap items-center justify-between gap-0.5">
        <h2 className={styles.sectionTitle}>ŽEBŘÍČEK</h2>
        <div className="flex gap-0.5">
          <select
            value={difficulty}
            onChange={(event) => onDifficultyChange(event.target.value as DifficultyFilter)}
            className={`${styles.select} h-6 px-1 py-0 text-[9px]`}
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
            className={`${styles.select} h-6 px-1 py-0 text-[9px]`}
          >
            <option value="today">DNES</option>
            <option value="week">TENTO TÝDEN</option>
            <option value="all">CELKEM</option>
          </select>
        </div>
      </div>

      {loading ? <p className="mt-1 text-[10px] text-slate-300">Načítám leaderboard…</p> : null}
      {error ? <p className="mt-1 text-[10px] text-amber-700">{error}</p> : null}

      <div className="mt-1 min-h-0 flex-1 overflow-auto overflow-x-hidden">
        <table className="w-full table-fixed border-collapse text-left text-[10px]">
          <colgroup>
            <col className="w-[9%]" />
            <col className="w-[31%]" />
            <col className="w-[23%]" />
            <col className="w-[15%]" />
            <col className="w-[22%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-slate-700 text-[9px] uppercase tracking-[0.04em] text-slate-300">
              <th className="py-0.5 pr-1">#</th>
              <th className="py-0.5 pr-1">Jméno</th>
              <th className="py-0.5 pr-1">Score</th>
              <th className="py-0.5 pr-1">Lvl</th>
              <th className="py-0.5 pr-0">Mód</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry) => (
              <tr
                key={`${entry.rank}-${entry.displayName}-${entry.createdAt}`}
                className={`border-b border-slate-800 ${entry.isCurrentPlayer ? 'bg-blue-950/50' : ''}`}
              >
                <td className="py-0.5 pr-1 font-medium text-slate-200">{entry.rank}</td>
                <td className="truncate py-0.5 pr-1 text-[11px] font-medium leading-tight text-slate-100">
                  {entry.displayName}
                </td>
                <td className="py-0.5 pr-1 text-[11px] font-semibold text-slate-100">{entry.score}</td>
                <td className="py-0.5 pr-1 text-[11px] text-slate-200">{entry.level}</td>
                <td className="truncate py-0.5 pr-0 text-[9px] uppercase tracking-[0.02em] text-slate-300">
                  {formatModeShort(entry.gameMode)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.entries.length === 0 ? (
          <p className="py-2 text-[10px] text-slate-400">Zatím žádné výsledky.</p>
        ) : null}
      </div>

      <p className="mt-0.5 text-[10px] text-slate-300">
        Tvé nejlepší skóre: {data.currentPlayerBest ? `#${data.currentPlayerBest.rank} (${data.currentPlayerBest.score})` : '-'}
      </p>
    </section>
  )
}

function formatModeShort(mode: string | null) {
  if (mode === 'classic') return 'Classic'
  if (mode === 'arcade-chaos') return 'Chaos'
  if (mode === 'zen') return 'Zen'
  if (mode === 'enemy-hunt') return 'Hunt'
  return '-'
}
