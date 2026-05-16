import Image from 'next/image'

export function LaunchLoadingScreen() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#eef3f8]">
      <video
        className="h-screen w-screen object-cover"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/launch/mascot-loading-poster.PNG"
        aria-label="Načítání aplikace"
      >
        <source src="/launch/mascot-loading.MP4" type="video/mp4" />
      </video>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/35 via-black/10 to-transparent px-6 pb-10 pt-20 text-center text-white">
        <div className="mx-auto mb-3 inline-flex rounded-full bg-white/90 px-4 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#1f5f8e]">
          B-ENERGY
        </div>
        <p className="text-sm font-medium tracking-[0.02em] text-white/95">
          Načítám dashboard...
        </p>
      </div>

      <Image
        src="/launch/mascot-loading-poster.PNG"
        alt=""
        fill
        priority
        className="pointer-events-none -z-10 object-cover"
      />
    </div>
  )
}
