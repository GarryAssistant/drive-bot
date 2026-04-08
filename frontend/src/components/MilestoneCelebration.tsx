import { useEffect, useState } from 'react'

const MILESTONES = [25, 50, 75, 100]

const AVATAR_MAP = [
  { threshold: 0,  emoji: '🔩' },
  { threshold: 20, emoji: '⚙️' },
  { threshold: 40, emoji: '🏎️' },
  { threshold: 60, emoji: '🚗' },
  { threshold: 80, emoji: '🏁' },
]

const LABELS: Record<number, { title: string; sub: string; icon: string }> = {
  25:  { title: 'Четверть пути!',     sub: 'Первый рубеж пройден. Двигатель прогрет.',      icon: '⚡' },
  50:  { title: 'Половина дороги!',   sub: 'Середина — самый сложный момент. Ты прошёл его.', icon: '💪' },
  75:  { title: 'Финальная прямая!',  sub: 'Осталось 25%. Финиш виден.',                    icon: '🔥' },
  100: { title: 'ЦЕЛЬ ДОСТИГНУТА!',   sub: 'Ты сделал это. Машина твоя.',                   icon: '🏆' },
}

const CONFETTI_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#0ea5e9']

function getSeenMilestones(): number[] {
  try { return JSON.parse(localStorage.getItem('gt-milestones') || '[]') } catch { return [] }
}

function markMilestoneSeen(m: number) {
  const seen = getSeenMilestones()
  if (!seen.includes(m)) localStorage.setItem('gt-milestones', JSON.stringify([...seen, m]))
}

function getAvatar(progress: number) {
  return [...AVATAR_MAP].reverse().find(p => progress >= p.threshold)?.emoji ?? '🔩'
}

// ── хук для использования в DashboardPage ──────────────────────────────────
export function useMilestone(progress: number) {
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    if (!progress) return
    const seen = getSeenMilestones()
    const crossed = MILESTONES.filter(m => progress >= m && !seen.includes(m))
    if (crossed.length > 0) {
      const highest = Math.max(...crossed)
      markMilestoneSeen(highest)
      // Небольшая задержка чтобы дашборд успел отрендериться
      setTimeout(() => setActive(highest), 600)
    }
  }, [progress])

  return { active, dismiss: () => setActive(null) }
}

// ── компонент-оверлей ───────────────────────────────────────────────────────
interface Props {
  milestone: number
  progress: number
  goalTitle: string
  onClose: () => void
  onShare: () => void
}

export function MilestoneCelebration({ milestone, progress, goalTitle, onClose, onShare }: Props) {
  const label = LABELS[milestone]
  const avatar = getAvatar(progress)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
      {/* Конфетти */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: 24 }).map((_, i) => (
          <div
            key={i}
            className="absolute rounded-sm"
            style={{
              width: `${6 + Math.random() * 6}px`,
              height: `${6 + Math.random() * 6}px`,
              left: `${Math.random() * 100}%`,
              top: `-${Math.random() * 10 + 5}%`,
              background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
              opacity: 0.9,
              animation: `confetti-fall ${2.5 + Math.random() * 2}s linear ${Math.random() * 1.5}s forwards`,
            }}
          />
        ))}
      </div>

      {/* Карточка */}
      <div className="bg-[#1c1c24] border border-[#2a2a35] rounded-3xl p-7 w-full max-w-sm text-center relative">
        <div className="text-4xl mb-1">{label.icon}</div>
        <div
          className="text-8xl mb-3"
          style={{ animation: 'milestone-bounce 0.6s cubic-bezier(.36,.07,.19,.97) both' }}
        >
          {avatar}
        </div>

        <div className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400 mb-2">
          {milestone}%
        </div>
        <h2 className="text-white text-xl font-bold mb-2">{label.title}</h2>
        <p className="text-gray-400 text-sm leading-relaxed mb-3">{label.sub}</p>
        <p className="text-gray-600 text-xs italic mb-6">«{goalTitle}»</p>

        <div className="space-y-3">
          <button
            onClick={onShare}
            className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold py-3.5 rounded-2xl flex items-center justify-center gap-2 transition-all"
          >
            📸 Поделиться в Stories
          </button>
          <button onClick={onClose} className="w-full text-gray-500 text-sm py-2">
            Продолжить →
          </button>
        </div>
      </div>
    </div>
  )
}
