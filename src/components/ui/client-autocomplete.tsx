'use client'

import { Check, Search } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

export type ClientAutocompleteOption = {
  id: string
  name: string
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs-CZ')
    .trim()
}

export function ClientAutocomplete({
  id,
  clients,
  value,
  selectedClientId,
  onChange,
  inputClassName,
  placeholder = 'Začněte psát název klienta',
}: {
  id: string
  clients: ClientAutocompleteOption[]
  value: string
  selectedClientId: string
  onChange: (companyName: string, clientId: string) => void
  inputClassName: string
  placeholder?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState(value)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const selectedClient = clients.find((client) => client.id === selectedClientId) ?? null
  const selectionIsValid = Boolean(selectedClient) && value.trim() === selectedClient?.name
  const filteredClients = useMemo(() => {
    const normalizedFilter = normalizeSearchText(filter)
    if (!normalizedFilter) return clients.slice(0, 8)
    return clients
      .filter((client) => normalizeSearchText(client.name).includes(normalizedFilter))
      .sort((left, right) => {
        const leftStarts = normalizeSearchText(left.name).startsWith(normalizedFilter)
        const rightStarts = normalizeSearchText(right.name).startsWith(normalizedFilter)
        return Number(rightStarts) - Number(leftStarts) || left.name.localeCompare(right.name, 'cs')
      })
      .slice(0, 8)
  }, [clients, filter])

  function selectClient(client: ClientAutocompleteOption) {
    onChange(client.name, client.id)
    setFilter(client.name)
    setOpen(false)
    setActiveIndex(0)
  }

  function handleChange(nextValue: string) {
    setFilter(nextValue)
    setOpen(true)
    setActiveIndex(0)

    if (!nextValue) {
      onChange('', '')
      return
    }

    const normalizedValue = normalizeSearchText(nextValue)
    const exactMatch = clients.find((client) => normalizeSearchText(client.name) === normalizedValue)
    if (exactMatch) {
      onChange(exactMatch.name, exactMatch.id)
      return
    }

    const prefixMatch = clients.find((client) => normalizeSearchText(client.name).startsWith(normalizedValue))
    if (!prefixMatch) {
      onChange(nextValue, '')
      return
    }

    onChange(prefixMatch.name, prefixMatch.id)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(nextValue.length, prefixMatch.name.length)
    })
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => {
        if (!filteredClients.length) return 0
        const direction = event.key === 'ArrowDown' ? 1 : -1
        return (current + direction + filteredClients.length) % filteredClients.length
      })
      return
    }

    if (event.key === 'Enter' && open && filteredClients[activeIndex]) {
      event.preventDefault()
      selectClient(filteredClients[activeIndex])
    }
  }

  const suggestionsId = `${id}-suggestions`

  return (
    <div>
      <div className="relative">
        <Search aria-hidden size={15} className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-zinc-400" />
        <input
          ref={inputRef}
          id={id}
          name="company_name"
          type="text"
          role="combobox"
          aria-autocomplete="both"
          aria-expanded={open}
          aria-controls={suggestionsId}
          aria-activedescendant={open && filteredClients[activeIndex] ? `${id}-option-${filteredClients[activeIndex].id}` : undefined}
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          onChange={(event) => handleChange(event.target.value)}
          onFocus={() => {
            setFilter(value)
            setOpen(true)
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={handleKeyDown}
          className={`${inputClassName} pl-10 ${selectionIsValid ? 'pr-10' : ''}`}
        />
        {selectionIsValid ? <Check aria-label="Klient napojen" size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-emerald-600" /> : null}

        {open ? (
          <div id={suggestionsId} role="listbox" className="activities-modal__client-suggestions absolute inset-x-0 top-[calc(100%+0.4rem)] z-50 max-h-56 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1.5 shadow-[0_18px_40px_rgba(24,24,27,0.18)]">
            {filteredClients.length ? filteredClients.map((client, index) => (
              <button
                key={client.id}
                id={`${id}-option-${client.id}`}
                type="button"
                role="option"
                aria-selected={client.id === selectedClientId}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectClient(client)}
                className={`activities-modal__client-suggestion flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${index === activeIndex ? 'activities-modal__client-suggestion--active bg-sky-50 text-sky-800' : 'text-zinc-700 hover:bg-zinc-50'}`}
              >
                <span className="truncate">{client.name}</span>
                {client.id === selectedClientId ? <Check aria-hidden size={14} className="shrink-0" /> : null}
              </button>
            )) : <p className="px-3 py-2 text-sm text-zinc-500">Žádný klient nenalezen.</p>}
          </div>
        ) : null}
      </div>

      {selectionIsValid ? (
        <p className="client-autocomplete__status client-autocomplete__status--linked mt-1.5 flex items-center gap-1 text-[11px] font-medium text-emerald-700"><Check aria-hidden size={12} /> Napojeno na klienta</p>
      ) : value.trim() ? (
        <p className="client-autocomplete__status mt-1.5 text-[11px] text-zinc-500">Bez napojení na klienta</p>
      ) : (
        <p className="client-autocomplete__status mt-1.5 text-[11px] text-zinc-500">Klient je volitelný.</p>
      )}
    </div>
  )
}
