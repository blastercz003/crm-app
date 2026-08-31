import { createDecipheriv, pbkdf2Sync, timingSafeEqual } from "node:crypto"
import { Buffer } from "node:buffer"

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (request: Request) => Response | Promise<Response>): void
}

const EGD_PAGE_URL = "https://www.egd.cz/odstavky-elektrina"
const EGD_API_ORIGIN = "https://api.egd.cz"
const EGD_CONFIG_PASSWORD = "sdkaM87sZaLNQCpM"

// Veřejná runtime konfigurace stránky EG.D. Fallback umožní ověřit API i v
// případě, že WAF odmítne samotné HTML. Nejde o přihlašovací údaje uživatele.
const EGD_FALLBACK_API_URL_ENCRYPTED =
  "kbWiCdDEsscQjA846IB+i4uREhhXplGAqdBvcFGfD8A="
const EGD_FALLBACK_API_TOKEN_ENCRYPTED =
  "UfzeedON5iYaplMVa6EsK7StcLnqHMPa2faF4e/Gids="

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"

const PAGE_HEADERS = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif," +
    "image/webp,*/*;q=0.8",
  "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
  "Cache-Control": "no-cache",
  "User-Agent": BROWSER_USER_AGENT,
}

const API_HEADERS = {
  Accept: "application/json",
  "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
  "Content-Type": "application/json",
  Origin: "https://www.egd.cz",
  Referer: `${EGD_PAGE_URL}/`,
  "User-Agent": BROWSER_USER_AGENT,
  "Sec-CH-UA":
    '"Not)A;Brand";v="8", "Chromium";v="140", "Google Chrome";v="140"',
  "Sec-CH-UA-Mobile": "?0",
  "Sec-CH-UA-Platform": '"macOS"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
  Priority: "u=1, i",
}

type JsonRecord = Record<string, unknown>

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

function sourceJsonResponse(body: unknown, status = 200) {
  // Kompresi necháváme na HTTP gatewayi. Ruční CompressionStream nad zhruba
  // osmimetabajtovým payloadem spotřebovával zbytečně CPU Edge workeru.
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

function safeTokenEquals(provided: string, expected: string) {
  const providedBytes = new TextEncoder().encode(provided)
  const expectedBytes = new TextEncoder().encode(expected)
  return providedBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(providedBytes, expectedBytes)
}

function isAuthorized(request: Request) {
  const expected = Deno.env.get("POWER_OUTAGES_PROBE_TOKEN")?.trim() ?? ""
  if (!expected) return false

  const authorization = request.headers.get("authorization") ?? ""
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : ""

  return Boolean(provided) && safeTokenEquals(provided, expected)
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const startedAt = performance.now()
  const response = await fetch(url, {
    ...init,
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  return {
    response,
    text,
    durationMs: Math.round(performance.now() - startedAt),
  }
}

function decryptRuntimeValue(value: string) {
  const derived = pbkdf2Sync(EGD_CONFIG_PASSWORD, "", 5_000, 32, "md5")
  const decipher = createDecipheriv(
    "aes-128-cbc",
    derived.subarray(0, 16),
    derived.subarray(16, 32),
  )
  return Buffer.concat([
    decipher.update(Buffer.from(value, "base64")),
    decipher.final(),
  ]).toString("utf8")
}

function createValidatedEndpoint(encryptedUrl: string, encryptedToken: string) {
  const apiBase = decryptRuntimeValue(encryptedUrl)
  const apiToken = decryptRuntimeValue(encryptedToken)
  const endpoint = new URL(`${apiBase}${apiToken}`)

  if (endpoint.origin !== EGD_API_ORIGIN) {
    throw new Error("Runtime konfigurace odkazuje na neočekávaný server.")
  }
  if (!endpoint.pathname.startsWith("/blackout/")) {
    throw new Error("Runtime konfigurace obsahuje neočekávanou cestu API.")
  }

  return endpoint.toString()
}

function runtimeConfigFromHtml(html: string) {
  const scriptPattern =
    /<script[^>]+data-drupal-selector=["']drupal-settings-json["'][^>]*>([\s\S]*?)<\/script>/i
  const match = html.match(scriptPattern)
  if (!match?.[1]) {
    throw new Error("HTML neobsahuje očekávanou runtime konfiguraci.")
  }

  const parsed = JSON.parse(match[1]) as JsonRecord
  const eon = parsed.eon as JsonRecord | undefined
  const blackout = eon?.BLACKOUT as JsonRecord | undefined
  const encryptedUrl = blackout?.api_url
  const encryptedToken = blackout?.api_token
  if (typeof encryptedUrl !== "string" || typeof encryptedToken !== "string") {
    throw new Error("Runtime konfigurace EG.D není kompletní.")
  }

  return createValidatedEndpoint(encryptedUrl, encryptedToken)
}

function gqlName(value: string): JsonRecord {
  return { kind: "Name", value }
}

function gqlField(name: string, children?: JsonRecord[]): JsonRecord {
  return {
    kind: "Field",
    name: gqlName(name),
    arguments: [],
    directives: [],
    ...(children
      ? { selectionSet: { kind: "SelectionSet", selections: children } }
      : {}),
  }
}

function gqlFragmentSpread(name: string): JsonRecord {
  return {
    kind: "FragmentSpread",
    name: gqlName(name),
    directives: [],
  }
}

function gqlFragmentDefinition(
  name: string,
  typeName: string,
  fields: JsonRecord[],
): JsonRecord {
  return {
    kind: "FragmentDefinition",
    name: gqlName(name),
    typeCondition: { kind: "NamedType", name: gqlName(typeName) },
    directives: [],
    selectionSet: { kind: "SelectionSet", selections: fields },
  }
}

function buildQueryDocument(): JsonRecord {
  return {
    kind: "Document",
    definitions: [{
      kind: "OperationDefinition",
      operation: "query",
      name: gqlName("filterOutages"),
      variableDefinitions: [{
        kind: "VariableDefinition",
        variable: { kind: "Variable", name: gqlName("filter") },
        type: {
          kind: "NonNullType",
          type: { kind: "NamedType", name: gqlName("OdstavkyFilter") },
        },
        directives: [],
      }],
      directives: [],
      selectionSet: {
        kind: "SelectionSet",
        selections: [{
          ...gqlField("odstavky", [{
            ...gqlField("list", [gqlField("data", [
              gqlFragmentSpread("ExtendedOutageInfo"),
              gqlField("terminy", [
                gqlFragmentSpread("BasicTermInfo"),
                gqlFragmentSpread("TermStateInfo"),
              ]),
              gqlField("adresy", [
                gqlFragmentSpread("AddressFields"),
                gqlFragmentSpread("StreetLocation"),
              ]),
            ])]),
            arguments: [{
              kind: "Argument",
              name: gqlName("filter"),
              value: { kind: "Variable", name: gqlName("filter") },
            }],
          }]),
        }],
      },
    },
    gqlFragmentDefinition("AddressFields", "OdstavkaAdresa", [
      gqlField("psc"),
      gqlField("obec"),
      gqlField("ulice"),
      gqlField("castObce"),
    ]),
    gqlFragmentDefinition("StreetLocation", "OdstavkaAdresa", [
      gqlField("stredUlice", [gqlField("sirka"), gqlField("delka")]),
    ]),
    gqlFragmentDefinition("BasicTermInfo", "OdstavkaTermin", [
      gqlField("datumOd"),
      gqlField("datumDo"),
    ]),
    gqlFragmentDefinition("TermStateInfo", "OdstavkaTermin", [
      gqlField("stav"),
    ]),
    gqlFragmentDefinition("ExtendedOutageInfo", "OdstavkaData", [
      gqlField("cislo"),
      gqlField("popis"),
      gqlField("stav"),
    ])],
    loc: { start: 0, end: 1205 },
  }
}

function formatDate(date: Date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  const day = String(date.getUTCDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function encodeQuery(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const base64 = btoa(binary)
  return [...new TextEncoder().encode(base64)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .split("")
    .reverse()
    .join("")
}

function unwrapApiPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    const first = value[0]
    const isGraphQlBatch = Boolean(
      first && typeof first === "object" &&
        ("data" in first || "errors" in first),
    )
    if (!isGraphQlBatch) return { odstavky: { list: { data: value } } }
  }

  const envelope = Array.isArray(value) ? value[0] : value
  if (!envelope || typeof envelope !== "object") return null

  const directData = (envelope as JsonRecord).data
  if (directData && typeof directData === "object" && "odstavky" in directData) {
    return directData
  }

  const graphQlErrors = (envelope as JsonRecord).errors
  if (Array.isArray(graphQlErrors) && graphQlErrors.length > 0) return null

  const outerData = directData as JsonRecord | undefined
  const processed = outerData?.processEncodedQuery
  if (processed == null) return null

  const decoded = typeof processed === "string"
    ? JSON.parse(processed)
    : processed
  return Array.isArray(decoded)
    ? { odstavky: { list: { data: decoded } } }
    : decoded
}

function outageCountFromPayload(value: unknown) {
  if (!value || typeof value !== "object") return null
  const outages = (value as JsonRecord).odstavky as JsonRecord | undefined
  const list = outages?.list as JsonRecord | undefined
  return Array.isArray(list?.data) ? list.data.length : null
}

function outagesFromPayload(value: unknown) {
  if (!value || typeof value !== "object") return null
  const outages = (value as JsonRecord).odstavky as JsonRecord | undefined
  const list = outages?.list as JsonRecord | undefined
  return Array.isArray(list?.data) ? list.data : null
}

function safeErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "Požadavek překročil časový limit."
  }
  return error instanceof Error ? error.message.slice(0, 500) : "Neznámá chyba."
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405)
  }
  if (!isAuthorized(request)) {
    return jsonResponse({ ok: false, error: "Unauthorized." }, 401)
  }

  let input: JsonRecord = {}
  try {
    const parsed = await request.json()
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      input = parsed as JsonRecord
    }
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON body." }, 400)
  }

  const sourceMode = input.mode === "source"
  const city = typeof input.city === "string"
    ? input.city.trim().replace(/\s+/g, " ")
    : ""
  if (city.length > 120) {
    return jsonResponse({ ok: false, error: "City is too long." }, 400)
  }
  const requestedDaysAhead = typeof input.daysAhead === "number"
    ? Math.round(input.daysAhead)
    : sourceMode ? 90 : 30
  const daysAhead = Math.min(90, Math.max(1, requestedDaysAhead))

  const testedAt = new Date().toISOString()
  const edgeRegion = Deno.env.get("SB_REGION") ?? null
  let endpoint: string
  let configSource: "live-html" | "built-in-fallback" = "built-in-fallback"
  let pageResult: JsonRecord = {}

  try {
    const page = await fetchWithTimeout(
      EGD_PAGE_URL,
      { method: "GET", headers: PAGE_HEADERS },
      20_000,
    )
    pageResult = {
      ok: page.response.ok,
      status: page.response.status,
      durationMs: page.durationMs,
      server: page.response.headers.get("server"),
      responseBytes: new TextEncoder().encode(page.text).byteLength,
    }
    if (!page.response.ok) {
      throw new Error(`Veřejná stránka EG.D odpověděla HTTP ${page.response.status}.`)
    }
    endpoint = runtimeConfigFromHtml(page.text)
    configSource = "live-html"
  } catch (error) {
    pageResult = {
      ...(pageResult ?? {}),
      ok: false,
      error: safeErrorMessage(error),
    }
    endpoint = createValidatedEndpoint(
      EGD_FALLBACK_API_URL_ENCRYPTED,
      EGD_FALLBACK_API_TOKEN_ENCRYPTED,
    )
  }

  const dateFrom = new Date()
  const dateTo = new Date(dateFrom)
  dateTo.setUTCDate(dateTo.getUTCDate() + daysAhead)
  const filter = {
    fulltext: { obec: city, psc: "", ean: "", cislo: "", ulice: "" },
    datumOd: formatDate(dateFrom),
    datumDo: formatDate(dateTo),
    platne: false,
  }
  const encodedQuery = encodeQuery({
    query: buildQueryDocument(),
    variables: { filter },
  })

  try {
    const api = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: API_HEADERS,
        body: JSON.stringify({
          operationName: "filterOutages",
          query:
            "query filterOutages($encodedQuery: String!) {\n" +
            "  processEncodedQuery(encodedQuery: $encodedQuery)\n}",
          variables: { encodedQuery },
        }),
      },
      40_000,
    )

    const responseBytes = new TextEncoder().encode(api.text).byteLength
    let validJson = false
    let outageCount: number | null = null
    let decodedPayloadBytes: number | null = null
    let decodedPayload: unknown = null
    try {
      decodedPayload = unwrapApiPayload(JSON.parse(api.text))
      outageCount = outageCountFromPayload(decodedPayload)
      decodedPayloadBytes = new TextEncoder()
        .encode(JSON.stringify(decodedPayload))
        .byteLength
      validJson = outageCount !== null
    } catch {
      validJson = false
    }

    const ok = api.response.ok && validJson
    if (ok && sourceMode) {
      const outages = outagesFromPayload(decodedPayload)
      if (!outages) {
        return jsonResponse({ ok: false, error: "Invalid EG.D payload." }, 502)
      }
      return sourceJsonResponse({
        ok: true,
        source: "egd",
        edgeRegion,
        configSource,
        queryScope: city || "whole-distribution-area",
        dateFrom: filter.datumOd,
        dateTo: filter.datumDo,
        outages,
      })
    }
    return jsonResponse({
      ok,
      testedAt,
      edgeRegion,
      configSource,
      page: pageResult,
      api: {
        status: api.response.status,
        durationMs: api.durationMs,
        server: api.response.headers.get("server"),
        contentType: api.response.headers.get("content-type"),
        responseBytes,
        decodedPayloadBytes,
        validJson,
        outageCount,
      },
    }, ok ? 200 : 502)
  } catch (error) {
    return jsonResponse({
      ok: false,
      testedAt,
      edgeRegion,
      configSource,
      page: pageResult,
      api: { error: safeErrorMessage(error) },
    }, 502)
  }
})
