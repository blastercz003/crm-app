export default function PasswordSettingsLoading() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)]">
      <div className="absolute inset-0 bg-white/18 backdrop-blur-[6px]" />

      <div className="relative flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 rounded-full px-6 py-5">
          <LoadingDot delay="0ms" />
          <LoadingDot delay="140ms" />
          <LoadingDot delay="280ms" />
        </div>
      </div>
    </main>
  )
}

function LoadingDot({ delay }: { delay: string }) {
  return (
    <span
      className="h-4 w-4 rounded-full bg-[#2980B9] shadow-[0_0_18px_rgba(41,128,185,0.35)] opacity-25"
      style={{
        animation: 'navigation-loading-dot-pulse 1.1s ease-in-out infinite',
        animationDelay: delay,
      }}
    />
  )
}
