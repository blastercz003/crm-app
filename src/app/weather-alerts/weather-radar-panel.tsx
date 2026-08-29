'use client'

import { Pause, Play, Radar } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import orpMap from '@/lib/weather-alerts/orp-map.json'
import type { WeatherInsightsWorkspace } from '@/lib/weather-insights/types'

type RadarWorkspace = WeatherInsightsWorkspace['radar']

const MAP_WIDTH = 960
const MAP_HEIGHT = 560
const MAP_PADDING = 10
const LONGITUDE_SCALE = Math.cos((49.8 * Math.PI) / 180)
const CZECH_EXTENT = {
  west: 12.0907,
  south: 48.5518,
  east: 18.8593,
  north: 51.0557,
} as const

function projection() {
  const minX = CZECH_EXTENT.west * LONGITUDE_SCALE
  const maxX = CZECH_EXTENT.east * LONGITUDE_SCALE
  const scale = Math.min(
    (MAP_WIDTH - MAP_PADDING * 2) / (maxX - minX),
    (MAP_HEIGHT - MAP_PADDING * 2) /
      (CZECH_EXTENT.north - CZECH_EXTENT.south),
  )
  const contentWidth = (maxX - minX) * scale
  const contentHeight = (CZECH_EXTENT.north - CZECH_EXTENT.south) * scale
  const offsetX = (MAP_WIDTH - contentWidth) / 2
  const offsetY = (MAP_HEIGHT - contentHeight) / 2
  return {
    point(longitude: number, latitude: number) {
      return {
        x: offsetX + (longitude * LONGITUDE_SCALE - minX) * scale,
        y: offsetY + (CZECH_EXTENT.north - latitude) * scale,
      }
    },
  }
}

const MAP_PROJECTION = projection()

// SVG atributy musí mít při SSR a hydrataci znak po znaku stejnou hodnotu.
// Různé JS enginy se mohou v trigonometrickém výpočtu lišit v posledním bitu.
function stableSvgCoordinate(value: number) {
  return value.toFixed(4)
}

function formatRadarTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Čas neuveden'
  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

function useDocumentVisible() {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return visible
}

export function WeatherRadarPanel({ radar }: { radar: RadarWorkspace }) {
  const clipId = `weather-radar-${useId().replaceAll(':', '')}`
  const reducedMotion = useReducedMotion()
  const documentVisible = useDocumentVisible()
  const frames = useMemo(
    () => [...radar.frames].sort(
      (left, right) =>
        new Date(left.validAt).getTime() - new Date(right.validAt).getTime(),
    ),
    [radar.frames],
  )
  const [frameIndex, setFrameIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const safeFrameIndex = Math.min(frameIndex, Math.max(0, frames.length - 1))
  const currentFrame = frames[safeFrameIndex]

  useEffect(() => {
    if (!playing || reducedMotion || !documentVisible || frames.length < 2) return
    let timeout = 0
    let disposed = false
    const schedule = () => {
      if (disposed) return
      const atLastFrame = safeFrameIndex === frames.length - 1
      timeout = window.setTimeout(() => {
        setFrameIndex((current) => (current + 1) % frames.length)
      }, atLastFrame ? 1_150 : 520)
    }
    schedule()
    return () => {
      disposed = true
      window.clearTimeout(timeout)
    }
  }, [documentVisible, frames.length, playing, reducedMotion, safeFrameIndex])

  useEffect(() => {
    if (!currentFrame || frames.length < 2) return
    const nextFrame = frames[(safeFrameIndex + 1) % frames.length]
    const image = new Image()
    image.src = nextFrame.imageUrl
  }, [currentFrame, frames, safeFrameIndex])

  const imageGeometry = currentFrame
    ? (() => {
        const northwest = MAP_PROJECTION.point(
          currentFrame.bounds.west,
          currentFrame.bounds.north,
        )
        const southeast = MAP_PROJECTION.point(
          currentFrame.bounds.east,
          currentFrame.bounds.south,
        )
        return {
          x: stableSvgCoordinate(northwest.x),
          y: stableSvgCoordinate(northwest.y),
          width: stableSvgCoordinate(southeast.x - northwest.x),
          height: stableSvgCoordinate(southeast.y - northwest.y),
        }
      })()
    : null

  return (
    <section className="activities-page__panel h-full min-w-0 overflow-hidden rounded-[28px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--accent)]">
              <Radar aria-hidden size={18} />
            </span>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                Radar a vývoj srážek
              </h2>
              <p className="mt-0.5 text-[10px] text-[var(--text-secondary)]">
                Měření ČHMÚ a krátkodobý vývoj na dalších 60 minut
              </p>
            </div>
          </div>
        </div>

        {currentFrame ? (
          <div className="flex shrink-0 items-center gap-2">
            <span className={`inline-flex h-7 items-center rounded-full border px-2.5 text-[8px] font-bold uppercase tracking-[0.09em] ${currentFrame.frameKind === 'forecast' ? 'border-violet-500/35 bg-violet-500/10 text-violet-700 [html[data-theme=dark]_&]:text-violet-300' : 'border-sky-500/35 bg-sky-500/10 text-sky-700 [html[data-theme=dark]_&]:text-sky-300'}`}>
              {currentFrame.frameKind === 'forecast'
                ? `Výhled +${currentFrame.leadMinutes} min`
                : 'Měření'}
            </span>
            <button
              type="button"
              onClick={() => setPlaying((current) => !current)}
              disabled={frames.length < 2 || reducedMotion}
              aria-label={playing ? 'Pozastavit radarovou animaci' : 'Spustit radarovou animaci'}
              title={playing ? 'Pozastavit animaci' : 'Spustit animaci'}
              className="inline-flex h-8 w-10 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--text-secondary)] transition hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {playing && !reducedMotion ? <Pause aria-hidden size={14} /> : <Play aria-hidden size={14} />}
            </button>
          </div>
        ) : null}
      </div>

      <div className="weather-alerts__record-surface mt-4 flex h-[274px] items-center justify-center overflow-hidden rounded-[22px] border sm:h-[362px] lg:h-[422px]">
        {currentFrame && imageGeometry ? (
          <>
            <div className="relative mx-auto flex h-[250px] w-full max-w-[1080px] items-center justify-center overflow-hidden sm:h-[330px] lg:h-[390px]">
              <svg
                viewBox={orpMap.viewBox.join(' ')}
                role="img"
                aria-label={`Radar srážek nad Českou republikou pro ${formatRadarTime(currentFrame.validAt)}`}
                className="block h-full w-full"
              >
                <defs>
                  <clipPath id={clipId}>
                    {orpMap.areas.map((area) => (
                      <path key={area.code} d={area.path} />
                    ))}
                  </clipPath>
                </defs>
                <g className="fill-[#e5edf5] [html[data-theme=dark]_&]:fill-[var(--surface-strong)]">
                  {orpMap.areas.map((area) => (
                    <path key={area.code} d={area.path} />
                  ))}
                </g>
                <image
                  key={currentFrame.id}
                  href={currentFrame.imageUrl}
                  x={imageGeometry.x}
                  y={imageGeometry.y}
                  width={imageGeometry.width}
                  height={imageGeometry.height}
                  preserveAspectRatio="none"
                  clipPath={`url(#${clipId})`}
                  className="opacity-90"
                />
                <g className="fill-transparent stroke-[#9fb2c4] [html[data-theme=dark]_&]:stroke-[var(--surface-border)]">
                  {orpMap.areas.map((area) => (
                    <path
                      key={area.code}
                      d={area.path}
                      className="stroke-[0.62]"
                      style={{ vectorEffect: 'non-scaling-stroke' }}
                    />
                  ))}
                </g>
              </svg>

              <div className="pointer-events-none absolute bottom-2.5 left-2.5 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)]/90 px-2.5 py-1.5 text-[9px] font-semibold text-[var(--text-primary)] shadow-sm backdrop-blur-sm sm:bottom-3 sm:left-3">
                {formatRadarTime(currentFrame.validAt)}
              </div>
            </div>

          </>
        ) : (
          <div className="flex min-h-[180px] flex-col items-center justify-center px-5 text-center sm:min-h-[230px]">
            <Radar aria-hidden size={24} className="text-[var(--text-tertiary)]" />
            <strong className="mt-2 text-sm text-[var(--text-primary)]">
              Radarová data zatím nejsou načtená.
            </strong>
            <span className="mt-1 max-w-md text-xs leading-5 text-[var(--text-secondary)]">
              Panel se doplní po prvním automatickém načtení dat ČHMÚ.
            </span>
          </div>
        )}
      </div>
    </section>
  )
}
