/**
 * Archived navigation loader used before the gooey blob animation.
 * Keep this component available for a possible visual rollback.
 */
export function LegacyNavigationDots() {
  return (
    <div className="navigation-overlay__dots flex items-center gap-3 rounded-full px-6 py-5">
      <LegacyLoadingDot delay="0ms" />
      <LegacyLoadingDot delay="140ms" />
      <LegacyLoadingDot delay="280ms" />
    </div>
  )
}

function LegacyLoadingDot({ delay }: { delay: string }) {
  return (
    <span
      className="navigation-overlay__dot h-4 w-4 rounded-full bg-[#2980B9] shadow-[0_0_18px_rgba(41,128,185,0.35)] opacity-25"
      style={{
        animation: 'navigation-loading-dot-pulse 1.1s ease-in-out infinite',
        animationDelay: delay,
      }}
    />
  )
}
