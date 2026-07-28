import fs from 'node:fs/promises'
import path from 'node:path'

const geonamesPath = process.argv[2]
const countriesPath = process.argv[3]
const adminOnePath = process.argv[4]
const roadsPath = process.argv[5]
const outputDirectory = process.argv[6]

if (
  !geonamesPath ||
  !countriesPath ||
  !adminOnePath ||
  !roadsPath ||
  !outputDirectory
) {
  throw new Error(
    'Usage: node scripts/generate-czech-map-data.mjs <CZ.txt> <countries.geojson> <admin1.geojson> <roads.geojson> <output-directory>'
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

function closeRing(points) {
  if (points.length === 0) return points

  const first = points[0]
  const last = points[points.length - 1]

  if (first[0] === last[0] && first[1] === last[1]) {
    return points
  }

  return [...points, first]
}

function clipPolygonEdge(points, isInside, getIntersection) {
  if (points.length === 0) return points

  const output = []
  let previous = points[points.length - 1]
  let previousInside = isInside(previous)

  for (const current of points) {
    const currentInside = isInside(current)

    if (currentInside) {
      if (!previousInside) {
        output.push(getIntersection(previous, current))
      }
      output.push(current)
    } else if (previousInside) {
      output.push(getIntersection(previous, current))
    }

    previous = current
    previousInside = currentInside
  }

  return output
}

function clipPolygonToBounds(points, bounds) {
  const verticalIntersection = (longitude) => (start, end) => {
    const progress = (longitude - start[0]) / (end[0] - start[0])
    return [longitude, start[1] + (end[1] - start[1]) * progress]
  }
  const horizontalIntersection = (latitude) => (start, end) => {
    const progress = (latitude - start[1]) / (end[1] - start[1])
    return [start[0] + (end[0] - start[0]) * progress, latitude]
  }

  let clipped = points
  clipped = clipPolygonEdge(
    clipped,
    ([longitude]) => longitude >= bounds.minimumLongitude,
    verticalIntersection(bounds.minimumLongitude)
  )
  clipped = clipPolygonEdge(
    clipped,
    ([longitude]) => longitude <= bounds.maximumLongitude,
    verticalIntersection(bounds.maximumLongitude)
  )
  clipped = clipPolygonEdge(
    clipped,
    ([, latitude]) => latitude >= bounds.minimumLatitude,
    horizontalIntersection(bounds.minimumLatitude)
  )
  clipped = clipPolygonEdge(
    clipped,
    ([, latitude]) => latitude <= bounds.maximumLatitude,
    horizontalIntersection(bounds.maximumLatitude)
  )

  return closeRing(clipped)
}

function getExteriorRings(geometry) {
  if (geometry?.type === 'Polygon') {
    return geometry.coordinates[0] ? [geometry.coordinates[0]] : []
  }

  if (geometry?.type === 'MultiPolygon') {
    return geometry.coordinates
      .map((polygon) => polygon[0])
      .filter(Boolean)
  }

  return []
}

function getLineStrings(geometry) {
  if (geometry?.type === 'LineString') {
    return geometry.coordinates.length >= 2 ? [geometry.coordinates] : []
  }

  if (geometry?.type === 'MultiLineString') {
    return geometry.coordinates.filter((line) => line.length >= 2)
  }

  return []
}

function boundsIntersect(left, right) {
  return (
    left.maximumLongitude >= right.minimumLongitude &&
    left.minimumLongitude <= right.maximumLongitude &&
    left.maximumLatitude >= right.minimumLatitude &&
    left.minimumLatitude <= right.maximumLatitude
  )
}

function featureBounds(feature) {
  if (Array.isArray(feature.bbox) && feature.bbox.length >= 4) {
    return {
      minimumLongitude: feature.bbox[0],
      minimumLatitude: feature.bbox[1],
      maximumLongitude: feature.bbox[2],
      maximumLatitude: feature.bbox[3],
    }
  }

  const coordinates = getLineStrings(feature.geometry).flat()

  if (coordinates.length === 0) return null

  return {
    minimumLongitude: Math.min(
      ...coordinates.map(([longitude]) => longitude)
    ),
    minimumLatitude: Math.min(...coordinates.map(([, latitude]) => latitude)),
    maximumLongitude: Math.max(
      ...coordinates.map(([longitude]) => longitude)
    ),
    maximumLatitude: Math.max(...coordinates.map(([, latitude]) => latitude)),
  }
}

function roundCoordinates(points) {
  return points.map(([longitude, latitude]) => [
    Number(longitude.toFixed(5)),
    Number(latitude.toFixed(5)),
  ])
}

const [geonamesText, countriesText, adminOneText, roadsText] =
  await Promise.all([
  fs.readFile(geonamesPath, 'utf8'),
  fs.readFile(countriesPath, 'utf8'),
  fs.readFile(adminOnePath, 'utf8'),
    fs.readFile(roadsPath, 'utf8'),
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
const adminOne = JSON.parse(adminOneText)
const roads = JSON.parse(roadsText)
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
const czechBounds = {
  minimumLongitude: Math.min(...boundary.map(([longitude]) => longitude)),
  maximumLongitude: Math.max(...boundary.map(([longitude]) => longitude)),
  minimumLatitude: Math.min(...boundary.map(([, latitude]) => latitude)),
  maximumLatitude: Math.max(...boundary.map(([, latitude]) => latitude)),
}
const surroundingClipBounds = {
  minimumLongitude: czechBounds.minimumLongitude - 2.8,
  maximumLongitude: czechBounds.maximumLongitude + 2.8,
  minimumLatitude: czechBounds.minimumLatitude - 1.7,
  maximumLatitude: czechBounds.maximumLatitude + 1.7,
}
const roadClipBounds = {
  minimumLongitude: czechBounds.minimumLongitude - 2.1,
  maximumLongitude: czechBounds.maximumLongitude + 2.1,
  minimumLatitude: czechBounds.minimumLatitude - 1.2,
  maximumLatitude: czechBounds.maximumLatitude + 1.2,
}
const surroundingCountryCodes = new Set(['DEU', 'POL', 'SVK', 'AUT'])
const surroundingCountries = countries.features
  .filter((feature) =>
    surroundingCountryCodes.has(
      feature.properties?.ADM0_A3 ?? feature.properties?.ISO_A3
    )
  )
  .map((feature) => ({
    code: feature.properties?.ADM0_A3 ?? feature.properties?.ISO_A3,
    name: feature.properties?.ADMIN ?? '',
    polygons: getExteriorRings(feature.geometry)
      .map((ring) => clipPolygonToBounds(ring, surroundingClipBounds))
      .filter((ring) => ring.length >= 4)
      .map((ring) => roundCoordinates(simplify(ring, 0.014))),
  }))
  .filter((country) => country.polygons.length > 0)

const czechRegions = adminOne.features
  .filter(
    (feature) =>
      feature.properties?.adm0_a3 === 'CZE' ||
      feature.properties?.iso_a2 === 'CZ'
  )
  .map((feature) => ({
    name: feature.properties?.name ?? feature.properties?.name_en ?? '',
    polygons: getExteriorRings(feature.geometry)
      .map((ring) => roundCoordinates(simplify(ring, 0.005)))
      .filter((ring) => ring.length >= 4),
  }))
  .filter((region) => region.polygons.length > 0)

const roadLines = roads.features
  .filter((feature) => {
    const bounds = featureBounds(feature)
    return bounds ? boundsIntersect(bounds, roadClipBounds) : false
  })
  .flatMap((feature) => {
    const properties = feature.properties ?? {}
    const type = properties.type
    const scaleRank = Number(properties.scalerank)
    const isMotorway = Number(properties.expressway) === 1
    const isPrimaryRoad =
      !isMotorway &&
      ((type === 'Major Highway' && scaleRank <= 9) ||
        (type === 'Secondary Highway' && scaleRank <= 7) ||
        (type === 'Road' && scaleRank <= 6))

    if (!isMotorway && !isPrimaryRoad) return []

    return getLineStrings(feature.geometry).map((coordinates) => ({
      level: isMotorway ? 'motorway' : 'primary',
      coordinates: roundCoordinates(simplify(coordinates, 0.0035)),
    }))
  })
  .filter((road) => road.coordinates.length >= 2)

const motorwayRoads = roadLines
  .filter((road) => road.level === 'motorway')
  .map((road) => road.coordinates)
const primaryRoads = roadLines
  .filter((road) => road.level === 'primary')
  .map((road) => road.coordinates)

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
  surroundingCountries,
  czechRegions,
}

const roadsResult = {
  source: 'Natural Earth 1:10m Roads, public domain',
  motorways: motorwayRoads,
  primaryRoads,
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
  fs.writeFile(
    path.join(outputDirectory, 'map-roads.json'),
    `${JSON.stringify(roadsResult)}\n`,
    'utf8'
  ),
])
