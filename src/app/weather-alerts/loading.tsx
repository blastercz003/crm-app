function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`block animate-pulse rounded-xl bg-[var(--surface-muted)] ${className}`} />
}

export default function WeatherAlertsLoading() {
  return (
    <main className="activities-page weather-alerts-page relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)] text-[var(--foreground)]">
      <div aria-hidden className="activities-page__glow activities-page__glow--right pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl" />
      <div aria-hidden className="activities-page__glow activities-page__glow--left pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl" />
      <div className="relative z-10 mx-auto flex w-full max-w-[1920px] flex-col gap-4 px-4 py-6 sm:px-6 lg:gap-5 lg:px-8" aria-busy="true" aria-label="Načítám výstrahy počasí">
        <header className="activities-page__hero rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <Skeleton className="h-8 w-52" />
            <Skeleton className="h-11 w-44 rounded-2xl" />
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} data-tone={(['blue', 'amber', 'violet', 'emerald'] as const)[index]} className="activities-page__panel activities-workspace__kpi h-[92px] rounded-[22px] border p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.08)] sm:h-[88px]">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-5 h-9 w-14" />
            </div>
          ))}
        </div>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="activities-page__panel min-w-0 rounded-[28px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div><Skeleton className="h-2.5 w-40" /><Skeleton className="mt-2 h-6 w-44" /></div>
              <Skeleton className="h-11 w-44" />
            </div>
            <Skeleton className="mt-4 h-[62px] w-full rounded-[18px]" />
            <Skeleton className="mt-5 h-[300px] w-full rounded-[24px]" />
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-[96px] w-full rounded-[22px]" />)}
            </div>
          </section>
          <aside className="space-y-4">
            <Skeleton className="h-[196px] w-full rounded-[24px]" />
            <Skeleton className="h-[190px] w-full rounded-[24px]" />
          </aside>
        </div>
      </div>
    </main>
  )
}
