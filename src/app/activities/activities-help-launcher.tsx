'use client'

import { CircleHelp } from 'lucide-react'
import { useState } from 'react'
import { ActivitiesHelpModal } from './activities-help-modal'

export function ActivitiesHelpLauncher() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Otevřít nápovědu k Obchodní aktivitě"
          title="Nápověda"
          className="fixed bottom-[18px] right-[18px] z-[80] hidden h-[52px] w-[52px] items-center justify-center rounded-full border border-amber-400/90 bg-[linear-gradient(150deg,#fbc84f_0%,#f59e0b_100%)] text-amber-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.58),0_10px_24px_rgba(217,119,6,0.3)] transition-[transform,background,box-shadow,border-color] duration-200 ease-out hover:-translate-y-[3px] hover:border-amber-300 hover:bg-[linear-gradient(150deg,#ffd76a_0%,#f6a915_100%)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_16px_30px_rgba(217,119,6,0.4)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-500 active:translate-y-0 lg:inline-flex [html[data-theme=dark]_&]:border-amber-600/75 [html[data-theme=dark]_&]:bg-[linear-gradient(150deg,#b87516_0%,#8f4d0d_100%)] [html[data-theme=dark]_&]:text-amber-50 [html[data-theme=dark]_&]:shadow-[inset_0_1px_0_rgba(255,235,190,0.16),0_10px_25px_rgba(0,0,0,0.38)] [html[data-theme=dark]_&]:hover:border-amber-500/90 [html[data-theme=dark]_&]:hover:bg-[linear-gradient(150deg,#c9821c_0%,#a75b0f_100%)] [html[data-theme=dark]_&]:hover:shadow-[inset_0_1px_0_rgba(255,235,190,0.22),0_16px_30px_rgba(0,0,0,0.48)]"
        >
          <CircleHelp aria-hidden size={23} strokeWidth={2.35} />
        </button>
      ) : null}

      <ActivitiesHelpModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}
