export function SnakeLogoArcade() {
  return (
    <svg
      viewBox="0 0 360 120"
      role="img"
      aria-label="Pixel snake emblem"
      className="h-[44px] w-full max-w-[165px] lg:h-[88px] lg:max-w-[330px]"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="pixel-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#dff2ff" />
          <stop offset="45%" stopColor="#8ad8ff" />
          <stop offset="100%" stopColor="#3a8ce6" />
        </linearGradient>
      </defs>

      {/* Tail pixels */}
      <g fill="#0b2f52" opacity="0.95">
        <rect x="28" y="76" width="22" height="22" rx="2" />
        <rect x="54" y="76" width="22" height="22" rx="2" />
        <rect x="80" y="76" width="22" height="22" rx="2" />
        <rect x="106" y="76" width="22" height="22" rx="2" />
      </g>
      <g fill="url(#pixel-fill)">
        <rect x="30" y="78" width="18" height="18" rx="1" />
        <rect x="56" y="78" width="18" height="18" rx="1" />
        <rect x="82" y="78" width="18" height="18" rx="1" />
        <rect x="108" y="78" width="18" height="18" rx="1" />
      </g>

      {/* Mid body pixels */}
      <g fill="#0b2f52" opacity="0.95">
        <rect x="132" y="50" width="24" height="24" rx="2" />
        <rect x="160" y="50" width="24" height="24" rx="2" />
        <rect x="188" y="50" width="24" height="24" rx="2" />
        <rect x="216" y="50" width="24" height="24" rx="2" />
        <rect x="244" y="50" width="24" height="24" rx="2" />
      </g>
      <g fill="url(#pixel-fill)">
        <rect x="134" y="52" width="20" height="20" rx="1" />
        <rect x="162" y="52" width="20" height="20" rx="1" />
        <rect x="190" y="52" width="20" height="20" rx="1" />
        <rect x="218" y="52" width="20" height="20" rx="1" />
        <rect x="246" y="52" width="20" height="20" rx="1" />
      </g>

      {/* Head block */}
      <g>
        <rect x="274" y="32" width="70" height="58" rx="4" fill="#0b2f52" />
        <rect x="278" y="36" width="62" height="50" rx="3" fill="url(#pixel-fill)" />

        {/* Jaw notch */}
        <rect x="330" y="56" width="16" height="12" fill="#0b2f52" />
        <rect x="332" y="58" width="12" height="8" fill="url(#pixel-fill)" />

        {/* Eye */}
        <rect x="294" y="48" width="10" height="10" fill="#0b2f52" />
        <rect x="296" y="50" width="6" height="6" fill="#e6f4ff" />
      </g>

      {/* Accent sparks */}
      <g fill="#58b9ff" opacity="0.9">
        <rect x="148" y="26" width="8" height="8" rx="1" />
        <rect x="174" y="20" width="6" height="6" rx="1" />
        <rect x="204" y="24" width="7" height="7" rx="1" />
      </g>
    </svg>
  )
}
