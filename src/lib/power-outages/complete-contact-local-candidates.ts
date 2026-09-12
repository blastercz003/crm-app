const COMPANY_NAME_STOP_WORDS = new Set([
  'a', 'as', 'cz', 'czech', 'druzstvo', 'firma', 'group', 'holding', 'k', 'komanditni',
  'o', 'podnik', 'r', 's', 'se', 'spol', 'spolecnost', 'sro', 'statni', 'v', 'vos',
])

export function localWebsiteCandidates(companyName: string) {
  const tokens = companyName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
    .filter((token) => token.length >= 2 && !COMPANY_NAME_STOP_WORDS.has(token))
    .slice(0, 4)
  if (tokens.length === 0) return []
  const labels = [tokens.join(''), tokens.join('-')]
  if (tokens[0].length >= 4) labels.push(tokens[0])
  return [...new Set(labels)]
    .filter((label) => label.length >= 3 && label.length <= 63)
    .slice(0, 3)
    .map((label) => `https://${label}.cz`)
}
