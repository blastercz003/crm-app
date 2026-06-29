'use client'

import { useState } from 'react'
import { StoresImportModal } from './stores-import-modal'

export function StoresImportLauncher() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_22px_rgba(24,78,129,0.28)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.38),0_14px_28px_rgba(24,78,129,0.34)]"
      >
        IMPORT PRODEJEN
      </button>

      {isOpen ? (
        <StoresImportModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
      ) : null}
    </>
  )
}
