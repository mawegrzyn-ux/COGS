interface LogoProps {
  size?: 'sm' | 'md' | 'lg'
  variant?: 'dark' | 'light'
}

const sizes = { sm: 28, md: 36, lg: 48 }
const textSizes = { sm: 'text-lg', md: 'text-2xl', lg: 'text-3xl' }

export default function Logo({ size = 'md', variant = 'dark' }: LogoProps) {
  const px = sizes[size]
  const color = variant === 'light' ? '#ffffff' : '#146A34'
  const textColor = variant === 'light' ? 'text-white' : 'text-accent'

  return (
    <div className="flex items-center gap-2.5">
      {/* Icon mark — stylised C + fork tine */}
      <svg width={px} height={px} viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="36" height="36" rx="9" fill={color} />
        <path
          d="M24 11C21.5 9.5 17.5 9 14.5 11C11 13.5 10 17.5 11 21C12 24.5 15 26.5 18.5 26.5C20.5 26.5 22.5 25.8 24 24.5"
          stroke="white" strokeWidth="2.2" strokeLinecap="round" fill="none"
        />
        <line x1="26" y1="13" x2="26" y2="24" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
        <line x1="23" y1="13" x2="23" y2="17" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
        <line x1="26" y1="17" x2="23" y2="17" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <span className={`font-extrabold tracking-tight ${textSizes[size]} ${textColor}`}>
        Menu<span className="font-light opacity-60">COGS</span>
      </span>
    </div>
  )
}
