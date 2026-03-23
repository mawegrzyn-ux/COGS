interface LogoProps {
  size?: 'sm' | 'md' | 'lg'
  variant?: 'dark' | 'light'
}

const sizes     = { sm: 28, md: 36, lg: 48 }
const textSizes = { sm: 'text-lg', md: 'text-2xl', lg: 'text-3xl' }

// The cog icon mark — used in sidebar logo and as the app identity icon
export function CogMark({ px, color }: { px: number; color: string }) {
  const TEETH = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="-100 -100 200 200"
      width={px}
      height={px}
    >
      {/* Cog body */}
      <circle cx="0" cy="0" r="66" fill={color} />

      {/* 12 teeth at 30° intervals */}
      <g fill={color}>
        {TEETH.map(deg => (
          <rect
            key={deg}
            x="-9" y="-80" width="18" height="20" rx="3"
            transform={`rotate(${deg})`}
          />
        ))}
      </g>

      {/* White face */}
      <circle cx="0" cy="0" r="54" fill="white" />

      {/* Plant / leaf icon in brand green */}
      <line
        x1="0" y1="30" x2="0" y2="-16"
        stroke={color} strokeWidth="6" strokeLinecap="round"
      />
      <path
        d="M 0,6 C -4,-10 -26,-16 -26,-4 C -26,8 -8,12 0,6 Z"
        fill="#1E8A44"
      />
      <path
        d="M 0,-4 C 4,-20 26,-26 26,-14 C 26,-2 8,2 0,-4 Z"
        fill={color}
      />
      <circle cx="0" cy="-16" r="6" fill="#1E8A44" />
    </svg>
  )
}

export default function Logo({ size = 'md', variant = 'dark' }: LogoProps) {
  const px        = sizes[size]
  const color     = variant === 'light' ? '#ffffff' : '#146A34'
  const textColor = variant === 'light' ? 'text-white' : 'text-accent'

  return (
    <div className="flex items-center gap-2.5">
      <CogMark px={px} color={color} />
      <span className={`font-extrabold tracking-tight ${textSizes[size]} ${textColor}`}>
        Menu<span className="font-light opacity-60">COGS</span>
      </span>
    </div>
  )
}
