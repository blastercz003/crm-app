import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const inputPath = process.argv[2]
const outputPath = process.argv[3] ?? 'src/lib/weather-alerts/orp-map.json'

if (!inputPath) {
  throw new Error('Usage: node scripts/generate-weather-orp-map.mjs <source.geojson> [output.json]')
}

const source = JSON.parse(await readFile(inputPath, 'utf8'))
const width = 960
const height = 560
const padding = 10
const longitudeScale = Math.cos((49.8 * Math.PI) / 180)

function visitCoordinates(value, visitor) {
  if (typeof value?.[0] === 'number') {
    visitor(value)
    return
  }
  for (const child of value ?? []) visitCoordinates(child, visitor)
}

const extent = {
  minX: Number.POSITIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
  maxX: Number.NEGATIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY,
}

for (const feature of source.features) {
  visitCoordinates(feature.geometry.coordinates, ([longitude, latitude]) => {
    const x = longitude * longitudeScale
    extent.minX = Math.min(extent.minX, x)
    extent.maxX = Math.max(extent.maxX, x)
    extent.minY = Math.min(extent.minY, latitude)
    extent.maxY = Math.max(extent.maxY, latitude)
  })
}

const scale = Math.min(
  (width - padding * 2) / (extent.maxX - extent.minX),
  (height - padding * 2) / (extent.maxY - extent.minY),
)
const contentWidth = (extent.maxX - extent.minX) * scale
const contentHeight = (extent.maxY - extent.minY) * scale
const offsetX = (width - contentWidth) / 2
const offsetY = (height - contentHeight) / 2

function project([longitude, latitude]) {
  return [
    offsetX + (longitude * longitudeScale - extent.minX) * scale,
    offsetY + (extent.maxY - latitude) * scale,
  ]
}

function squaredDistance(point, start, end) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  if (dx === 0 && dy === 0) {
    return (point[0] - start[0]) ** 2 + (point[1] - start[1]) ** 2
  }
  const ratio = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)),
  )
  const nearestX = start[0] + ratio * dx
  const nearestY = start[1] + ratio * dy
  return (point[0] - nearestX) ** 2 + (point[1] - nearestY) ** 2
}

function simplifyOpenLine(points, toleranceSquared) {
  if (points.length <= 2) return points
  let farthestIndex = 0
  let farthestDistance = 0
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = squaredDistance(points[index], points[0], points.at(-1))
    if (distance > farthestDistance) {
      farthestDistance = distance
      farthestIndex = index
    }
  }
  if (farthestDistance <= toleranceSquared) return [points[0], points.at(-1)]
  const left = simplifyOpenLine(points.slice(0, farthestIndex + 1), toleranceSquared)
  const right = simplifyOpenLine(points.slice(farthestIndex), toleranceSquared)
  return [...left.slice(0, -1), ...right]
}

function simplifyRing(rawRing) {
  const projected = rawRing.map(project)
  if (projected.length <= 5) return projected
  const points = projected.slice(0, -1)
  let pivot = 0
  for (let index = 1; index < points.length; index += 1) {
    if (points[index][0] < points[pivot][0]) pivot = index
  }
  const rotated = [...points.slice(pivot), ...points.slice(0, pivot), points[pivot]]
  const simplified = simplifyOpenLine(rotated, 0.48 ** 2)
  return simplified.length >= 4 ? simplified : rotated
}

function formatNumber(value) {
  return Number(value.toFixed(1)).toString()
}

function ringToPath(ring) {
  const points = simplifyRing(ring)
  return `${points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${formatNumber(x)} ${formatNumber(y)}`).join('')}Z`
}

function geometryToPath(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  return polygons.flatMap((polygon) => polygon.map(ringToPath)).join('')
}

const output = {
  source: {
    provider: 'Český statistický úřad',
    layer: 'Obce s rozšířenou působností (multi)',
    serviceUrl: 'https://geodata.csu.gov.cz/server/rest/services/Hosted/Open_data_RSO/FeatureServer/38',
  },
  viewBox: [0, 0, width, height],
  areas: source.features
    .map((feature) => ({
      code: String(feature.properties.kod_orp),
      name: String(feature.properties.naz_orp),
      path: geometryToPath(feature.geometry),
    }))
    .sort((left, right) => left.code.localeCompare(right.code, 'cs')),
}

await writeFile(path.resolve(outputPath), `${JSON.stringify(output)}\n`)
console.log(`Generated ${output.areas.length} ORP areas in ${outputPath}`)
