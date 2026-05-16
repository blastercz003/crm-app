import { DIFFICULTY_CONFIGS, GAME_MODES, THEMES } from '@/lib/snake/constants'
import type { Difficulty, GameMode, ThemeName } from '@/lib/snake/types'
import styles from './snake.module.css'

type SnakeSettingsProps = {
  difficulty: Difficulty
  gameMode: GameMode
  themeName: ThemeName
  soundEnabled: boolean
  disabled: boolean
  onDifficultyChange: (value: Difficulty) => void
  onGameModeChange: (value: GameMode) => void
  onThemeChange: (value: ThemeName) => void
  onSoundEnabledChange: (value: boolean) => void
}

export function SnakeSettings(props: SnakeSettingsProps) {
  const modeLabel =
    props.gameMode === 'classic'
      ? 'CLASSIC'
      : props.gameMode === 'arcade-chaos'
        ? 'ARCADE CHAOS'
        : props.gameMode === 'zen'
          ? 'ZEN MODE'
          : 'ENEMY HUNT'

  return (
    <section className={`${styles.card} ${styles.panelCard} p-4`}>
      <h2 className={styles.sectionTitle}>Nastavení</h2>
      <div className="mt-3 space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block text-slate-200">Obtížnost</span>
          <select
            className={`${styles.select} w-full px-3 py-2 text-sm`}
            value={props.difficulty}
            disabled={props.disabled}
            onChange={(event) => props.onDifficultyChange(event.target.value as Difficulty)}
          >
            {DIFFICULTY_CONFIGS.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-200">Herní mód</span>
          <select
            className={`${styles.select} w-full px-3 py-2 text-sm`}
            value={props.gameMode}
            disabled={props.disabled}
            onChange={(event) => props.onGameModeChange(event.target.value as GameMode)}
          >
            {GAME_MODES.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-200">Téma</span>
          <select
            className={`${styles.select} w-full px-3 py-2 text-sm`}
            value={props.themeName}
            disabled={props.disabled}
            onChange={(event) => props.onThemeChange(event.target.value as ThemeName)}
          >
            {THEMES.map((theme) => (
              <option key={theme.name} value={theme.name}>
                {theme.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              className="h-4 w-4 accent-blue-400"
              checked={props.soundEnabled}
              onChange={(event) => props.onSoundEnabledChange(event.target.checked)}
            />
            Zvuky hry
          </label>
          <span className={styles.modeBadge}>MÓD: {modeLabel}</span>
        </div>
      </div>
    </section>
  )
}
