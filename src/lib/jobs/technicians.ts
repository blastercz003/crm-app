const DIACRITICS_REGEX = /[\u0300-\u036f]/g

export function normalizeTechnicianSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(DIACRITICS_REGEX, '')
    .trim()
    .toLocaleLowerCase('cs')
}

export function splitTechnicianInput(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export function joinTechnicianNames(values: string[]) {
  return values.join(', ')
}

export function resolveTechnicianName(
  input: string,
  technicianNames: string[]
) {
  const trimmedInput = input.trim()
  if (!trimmedInput) {
    return null
  }

  const normalizedInput = normalizeTechnicianSearchText(trimmedInput)
  const exactMatch =
    technicianNames.find(
      (name) => normalizeTechnicianSearchText(name) === normalizedInput
    ) ?? null

  if (exactMatch) {
    return exactMatch
  }

  if (normalizedInput.length < 3) {
    return null
  }

  const prefixMatches = technicianNames.filter((name) =>
    normalizeTechnicianSearchText(name).startsWith(normalizedInput)
  )

  return prefixMatches.length === 1 ? prefixMatches[0] : null
}

export function resolveTechnicianNames(
  rawValue: string,
  technicianNames: string[]
) {
  const enteredNames = splitTechnicianInput(rawValue)

  if (enteredNames.length === 0) {
    return {
      error: null,
      names: [] as string[],
    }
  }

  const resolvedNames: string[] = []
  const seenNormalized = new Set<string>()

  for (const enteredName of enteredNames) {
    const resolvedName = resolveTechnicianName(enteredName, technicianNames)

    if (!resolvedName) {
      return {
        error: `Technika „${enteredName}“ se nepodařilo ověřit v databázi.`,
        names: [] as string[],
      }
    }

    const normalizedResolvedName = normalizeTechnicianSearchText(resolvedName)

    if (seenNormalized.has(normalizedResolvedName)) {
      return {
        error: `Technik „${resolvedName}“ je v poli zadaný vícekrát.`,
        names: [] as string[],
      }
    }

    seenNormalized.add(normalizedResolvedName)
    resolvedNames.push(resolvedName)
  }

  return {
    error: null,
    names: resolvedNames,
  }
}

export function finalizeTechnicianInputValue(
  rawValue: string,
  technicianNames: string[]
) {
  const trimmedValue = rawValue.trim()

  if (!trimmedValue) {
    return {
      error: null,
      value: '',
    }
  }

  const resolution = resolveTechnicianNames(trimmedValue, technicianNames)

  if (resolution.error) {
    return {
      error: resolution.error,
      value: trimmedValue,
    }
  }

  return {
    error: null,
    value: joinTechnicianNames(resolution.names),
  }
}
