type ParsedCzechAccount = {
  prefix: string
  account: string
  bankCode: string
}

function onlyDigits(value: string) {
  return value.replace(/\D+/g, '')
}

function mod97(numeric: string) {
  let remainder = 0

  for (const char of numeric) {
    remainder = (remainder * 10 + Number(char)) % 97
  }

  return remainder
}

function lettersToDigits(value: string) {
  return value
    .toUpperCase()
    .split('')
    .map((char) => {
      const code = char.charCodeAt(0)
      if (code >= 65 && code <= 90) {
        return String(code - 55)
      }
      return char
    })
    .join('')
}

function parseCzechAccount(value: string) {
  const normalized = value.trim()
  const match = normalized.match(/^(?:(\d{1,6})-)?(\d{1,10})\/(\d{4})$/)

  if (!match) {
    return null
  }

  return {
    prefix: match[1] ?? '',
    account: match[2],
    bankCode: match[3],
  } satisfies ParsedCzechAccount
}

export function buildCzechIbanFromAccount(accountValue: string) {
  const parsed = parseCzechAccount(accountValue)

  if (!parsed) {
    return null
  }

  const bban = `${parsed.bankCode}${parsed.prefix.padStart(6, '0')}${parsed.account.padStart(10, '0')}`
  const countryDigits = lettersToDigits('CZ')
  const checksumBase = `${bban}${countryDigits}00`
  const checksum = 98 - mod97(checksumBase)

  return `CZ${String(checksum).padStart(2, '0')}${bban}`
}

export function normalizeIban(value: string | null | undefined) {
  const normalized = onlyDigits(String(value ?? '').toUpperCase()).trim()
  const raw = String(value ?? '').replace(/\s+/g, '').toUpperCase().trim()

  if (!raw) {
    return null
  }

  return /^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(raw) ? raw : normalized ? raw : null
}

export function buildNordFjellaSpdQrPayload(params: {
  accountNumber: string | null | undefined
  iban: string | null | undefined
  amount: number
  variableSymbol: string | null | undefined
  message: string | null | undefined
  recipientName: string | null | undefined
}) {
  const amount = Number(params.amount ?? 0)

  if (!Number.isFinite(amount) || amount <= 0) {
    return null
  }

  const iban = normalizeIban(params.iban) ?? buildCzechIbanFromAccount(String(params.accountNumber ?? ''))

  if (!iban) {
    return null
  }

  const parts = [
    'SPD*1.0',
    `ACC:${iban}`,
    `AM:${amount.toFixed(2)}`,
    'CC:CZK',
  ]

  const variableSymbol = onlyDigits(String(params.variableSymbol ?? ''))
  if (variableSymbol) {
    parts.push(`X-VS:${variableSymbol}`)
  }

  const message = String(params.message ?? '').trim()
  if (message) {
    parts.push(`MSG:${message.slice(0, 60)}`)
  }

  const recipientName = String(params.recipientName ?? '').trim()
  if (recipientName) {
    parts.push(`RN:${recipientName.slice(0, 35)}`)
  }

  return parts.join('*')
}
