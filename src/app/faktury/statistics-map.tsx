'use client'

import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { FinanceStatisticsMapJob } from './statistics-actions'
import rawBoundary from '@/lib/czech-map/map-boundary.json'
import rawRoads from '@/lib/czech-map/map-roads.json'

type Coordinate = [longitude: number, latitude: number]

type ProjectedPoint = {
  x: number
  y: number
}

type PositionedMapJob = FinanceStatisticsMapJob &
  ProjectedPoint & {
    offsetX: number
    offsetY: number
  }

type TooltipState = {
  job: PositionedMapJob
  x: number
  y: number
}

type MapPan = {
  x: number
  y: number
}

type MapDragState = {
  pointerId: number
  startPoint: ProjectedPoint
  startPan: MapPan
}

type MapCity = {
  name: string
  latitude: number
  longitude: number
  tier: 'regional' | 'district'
  dx?: number
  dy?: number
}

type SurroundingCountry = {
  code: string
  name: string
  polygons: Coordinate[][]
}

type CzechRegion = {
  name: string
  polygons: Coordinate[][]
}

const MAP_WIDTH = 900
const MAP_HEIGHT = 430
const MAP_PADDING = 28
const MAP_CENTER = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 }
const MIN_ZOOM = 1
const MAX_ZOOM = 3
const ZOOM_STEP = 0.5
const MID_LATITUDE = 49.75
const LONGITUDE_SCALE = Math.cos((MID_LATITUDE * Math.PI) / 180)

const {
  boundary,
  surroundingCountries,
  czechRegions,
} = rawBoundary as unknown as {
    boundary: Coordinate[]
    surroundingCountries: SurroundingCountry[]
    czechRegions: CzechRegion[]
  }

const { motorways, primaryRoads } = rawRoads as unknown as {
  motorways: Coordinate[][]
  primaryRoads: Coordinate[][]
}

const MAP_CITIES: MapCity[] = [
  {
    name: 'Praha',
    latitude: 50.0755,
    longitude: 14.4378,
    tier: 'regional',
    dx: 9,
    dy: -8,
  },
  {
    name: 'Brno',
    latitude: 49.1951,
    longitude: 16.6068,
    tier: 'regional',
    dx: 9,
    dy: -7,
  },
  {
    name: 'Ostrava',
    latitude: 49.8209,
    longitude: 18.2625,
    tier: 'regional',
    dx: -9,
    dy: -8,
  },
  {
    name: 'Plzeň',
    latitude: 49.7384,
    longitude: 13.3736,
    tier: 'regional',
    dx: 9,
    dy: -7,
  },
  {
    name: 'Liberec',
    latitude: 50.7663,
    longitude: 15.0543,
    tier: 'regional',
    dx: 8,
    dy: -7,
  },
  {
    name: 'Ústí n. L.',
    latitude: 50.6611,
    longitude: 14.0531,
    tier: 'regional',
    dx: 9,
    dy: -7,
  },
  {
    name: 'Hradec Králové',
    latitude: 50.2092,
    longitude: 15.8328,
    tier: 'regional',
    dx: 9,
    dy: -7,
  },
  {
    name: 'Pardubice',
    latitude: 50.0343,
    longitude: 15.7812,
    tier: 'regional',
    dx: 9,
    dy: 13,
  },
  {
    name: 'Jihlava',
    latitude: 49.3961,
    longitude: 15.5912,
    tier: 'regional',
    dx: -9,
    dy: -7,
  },
  {
    name: 'Č. Budějovice',
    latitude: 48.9745,
    longitude: 14.4743,
    tier: 'regional',
    dx: 9,
    dy: 13,
  },
  {
    name: 'Karlovy Vary',
    latitude: 50.2319,
    longitude: 12.871,
    tier: 'regional',
    dx: 9,
    dy: -7,
  },
  {
    name: 'Olomouc',
    latitude: 49.5938,
    longitude: 17.2509,
    tier: 'regional',
    dx: 9,
    dy: -7,
  },
  {
    name: 'Zlín',
    latitude: 49.2244,
    longitude: 17.6628,
    tier: 'regional',
    dx: 9,
    dy: 13,
  },
  {
    name: 'Kladno',
    latitude: 50.1473,
    longitude: 14.1029,
    tier: 'district',
    dx: -7,
    dy: -6,
  },
  {
    name: 'Mladá Boleslav',
    latitude: 50.4114,
    longitude: 14.9032,
    tier: 'district',
    dx: 7,
    dy: -6,
  },
  {
    name: 'Česká Lípa',
    latitude: 50.6855,
    longitude: 14.5376,
    tier: 'district',
    dx: 7,
    dy: 11,
  },
  {
    name: 'Most',
    latitude: 50.503,
    longitude: 13.6362,
    tier: 'district',
    dx: -7,
    dy: -6,
  },
  {
    name: 'Chomutov',
    latitude: 50.4605,
    longitude: 13.4178,
    tier: 'district',
    dx: -7,
    dy: 11,
  },
  {
    name: 'Děčín',
    latitude: 50.7726,
    longitude: 14.2128,
    tier: 'district',
    dx: 7,
    dy: -6,
  },
  {
    name: 'Trutnov',
    latitude: 50.561,
    longitude: 15.9127,
    tier: 'district',
    dx: 7,
    dy: -6,
  },
  {
    name: 'Kolín',
    latitude: 50.0281,
    longitude: 15.2006,
    tier: 'district',
    dx: 7,
    dy: 11,
  },
  {
    name: 'Tábor',
    latitude: 49.4144,
    longitude: 14.6578,
    tier: 'district',
    dx: 7,
    dy: -6,
  },
  {
    name: 'Písek',
    latitude: 49.3088,
    longitude: 14.1475,
    tier: 'district',
    dx: -7,
    dy: 11,
  },
  {
    name: 'Třebíč',
    latitude: 49.2149,
    longitude: 15.8817,
    tier: 'district',
    dx: 7,
    dy: 11,
  },
  {
    name: 'Znojmo',
    latitude: 48.8555,
    longitude: 16.0488,
    tier: 'district',
    dx: -7,
    dy: -6,
  },
  {
    name: 'Břeclav',
    latitude: 48.7589,
    longitude: 16.882,
    tier: 'district',
    dx: 7,
    dy: 11,
  },
  {
    name: 'Přerov',
    latitude: 49.4551,
    longitude: 17.4509,
    tier: 'district',
    dx: 7,
    dy: 11,
  },
  {
    name: 'Opava',
    latitude: 49.9387,
    longitude: 17.9026,
    tier: 'district',
    dx: -7,
    dy: -6,
  },
  {
    name: 'Frýdek-Místek',
    latitude: 49.6819,
    longitude: 18.3673,
    tier: 'district',
    dx: -7,
    dy: 11,
  },
]

const SURROUNDING_CITIES: MapCity[] = [
  {
    name: 'Drážďany',
    latitude: 51.0504,
    longitude: 13.7373,
    tier: 'regional',
    dx: 7,
    dy: 11,
  },
  {
    name: 'Norimberk',
    latitude: 49.4521,
    longitude: 11.0767,
    tier: 'regional',
    dx: 7,
    dy: -6,
  },
  {
    name: 'Řezno',
    latitude: 49.0134,
    longitude: 12.0956,
    tier: 'district',
    dx: 7,
    dy: -6,
  },
  {
    name: 'Linec',
    latitude: 48.3069,
    longitude: 14.2858,
    tier: 'regional',
    dx: 7,
    dy: -6,
  },
  {
    name: 'Vídeň',
    latitude: 48.2082,
    longitude: 16.3738,
    tier: 'regional',
    dx: 7,
    dy: -6,
  },
  {
    name: 'Bratislava',
    latitude: 48.1486,
    longitude: 17.1077,
    tier: 'regional',
    dx: 7,
    dy: 11,
  },
  {
    name: 'Žilina',
    latitude: 49.2231,
    longitude: 18.7394,
    tier: 'regional',
    dx: -7,
    dy: 11,
  },
  {
    name: 'Vratislav',
    latitude: 51.1079,
    longitude: 17.0385,
    tier: 'regional',
    dx: 7,
    dy: 11,
  },
  {
    name: 'Katovice',
    latitude: 50.2649,
    longitude: 19.0238,
    tier: 'regional',
    dx: -7,
    dy: -6,
  },
  {
    name: 'Krakov',
    latitude: 50.0647,
    longitude: 19.945,
    tier: 'regional',
    dx: -7,
    dy: 11,
  },
]

const projectedBoundary = boundary.map(([longitude, latitude]) => ({
  rawX: longitude * LONGITUDE_SCALE,
  rawY: latitude,
}))

const rawMinimumX = Math.min(...projectedBoundary.map((point) => point.rawX))
const rawMaximumX = Math.max(...projectedBoundary.map((point) => point.rawX))
const rawMinimumY = Math.min(...projectedBoundary.map((point) => point.rawY))
const rawMaximumY = Math.max(...projectedBoundary.map((point) => point.rawY))
const mapScale = Math.min(
  (MAP_WIDTH - MAP_PADDING * 2) / (rawMaximumX - rawMinimumX),
  (MAP_HEIGHT - MAP_PADDING * 2) / (rawMaximumY - rawMinimumY)
)
const projectedWidth = (rawMaximumX - rawMinimumX) * mapScale
const projectedHeight = (rawMaximumY - rawMinimumY) * mapScale
const projectedOffsetX = (MAP_WIDTH - projectedWidth) / 2
const projectedOffsetY = (MAP_HEIGHT - projectedHeight) / 2

function projectCoordinate(
  longitude: number,
  latitude: number
): ProjectedPoint {
  return {
    x:
      projectedOffsetX +
      (longitude * LONGITUDE_SCALE - rawMinimumX) * mapScale,
    y:
      projectedOffsetY +
      (rawMaximumY - latitude) * mapScale,
  }
}

function pathFromCoordinates(coordinates: Coordinate[], close = false) {
  const points = coordinates.map(([longitude, latitude]) =>
    projectCoordinate(longitude, latitude)
  )

  if (points.length === 0) return ''

  return `${points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')}${close ? ' Z' : ''}`
}

const boundaryPath = pathFromCoordinates(boundary, true)
const surroundingCountryPaths = surroundingCountries.flatMap((country) =>
  country.polygons.map((polygon, index) => ({
    key: `${country.code}-${index}`,
    path: pathFromCoordinates(polygon, true),
  }))
)
const czechRegionPaths = czechRegions.flatMap((region) =>
  region.polygons.map((polygon, index) => ({
    key: `${region.name}-${index}`,
    path: pathFromCoordinates(polygon, true),
  }))
)
const motorwayPaths = motorways.map((coordinates, index) => ({
  key: `motorway-${index}`,
  path: pathFromCoordinates(coordinates),
}))
const primaryRoadPaths = primaryRoads.map((coordinates, index) => ({
  key: `primary-road-${index}`,
  path: pathFromCoordinates(coordinates),
}))

function positionMapJobs(jobs: FinanceStatisticsMapJob[]) {
  const jobsByLocation = new Map<string, FinanceStatisticsMapJob[]>()

  for (const job of jobs) {
    const key = `${job.latitude.toFixed(4)}:${job.longitude.toFixed(4)}`
    const locationJobs = jobsByLocation.get(key) ?? []
    locationJobs.push(job)
    jobsByLocation.set(key, locationJobs)
  }

  return Array.from(jobsByLocation.values()).flatMap((locationJobs) =>
    locationJobs.map((job, index) => {
      const point = projectCoordinate(job.longitude, job.latitude)

      if (locationJobs.length === 1) {
        return { ...job, ...point, offsetX: 0, offsetY: 0 }
      }

      const ring = Math.floor(index / 10)
      const radius = 8 + ring * 6
      const angle = index * 2.399963229728653

      return {
        ...job,
        ...point,
        offsetX: Math.cos(angle) * radius,
        offsetY: Math.sin(angle) * radius,
      }
    })
  )
}

function formatMapJobDate(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Prague',
  }).format(new Date(value))
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function clampMapPan(pan: MapPan, zoom: number): MapPan {
  if (zoom <= MIN_ZOOM) {
    return { x: 0, y: 0 }
  }

  const maximumX = (zoom - 1) * (MAP_WIDTH / 2 - MAP_PADDING)
  const maximumY = (zoom - 1) * (MAP_HEIGHT / 2 - MAP_PADDING)

  return {
    x: clamp(pan.x, -maximumX, maximumX),
    y: clamp(pan.y, -maximumY, maximumY),
  }
}

function transformMapPoint(
  point: ProjectedPoint,
  zoom: number,
  pan: MapPan
) {
  return {
    x: MAP_CENTER.x + pan.x + (point.x - MAP_CENTER.x) * zoom,
    y: MAP_CENTER.y + pan.y + (point.y - MAP_CENTER.y) * zoom,
  }
}

export function StatisticsMap({
  jobs,
}: {
  jobs: FinanceStatisticsMapJob[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<MapDragState | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [pan, setPan] = useState<MapPan>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const positionedJobs = useMemo(() => positionMapJobs(jobs), [jobs])

  function clientPointToSvg(clientX: number, clientY: number) {
    const svg = svgRef.current
    const screenMatrix = svg?.getScreenCTM()

    if (!svg || !screenMatrix) return null

    const point = svg.createSVGPoint()
    point.x = clientX
    point.y = clientY
    const transformed = point.matrixTransform(screenMatrix.inverse())

    return { x: transformed.x, y: transformed.y }
  }

  function svgPointToContainer(point: ProjectedPoint) {
    const svg = svgRef.current
    const containerBounds = containerRef.current?.getBoundingClientRect()
    const screenMatrix = svg?.getScreenCTM()

    if (!svg || !containerBounds || !screenMatrix) return null

    const svgPoint = svg.createSVGPoint()
    svgPoint.x = point.x
    svgPoint.y = point.y
    const screenPoint = svgPoint.matrixTransform(screenMatrix)

    return {
      x: screenPoint.x - containerBounds.left,
      y: screenPoint.y - containerBounds.top,
      width: containerBounds.width,
    }
  }

  function changeZoom(direction: 1 | -1) {
    const nextZoom = clamp(
      zoom + direction * ZOOM_STEP,
      MIN_ZOOM,
      MAX_ZOOM
    )

    if (nextZoom === zoom) return

    setZoom(nextZoom)
    setPan((currentPan) => clampMapPan(currentPan, nextZoom))
    setTooltip(null)
  }

  function resetMapView() {
    setZoom(MIN_ZOOM)
    setPan({ x: 0, y: 0 })
    setTooltip(null)
  }

  function handleMapPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (zoom <= MIN_ZOOM || event.button !== 0) return

    const startPoint = clientPointToSvg(event.clientX, event.clientY)

    if (!startPoint) return

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startPoint,
      startPan: pan,
    }
    setIsDragging(true)
    setTooltip(null)
  }

  function handleMapPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current

    if (!drag || drag.pointerId !== event.pointerId) return

    const currentPoint = clientPointToSvg(event.clientX, event.clientY)

    if (!currentPoint) return

    setPan(
      clampMapPan(
        {
          x: drag.startPan.x + currentPoint.x - drag.startPoint.x,
          y: drag.startPan.y + currentPoint.y - drag.startPoint.y,
        },
        zoom
      )
    )
  }

  function finishMapDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    dragRef.current = null
    setIsDragging(false)
  }

  function showTooltipFromPointer(
    job: PositionedMapJob,
    clientX: number,
    clientY: number
  ) {
    const bounds = containerRef.current?.getBoundingClientRect()

    if (!bounds) return

    const relativeX = clientX - bounds.left

    setTooltip({
      job,
      x: Math.max(105, Math.min(relativeX, bounds.width - 105)),
      y: clientY - bounds.top,
    })
  }

  function showTooltipAtPin(job: PositionedMapJob) {
    const pinPoint = transformMapPoint(
      {
        x: job.x + job.offsetX / zoom,
        y: job.y + job.offsetY / zoom,
      },
      zoom,
      pan
    )
    const pointInContainer = svgPointToContainer(pinPoint)

    if (!pointInContainer) return

    setTooltip({
      job,
      x: Math.max(
        105,
        Math.min(pointInContainer.x, pointInContainer.width - 105)
      ),
      y: pointInContainer.y,
    })
  }

  const cameraTransform = `translate(${MAP_CENTER.x + pan.x} ${MAP_CENTER.y + pan.y}) scale(${zoom}) translate(${-MAP_CENTER.x} ${-MAP_CENTER.y})`
  const inverseZoom = 1 / zoom
  const zoomProgress = (zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)
  const districtCityOpacity = 0.3 + zoomProgress * 0.58
  const primaryRoadOpacity = 0.34 + zoomProgress * 0.12
  const motorwayOpacity = 0.48 + zoomProgress * 0.08
  const regionOpacity = 0.16 + zoomProgress * 0.16
  const isViewChanged =
    zoom !== MIN_ZOOM || Math.abs(pan.x) > 0.1 || Math.abs(pan.y) > 0.1

  return (
    <section className="min-w-0 rounded-[24px] border border-white/80 bg-white/72 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_28px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.15)] [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.88)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_14px_30px_rgba(0,0,0,0.24)]">
      <h3 className="px-1 pb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
        Mapa
      </h3>

      <div
        ref={containerRef}
        className={`relative h-[280px] min-w-0 select-none overflow-hidden rounded-2xl border border-zinc-200/70 bg-[radial-gradient(circle_at_48%_48%,rgba(255,255,255,0.96)_0%,rgba(239,246,251,0.82)_58%,rgba(226,237,245,0.72)_100%)] sm:h-[340px] lg:h-[400px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.11)] [html[data-theme='dark']_&]:bg-[radial-gradient(circle_at_48%_48%,rgba(18,32,51,0.96)_0%,rgba(8,18,32,0.94)_66%,rgba(5,12,23,0.98)_100%)] ${
          zoom > MIN_ZOOM
            ? isDragging
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : 'cursor-default'
        }`}
        onPointerLeave={() => setTooltip(null)}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full"
          style={{ touchAction: zoom > MIN_ZOOM ? 'none' : 'pan-y' }}
          role="img"
          aria-label={`Mapa realizací se ${positionedJobs.length} zakázkami`}
          onPointerDown={handleMapPointerDown}
          onPointerMove={handleMapPointerMove}
          onPointerUp={finishMapDrag}
          onPointerCancel={finishMapDrag}
        >
          <defs>
            <linearGradient
              id="statistics-map-surface"
              x1="0"
              y1="0"
              x2="1"
              y2="1"
            >
              <stop offset="0%" stopColor="#f8fcff" stopOpacity="0.96" />
              <stop offset="50%" stopColor="#dcecf6" stopOpacity="0.72" />
              <stop offset="100%" stopColor="#bfd8e8" stopOpacity="0.58" />
            </linearGradient>
            <filter
              id="statistics-map-pin-shadow"
              x="-60%"
              y="-60%"
              width="220%"
              height="240%"
            >
              <feDropShadow
                dx="0"
                dy="2"
                stdDeviation="2"
                floodColor="#0f172a"
                floodOpacity="0.28"
              />
            </filter>
            <filter
              id="statistics-map-outline-glow"
              x="-15%"
              y="-20%"
              width="130%"
              height="140%"
            >
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <g transform={cameraTransform}>
            <g
              className="fill-[#dbe7ee]/42 stroke-[#91a8b7]/42 [html[data-theme='dark']_&]:fill-[#0a1727]/72 [html[data-theme='dark']_&]:stroke-[#4c6b80]/42"
              strokeWidth="1"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            >
              {surroundingCountryPaths.map((country) => (
                <path
                  key={country.key}
                  d={country.path}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>

            <g style={{ opacity: 0.22 + zoomProgress * 0.1 }}>
              {SURROUNDING_CITIES.map((city) => {
                const point = projectCoordinate(city.longitude, city.latitude)
                const textAnchor = (city.dx ?? 7) < 0 ? 'end' : 'start'

                return (
                  <g
                    key={city.name}
                    transform={`translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) scale(${inverseZoom})`}
                    className="fill-zinc-500 [html[data-theme='dark']_&]:fill-slate-400"
                  >
                    <circle cx="0" cy="0" r="1.4" fill="currentColor" />
                    <text
                      x={city.dx ?? 7}
                      y={city.dy ?? -6}
                      textAnchor={textAnchor}
                      className="text-[7px] font-medium tracking-[0.015em]"
                      fill="currentColor"
                    >
                      {city.name}
                    </text>
                  </g>
                )
              })}
            </g>

            <path
              d={boundaryPath}
              fill="url(#statistics-map-surface)"
              className="stroke-[#68a3ca] [html[data-theme='dark']_&]:fill-[#14263b] [html[data-theme='dark']_&]:stroke-[#4e8db7]"
              strokeWidth="2"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              filter="url(#statistics-map-outline-glow)"
            />

            <g
              style={{ opacity: regionOpacity }}
              className="fill-none stroke-[#527f9d] [html[data-theme='dark']_&]:stroke-[#73b5dc]"
              strokeWidth="0.85"
              strokeDasharray="3 3"
              strokeLinejoin="round"
            >
              {czechRegionPaths.map((region) => (
                <path
                  key={region.key}
                  d={region.path}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>

            <g
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <g
                style={{ opacity: primaryRoadOpacity }}
                className="stroke-[#6f8fa3] [html[data-theme='dark']_&]:stroke-[#7299b1]"
                strokeWidth="0.8"
              >
                {primaryRoadPaths.map((road) => (
                  <path
                    key={road.key}
                    d={road.path}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>

              <g style={{ opacity: motorwayOpacity }}>
                {motorwayPaths.map((road) => (
                  <g key={road.key}>
                    <path
                      d={road.path}
                      className="stroke-white/50 [html[data-theme='dark']_&]:stroke-[#071522]/65"
                      strokeWidth="2.7"
                      vectorEffect="non-scaling-stroke"
                    />
                    <path
                      d={road.path}
                      className="stroke-[#4d8fb9] [html[data-theme='dark']_&]:stroke-[#5eaedb]"
                      strokeWidth="1.25"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                ))}
              </g>
            </g>

            <g>
              {MAP_CITIES.map((city) => {
                const point = projectCoordinate(city.longitude, city.latitude)
                const textAnchor = (city.dx ?? 8) < 0 ? 'end' : 'start'
                const isRegional = city.tier === 'regional'

                return (
                  <g
                    key={city.name}
                    transform={`translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) scale(${inverseZoom})`}
                    style={{
                      opacity: isRegional ? 1 : districtCityOpacity,
                    }}
                    className={
                      isRegional
                        ? 'fill-zinc-500/58 [html[data-theme=\'dark\']_&]:fill-slate-300/54'
                        : 'fill-zinc-500/40 [html[data-theme=\'dark\']_&]:fill-slate-400/34'
                    }
                  >
                    {isRegional ? (
                      <circle
                        cx="0"
                        cy="0"
                        r="5"
                        className="fill-none stroke-[#4f9dcb]/28 [html[data-theme='dark']_&]:stroke-[#63bce9]/30"
                        strokeWidth="0.8"
                      />
                    ) : null}
                    <circle
                      cx="0"
                      cy="0"
                      r={isRegional ? 2.2 : 1.5}
                      fill="currentColor"
                    />
                    <text
                      x={city.dx ?? 8}
                      y={city.dy ?? -7}
                      textAnchor={textAnchor}
                      className={
                        isRegional
                          ? 'text-[9px] font-semibold tracking-[0.02em]'
                          : 'text-[7px] font-medium tracking-[0.015em]'
                      }
                      fill="currentColor"
                    >
                      {city.name}
                    </text>
                  </g>
                )
              })}
            </g>

            <g>
              {positionedJobs.map((job) => {
                const x = job.x + job.offsetX / zoom
                const y = job.y + job.offsetY / zoom

                return (
                  <g
                    key={job.id}
                    data-map-pin="true"
                    transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${inverseZoom})`}
                    className="group cursor-default outline-none"
                    role="button"
                    tabIndex={0}
                    aria-label={`${formatMapJobDate(job.startAt)}, ${job.companyName || 'Firma neuvedena'}`}
                    onPointerEnter={(event) =>
                      showTooltipFromPointer(job, event.clientX, event.clientY)
                    }
                    onPointerMove={(event) =>
                      showTooltipFromPointer(job, event.clientX, event.clientY)
                    }
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      showTooltipAtPin(job)
                    }}
                    onFocus={() => showTooltipAtPin(job)}
                    onBlur={() => setTooltip(null)}
                  >
                    <circle
                      cx="0"
                      cy="-8"
                      r="11"
                      className="fill-[#4aa7df]/16 opacity-70 transition duration-150 group-hover:fill-[#2996d5]/30 group-hover:opacity-100 [html[data-theme='dark']_&]:fill-[#65c7f7]/18 [html[data-theme='dark']_&]:group-hover:fill-[#76d0fb]/34"
                    />
                    <path
                      d="M 0 2 C -2 -1 -7 -6 -7 -11 A 7 7 0 1 1 7 -11 C 7 -6 2 -1 0 2 Z"
                      className="fill-[#2980B9] stroke-white transition-transform duration-150 [html[data-theme='dark']_&]:fill-[#58afe8] [html[data-theme='dark']_&]:stroke-[#d9f0ff]"
                      strokeWidth="1.8"
                      filter="url(#statistics-map-pin-shadow)"
                    />
                    <circle
                      cx="0"
                      cy="-11"
                      r="2.2"
                      className="fill-white [html[data-theme='dark']_&]:fill-[#0d2032]"
                    />
                  </g>
                )
              })}
            </g>
          </g>
        </svg>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[5] rounded-2xl shadow-[inset_0_0_34px_rgba(78,119,145,0.13)] [html[data-theme='dark']_&]:shadow-[inset_0_0_42px_rgba(1,7,16,0.42)]"
        />

        <div className="absolute right-2.5 top-2.5 z-20 grid overflow-hidden rounded-xl border border-white/80 bg-white/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_20px_rgba(15,23,42,0.13)] backdrop-blur-md [html[data-theme='dark']_&]:border-[rgba(112,190,236,0.24)] [html[data-theme='dark']_&]:bg-[rgba(8,20,35,0.78)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_22px_rgba(0,0,0,0.3)]">
          <button
            type="button"
            onClick={() => changeZoom(1)}
            onPointerDown={(event) => event.stopPropagation()}
            disabled={zoom >= MAX_ZOOM}
            className="inline-flex h-9 w-9 items-center justify-center border-b border-zinc-200/70 text-lg font-medium leading-none text-[#2d7eae] transition hover:bg-[#dff0fa]/80 hover:text-[#1e6795] disabled:cursor-default disabled:opacity-30 [html[data-theme='dark']_&]:border-[rgba(112,190,236,0.17)] [html[data-theme='dark']_&]:text-[#72c5f1] [html[data-theme='dark']_&:hover]:bg-[rgba(39,109,153,0.32)] [html[data-theme='dark']_&:hover]:text-[#a6ddfa]"
            aria-label="Přiblížit mapu"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => changeZoom(-1)}
            onPointerDown={(event) => event.stopPropagation()}
            disabled={zoom <= MIN_ZOOM}
            className={`inline-flex h-9 w-9 items-center justify-center text-lg font-medium leading-none text-[#2d7eae] transition hover:bg-[#dff0fa]/80 hover:text-[#1e6795] disabled:cursor-default disabled:opacity-30 [html[data-theme='dark']_&]:text-[#72c5f1] [html[data-theme='dark']_&:hover]:bg-[rgba(39,109,153,0.32)] [html[data-theme='dark']_&:hover]:text-[#a6ddfa] ${
              isViewChanged
                ? "border-b border-zinc-200/70 [html[data-theme='dark']_&]:border-[rgba(112,190,236,0.17)]"
                : ''
            }`}
            aria-label="Oddálit mapu"
          >
            −
          </button>
          {isViewChanged ? (
            <button
              type="button"
              onClick={resetMapView}
              onPointerDown={(event) => event.stopPropagation()}
              className="inline-flex h-9 w-9 items-center justify-center text-[15px] font-medium leading-none text-[#2d7eae] transition hover:bg-[#dff0fa]/80 hover:text-[#1e6795] [html[data-theme='dark']_&]:text-[#72c5f1] [html[data-theme='dark']_&:hover]:bg-[rgba(39,109,153,0.32)] [html[data-theme='dark']_&:hover]:text-[#a6ddfa]"
              aria-label="Obnovit výchozí pohled mapy"
              title="Výchozí pohled"
            >
              ⌖
            </button>
          ) : null}
        </div>

        {positionedJobs.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
            Pro vybrané období nejsou k dispozici rozpoznaná místa realizací.
          </div>
        ) : null}

        {tooltip ? (
          <div
            className="pointer-events-none absolute z-10 min-w-[180px] max-w-[260px] -translate-x-1/2 -translate-y-[calc(100%+18px)] rounded-xl border border-white/90 bg-white/96 px-3 py-2 text-left shadow-[0_12px_28px_rgba(15,23,42,0.2)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.2)] [html[data-theme='dark']_&]:bg-[rgba(9,18,31,0.97)] [html[data-theme='dark']_&]:shadow-[0_14px_30px_rgba(0,0,0,0.42)]"
            style={{
              left: tooltip.x,
              top: Math.max(70, tooltip.y),
            }}
            role="tooltip"
          >
            <div className="text-[10px] font-semibold text-[#2877aa] [html[data-theme='dark']_&]:text-[#67b8ed]">
              {formatMapJobDate(tooltip.job.startAt)}
            </div>
            <div className="mt-0.5 text-xs font-semibold leading-5 text-zinc-900 [html[data-theme='dark']_&]:text-slate-100">
              {tooltip.job.companyName || 'Firma neuvedena'}
            </div>
          </div>
        ) : null}

        <a
          href="https://www.geonames.org/"
          target="_blank"
          rel="noreferrer"
          className="absolute bottom-1.5 right-2 z-20 text-[8px] text-zinc-400/75 transition hover:text-zinc-600 [html[data-theme='dark']_&]:text-slate-500/75 [html[data-theme='dark']_&:hover]:text-slate-300"
        >
          Lokality: GeoNames
        </a>
      </div>
    </section>
  )
}
