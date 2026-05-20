import { useEffect, useRef, useState } from 'react'

interface TokenBadgeProps {
  count: number
  direction: 'for' | 'against'
  size?: 'sm' | 'md'
}

export default function TokenBadge({ count, direction, size = 'md' }: TokenBadgeProps) {
  const [pop, setPop] = useState(false)
  const prevCount = useRef(count)

  useEffect(() => {
    if (count !== prevCount.current) {
      setPop(true)
      prevCount.current = count
      const t = setTimeout(() => setPop(false), 200)
      return () => clearTimeout(t)
    }
  }, [count])

  const sizeClasses = size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2.5 py-1 text-sm'
  const colorClasses = direction === 'for'
    ? 'bg-emerald-500 text-white'
    : 'bg-red-500 text-white'

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-bold tabular-nums transition-transform duration-150 ${sizeClasses} ${colorClasses} ${pop ? 'scale-125' : 'scale-100'}`}
    >
      {count}
    </span>
  )
}
