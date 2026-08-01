'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export function OperationalProtocolPrintView({
  protocolId,
  fileName,
}: {
  protocolId: string
  fileName: string
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const hasOpenedPrintRef = useRef(false)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    document.title = fileName.replace(/\.pdf$/i, '') || 'Provozní protokol'
  }, [fileName])

  const openPrintDialog = useCallback(() => {
    const frameWindow = frameRef.current?.contentWindow
    if (!frameWindow) return

    try {
      frameWindow.focus()
      frameWindow.print()
    } catch {
      setIsReady(true)
    }
  }, [])

  function handleFrameLoad() {
    setIsReady(true)
    if (hasOpenedPrintRef.current) return
    hasOpenedPrintRef.current = true

    window.setTimeout(openPrintDialog, 350)
  }

  return (
    <main className="h-dvh w-full overflow-hidden bg-zinc-900">
      <iframe
        ref={frameRef}
        src={`/faktury/provozni-protokoly/${protocolId}/pdf`}
        title={fileName}
        onLoad={handleFrameLoad}
        className="h-full w-full border-0 bg-zinc-800"
      />

      <div className="fixed right-4 bottom-4 z-10 flex items-center gap-2 rounded-2xl border border-white/20 bg-zinc-950/86 p-2 shadow-2xl backdrop-blur-xl print:hidden">
        {!isReady ? (
          <span className="px-2 text-xs font-medium text-white/70">Načítám PDF…</span>
        ) : null}
        <button
          type="button"
          onClick={openPrintDialog}
          disabled={!isReady}
          className="h-10 rounded-xl bg-[#398bc2] px-4 text-xs font-semibold text-white transition hover:-translate-y-[1px] hover:bg-[#2f7eb4] disabled:cursor-wait disabled:opacity-50"
        >
          TISKNOUT
        </button>
        <button
          type="button"
          onClick={() => window.close()}
          className="h-10 rounded-xl border border-white/20 bg-white/10 px-4 text-xs font-semibold text-white transition hover:-translate-y-[1px] hover:bg-white/15"
        >
          ZAVŘÍT
        </button>
      </div>
    </main>
  )
}
