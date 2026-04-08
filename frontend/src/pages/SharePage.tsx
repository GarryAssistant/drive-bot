import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { progressApi } from '../lib/api'

const AVATAR_MAP = [
  { threshold: 0,  emoji: '🔩', label: 'Детали' },
  { threshold: 20, emoji: '⚙️',  label: 'Двигатель' },
  { threshold: 40, emoji: '🏎️',  label: 'Корпус' },
  { threshold: 60, emoji: '🚗',  label: 'Колёса' },
  { threshold: 80, emoji: '🏁',  label: 'Финиш' },
]

function getAvatar(progress: number) {
  return [...AVATAR_MAP].reverse().find(p => progress >= p.threshold) ?? AVATAR_MAP[0]
}

function getMotivationLine(progress: number): string {
  if (progress >= 100) return 'Цель достигнута 🏆'
  if (progress >= 75)  return 'Финальная прямая 🔥'
  if (progress >= 50)  return 'Половина позади 💪'
  if (progress >= 25)  return 'Разогнался ⚡'
  return 'Путь начат 🚀'
}

export function SharePage() {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => progressApi.getDashboard(),
  })

  if (isLoading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const d = data?.data
  if (!d) return null

  const { goal, stats } = d
  const progress = Math.min(stats.progressPercent, 100)
  const avatar = getAvatar(progress)
  const today = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })

  const shareText =
    `${avatar.emoji} Коплю на мечту: ${goal.title}\n` +
    `⚡ Прогресс: ${progress.toFixed(0)}% — ${getMotivationLine(progress)}\n` +
    `🔥 Стрик: ${stats.currentStreak} дней без пропусков\n\n` +
    `Треку каждый день и иду к цели 💪`

  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ text: shareText, title: 'Мой прогресс к цели' })
      } else {
        await navigator.clipboard.writeText(shareText)
        alert('Скопировано! Вставь в Stories или Telegram 🚀')
      }
    } catch { /* user cancelled */ }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10"
      style={{ background: 'linear-gradient(160deg, #0c0c12 0%, #13131a 60%, #1a1028 100%)' }}
    >
      {/* ── Карточка (формат Story) ──────────────────────────────────────── */}
      <div
        className="w-full max-w-[340px] rounded-3xl overflow-hidden shadow-2xl"
        style={{ border: '1px solid #2a2a35', background: 'linear-gradient(160deg, #1c1c2e 0%, #0f0f13 100%)' }}
      >
        {/* Шапка */}
        <div className="px-6 pt-6 pb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-indigo-500" />
            <span className="text-indigo-400 text-xs font-semibold uppercase tracking-widest">Goal Tracker</span>
          </div>
          <span className="text-gray-600 text-xs">{today}</span>
        </div>

        {/* Аватар */}
        <div className="flex flex-col items-center py-8">
          <div className="text-[96px] leading-none mb-2 drop-shadow-lg">{avatar.emoji}</div>
          <span className="text-gray-500 text-sm">{avatar.label}</span>
        </div>

        {/* Прогресс */}
        <div className="px-6 pb-2">
          <div className="text-center mb-4">
            <div className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">
              {progress.toFixed(0)}%
            </div>
            <p className="text-gray-400 text-sm mt-1">{getMotivationLine(progress)}</p>
          </div>

          {/* Бар */}
          <div className="h-2 bg-[#0f0f13] rounded-full overflow-hidden mb-5">
            <div
              className="h-full rounded-full"
              style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #6366f1, #8b5cf6)' }}
            />
          </div>

          {/* Цель */}
          <p className="text-gray-300 text-sm font-medium text-center italic mb-1 leading-snug">
            «{goal.title}»
          </p>
        </div>

        {/* Статы */}
        <div className="grid grid-cols-2 gap-3 px-6 pb-6 mt-3">
          <div className="bg-black/30 border border-[#2a2a35] rounded-2xl p-3 text-center">
            <div className="text-xl font-bold text-orange-400">{stats.currentStreak} 🔥</div>
            <div className="text-gray-600 text-xs mt-0.5">дней подряд</div>
          </div>
          <div className="bg-black/30 border border-[#2a2a35] rounded-2xl p-3 text-center">
            <div className="text-xl font-bold text-indigo-400">{stats.totalEntries}</div>
            <div className="text-gray-600 text-xs mt-0.5">записей всего</div>
          </div>
        </div>

        {/* Нижняя полоска-бренд */}
        <div className="px-6 pb-5 text-center">
          <span className="text-gray-700 text-xs">goaltracker.app</span>
        </div>
      </div>

      {/* ── Кнопки ───────────────────────────────────────────────────────── */}
      <div className="w-full max-w-[340px] mt-5 space-y-3">
        <button
          onClick={handleShare}
          className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold py-4 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 transition-all"
        >
          📤 Поделиться прогрессом
        </button>
        <p className="text-gray-600 text-xs text-center">
          Скриншот карточки выше + кнопка ↑ для Stories/Telegram
        </p>
        <button onClick={() => navigate('/')} className="w-full text-gray-500 text-sm py-2">
          ← Назад на главную
        </button>
      </div>
    </div>
  )
}
