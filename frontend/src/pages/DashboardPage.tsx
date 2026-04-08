import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { progressApi } from '../lib/api'
import { MilestoneCelebration, useMilestone } from '../components/MilestoneCelebration'

function GoalAvatar({ progress }: { progress: number }) {
  // Аватар цели — машина собирается по мере прогресса
  const parts = [
    { threshold: 0,  emoji: '🔩', label: 'Детали' },
    { threshold: 20, emoji: '⚙️',  label: 'Двигатель' },
    { threshold: 40, emoji: '🏎️',  label: 'Корпус' },
    { threshold: 60, emoji: '🚗',  label: 'Колёса' },
    { threshold: 80, emoji: '🏁',  label: 'Финиш' },
  ]
  const current = [...parts].reverse().find((p) => progress >= p.threshold) || parts[0]

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <div className="text-8xl drop-shadow-lg select-none">{current.emoji}</div>
        {progress >= 80 && (
          <div className="absolute -top-2 -right-2 text-2xl animate-bounce">✨</div>
        )}
      </div>
      <p className="text-gray-500 text-xs mt-2">{current.label}</p>
    </div>
  )
}

function StreakBadge({ streak }: { streak: number }) {
  if (streak === 0) return (
    <div className="flex items-center gap-1.5 bg-[#1c1c24] border border-[#2a2a35] px-3 py-1.5 rounded-full">
      <span className="text-gray-500">💤</span>
      <span className="text-gray-500 text-sm">Нет стрика</span>
    </div>
  )
  return (
    <div className="flex items-center gap-1.5 bg-orange-500/10 border border-orange-500/30 px-3 py-1.5 rounded-full">
      <span>🔥</span>
      <span className="text-orange-400 font-bold text-sm">{streak} {streak === 1 ? 'день' : streak < 5 ? 'дня' : 'дней'}</span>
    </div>
  )
}

function ProgressRing({ percent }: { percent: number }) {
  const r = 54
  const circ = 2 * Math.PI * r
  const offset = circ - (percent / 100) * circ

  return (
    <div className="relative w-32 h-32 flex items-center justify-center">
      <svg className="absolute -rotate-90" width="128" height="128">
        <circle cx="64" cy="64" r={r} fill="none" stroke="#1c1c24" strokeWidth="8" />
        <circle
          cx="64" cy="64" r={r} fill="none"
          stroke="url(#grad)" strokeWidth="8"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s ease' }}
        />
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
      </svg>
      <div className="text-center z-10">
        <div className="text-2xl font-bold text-white">{percent.toFixed(0)}%</div>
        <div className="text-gray-500 text-xs">прогресс</div>
      </div>
    </div>
  )
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => progressApi.getDashboard(),
    refetchOnWindowFocus: true,
  })

  const progress = data?.data?.stats?.progressPercent ?? 0
  const { active: activeMilestone, dismiss } = useMilestone(progress)

  if (isLoading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const d = data?.data
  if (!d) return null

  const { goal, stats, week, forecast } = d
  const todayFormatted = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="px-4 py-6 space-y-5">
      {/* Milestone celebration overlay */}
      {activeMilestone && (
        <MilestoneCelebration
          milestone={activeMilestone}
          progress={stats.progressPercent}
          goalTitle={goal.title}
          onClose={dismiss}
          onShare={() => { dismiss(); navigate('/share') }}
        />
      )}
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-gray-500 text-sm capitalize">{todayFormatted}</p>
          <h1 className="text-white font-bold text-lg leading-tight mt-0.5 max-w-[220px]">{goal.title}</h1>
        </div>
        <StreakBadge streak={stats.currentStreak} />
      </div>

      {/* Аватар + прогресс */}
      <div className="bg-[#1c1c24] border border-[#2a2a35] rounded-3xl p-6 flex items-center justify-between relative">
        <GoalAvatar progress={stats.progressPercent} />
        <div className="flex flex-col items-center gap-3">
          <ProgressRing percent={stats.progressPercent} />
          {forecast.daysLeft && (
            <p className="text-xs text-center">
              <span className={forecast.onTrack ? 'text-emerald-400' : 'text-amber-400'}>
                {forecast.onTrack ? '✅ В темпе' : '⚡ Ускорься'}
              </span>
              <span className="text-gray-500"> · {forecast.daysLeft} дн. осталось</span>
            </p>
          )}
        </div>
        {/* Кнопка поделиться */}
        <button
          onClick={() => navigate('/share')}
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-xl bg-[#0f0f13] border border-[#2a2a35] text-gray-500 hover:text-indigo-400 hover:border-indigo-500/40 transition-all text-sm"
          title="Поделиться прогрессом"
        >
          📤
        </button>
      </div>

      {/* CTA — добавить запись */}
      <button
        onClick={() => navigate('/entry')}
        className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold py-4 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
      >
        <span className="text-xl">✍️</span>
        <span>Что сделал сегодня?</span>
      </button>

      {/* Неделя: подкатегории */}
      <div className="bg-[#1c1c24] border border-[#2a2a35] rounded-3xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold">Эта неделя</h2>
          <span className="text-gray-500 text-sm">{week.entries}/7 дней</span>
        </div>
        <div className="space-y-3">
          {week.subcategories.map((sub: any) => (
            <div key={sub.id}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-300 flex items-center gap-1.5">
                  <span>{sub.emoji}</span>{sub.name}
                </span>
                <span className="text-sm font-medium text-white">{sub.weekAvgScore.toFixed(1)}/10</span>
              </div>
              <div className="h-1.5 bg-[#0f0f13] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${(sub.weekAvgScore / 10) * 100}%`, backgroundColor: sub.color }}
                />
              </div>
            </div>
          ))}
        </div>
        {week.avgScore > 0 && (
          <div className="mt-4 pt-4 border-t border-[#2a2a35] flex items-center justify-between">
            <span className="text-gray-500 text-sm">Средний балл</span>
            <span className="text-white font-bold">{week.avgScore}/100</span>
          </div>
        )}
      </div>

      {/* Последние записи */}
      {d.recentEntries.length > 0 && (
        <div className="bg-[#1c1c24] border border-[#2a2a35] rounded-3xl p-5">
          <h2 className="text-white font-semibold mb-3">Последние записи</h2>
          <div className="space-y-2">
            {d.recentEntries.slice(0, 5).map((e: any) => (
              <div key={e.id} className="flex items-center justify-between py-2 border-b border-[#2a2a35] last:border-0">
                <span className="text-gray-400 text-sm">
                  {new Date(e.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                </span>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-16 bg-[#0f0f13] rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${e.totalScore}%` }} />
                  </div>
                  <span className="text-white text-sm font-medium w-8 text-right">{e.totalScore}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
