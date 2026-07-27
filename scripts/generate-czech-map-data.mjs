import fs from 'node:fs/promises'
import path from 'node:path'

const geonamesPath = process.argv[2]
const countriesPath = process.argv[3]
const outputDirectory = process.argv[4]

if (!geonamesPath || !countriesPath || !outputDirectory) {
  throw new Error(
    'Usage: node scripts/generate-czech-map-data.mjs <CZ.txt> <countries.geojson> <output-directory>'
  )
}

function normalizePlaceName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function squaredDistanceToSegment(point, start, end) {
  let x = start[0]
  let y = start[1]
  let dx = end[0] - x
  let dy = end[1] - y

  if (dx !== 0 || dy !== 0) {
    const progress =
      ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy)

    if (progress > 1) {
      x = end[0]
      y = end[1]
    } else if (progress > 0) {
      x += dx * progress
      y += dy * progress
    }
  }

  dx = point[0] - x
  dy = point[1] - y
  return dx * dx + dy * dy
}

function simplifySection(points, first, last, toleranceSquared, output) {
  let maximumDistance = toleranceSquared
  let splitIndex = 0

  for (let index = first + 1; index < last; index += 1) {
    const distance = squaredDistanceToSegment(
      points[index],
      points[first],
      points[last]
    )

    if (distance > maximumDistance) {
      splitIndex = index
      maximumDistance = distance
    }
  }

  if (maximumDistance > toleranceSquared) {
    if (splitIndex - first > 1) {
      simplifySection(points, first, splitIndex, toleranceSquared, output)
    }

    output.push(points[splitIndex])

    if (last - splitIndex > 1) {
      simplifySection(points, splitIndex, last, toleranceSquared, output)
    }
  }
}

function simplify(points, tolerance) {
  if (points.length <= 2) return points

  const output = [points[0]]
  simplifySection(points, 0, points.length - 1, tolerance * tolerance, output)
  output.push(points[points.length - 1])
  return output
}

const [geonamesText, countriesText] = await Promise.all([
  fs.readFile(geonamesPath, 'utf8'),
  fs.readFile(countriesPath, 'utf8'),
])

const placeByKey = new Map()

for (const line of geonamesText.split('\n')) {
  if (!line) continue

  const columns = line.split('\t')
  const featureClass = columns[6]

  if (featureClass !== 'P') continue

  const name = columns[1]
  const asciiName = columns[2]
  const latitude = Number(columns[4])
  const longitude = Number(columns[5])
  const population = Number(columns[14]) || 0

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue

  for (const candidateName of new Set([name, asciiName])) {
    const key = normalizePlaceName(candidateName)

    if (!key) continue

    const current = placeByKey.get(key)

    if (!current || population > current.population) {
      placeByKey.set(key, {
        name,
        latitude,
        longitude,
        population,
      })
    }
  }
}

const countries = JSON.parse(countriesText)
const czechia = countries.features.find(
  (feature) =>
    feature.properties?.ADM0_A3 === 'CZE' ||
    feature.properties?.ISO_A3 === 'CZE'
)

if (!czechia || czechia.geometry?.type !== 'Polygon') {
  throw new Error('Czechia polygon was not found in Natural Earth data.')
}

const boundary = simplify(czechia.geometry.coordinates[0], 0.006).map(
  ([longitude, latitude]) => [
    Number(longitude.toFixed(5)),
    Number(latitude.toFixed(5)),
  ]
)

const cities = Array.from(placeByKey.entries())
  .sort(([left], [right]) => left.localeCompare(right, 'en'))
  .map(([key, place]) => [
    key,
    place.name,
    Number(place.latitude.toFixed(5)),
    Number(place.longitude.toFixed(5)),
  ])

const cityResult = {
  source: 'GeoNames CZ dump, CC BY 4.0',
  cities,
}

const boundaryResult = {
  source: 'Natural Earth 1:10m Admin 0 Countries, public domain',
  boundary,
}

await fs.mkdir(outputDirectory, { recursive: true })
await Promise.all([
  fs.writeFile(
    path.join(outputDirectory, 'city-locations.json'),
    `${JSON.stringify(cityResult)}\n`,
    'utf8'
  ),
  fs.writeFile(
    path.join(outputDirectory, 'map-boundary.json'),
    `${JSON.stringify(boundaryResult)}\n`,
    'utf8'
  ),
])
