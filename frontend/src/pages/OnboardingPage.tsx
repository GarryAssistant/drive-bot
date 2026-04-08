import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { goalsApi } from '../lib/api'
import type { Subcategory } from '../lib/api'

const DEADLINES = [
  { label: '3 месяца', months: 3 },
  { label: '6 месяцев', months: 6 },
  { label: '1 год', months: 12 },
  { label: '3 года', months: 36 },
]


export function OnboardingPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [step, setStep] = useState<'goal' | 'deadline' | 'categories' | 'loading'>('goal')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [deadlineMonths, setDeadlineMonths] = useState(12)
  const [categories, setCategories] = useState<Subcategory[]>([])
  const [goalId, setGoalId] = useState('')
  const [error, setError] = useState('')

  const createGoal = useMutation({
    mutationFn: () => {
      const deadline = new Date()
      deadline.setMonth(deadline.getMonth() + deadlineMonths)
      return goalsApi.create({ title, description, deadline: deadline.toISOString() })
    },
    onSuccess: (res) => {
      setGoalId(res.data.goal.id)
      setCategories(res.data.goal.subcategories)
      setStep('categories')
    },
    onError: () => setError('Ошибка при создании цели'),
  })

  const updateCategories = useMutation({
    mutationFn: (cats: Subcategory[]) =>
      goalsApi.updateSubcategories(goalId, cats),
    onSuccess: async () => {
      await qc.refetchQueries({ queryKey: ['active-goal'] })
      navigate('/')
    },
  })

  const handleGoalNext = () => {
    if (title.trim().length < 3) { setError('Введи хотя бы 3 символа'); return }
    setError('')
    setStep('deadline')
  }

  const handleDeadlineNext = () => {
    setStep('loading')
    createGoal.mutate()
  }

  const updateWeight = (id: string, weight: number) => {
    setCategories((prev) => prev.map((c) => c.id === id ? { ...c, weight } : c))
  }

  const handleFinish = () => {
    updateCategories.mutate(categories)
  }

  // ── Step: Goal ─────────────────────────────────────────────────────────
  if (step === 'goal') return (
    <div className="min-h-screen px-6 py-12 flex flex-col">
      <div className="mb-8">
        <p className="text-indigo-400 text-sm font-medium mb-2">Шаг 1 из 3</p>
        <h2 className="text-2xl font-bold text-white mb-2">Какова твоя большая цель?</h2>
        <p className="text-gray-400 text-sm">Опиши в свободной форме — AI поможет разбить на подцели</p>
      </div>

      <div className="space-y-4 flex-1">
        <input
          className="w-full bg-[#1c1c24] border border-[#2a2a35] rounded-2xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors text-lg"
          placeholder="Например: Купить Ferrari за 3 года"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <textarea
          className="w-full bg-[#1c1c24] border border-[#2a2a35] rounded-2xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors resize-none"
          placeholder="Подробнее (необязательно): как это изменит твою жизнь?"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}

        {/* Примеры целей */}
        <div>
          <p className="text-gray-500 text-xs mb-3">Примеры:</p>
          <div className="flex flex-wrap gap-2">
            {['🚀 Запустить стартап', '💰 Зарабатывать 500к/мес', '🏃 Пробежать марафон', '📚 Стать senior-разработчиком'].map((ex) => (
              <button
                key={ex}
                onClick={() => setTitle(ex.split(' ').slice(1).join(' '))}
                className="text-xs bg-[#1c1c24] border border-[#2a2a35] text-gray-300 px-3 py-1.5 rounded-full hover:border-indigo-500 transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        onClick={handleGoalNext}
        disabled={!title.trim()}
        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold py-3.5 rounded-2xl transition-all mt-6"
      >
        Далее →
      </button>
    </div>
  )

  // ── Step: Deadline ─────────────────────────────────────────────────────
  if (step === 'deadline') return (
    <div className="min-h-screen px-6 py-12 flex flex-col">
      <div className="mb-8">
        <p className="text-indigo-400 text-sm font-medium mb-2">Шаг 2 из 3</p>
        <h2 className="text-2xl font-bold text-white mb-2">За какое время?</h2>
        <p className="text-gray-400 text-sm">Реалистичный срок — ключ к правильному темпу</p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-auto">
        {DEADLINES.map((d) => (
          <button
            key={d.months}
            onClick={() => setDeadlineMonths(d.months)}
            className={`py-6 rounded-2xl border-2 font-semibold text-lg transition-all ${
              deadlineMonths === d.months
                ? 'border-indigo-500 bg-indigo-500/10 text-white'
                : 'border-[#2a2a35] bg-[#1c1c24] text-gray-400 hover:border-indigo-500/50'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        <button
          onClick={handleDeadlineNext}
          className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3.5 rounded-2xl transition-all flex items-center justify-center gap-2"
        >
          {createGoal.isPending ? (
            <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> AI анализирует цель...</>
          ) : 'Далее →'}
        </button>
        <button onClick={() => setStep('goal')} className="w-full text-gray-500 text-sm py-2">← Назад</button>
      </div>
    </div>
  )

  // ── Step: Loading (AI thinks) ──────────────────────────────────────────
  if (step === 'loading') return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="text-5xl mb-6 animate-pulse">🤖</div>
      <h2 className="text-xl font-bold text-white mb-2">AI анализирует цель</h2>
      <p className="text-gray-400 text-sm text-center">Разбиваю на подцели и рассчитываю веса...</p>
      <div className="mt-6 flex gap-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  )

  // ── Step: Categories ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen px-6 py-12 flex flex-col">
      <div className="mb-6">
        <p className="text-indigo-400 text-sm font-medium mb-2">Шаг 3 из 3</p>
        <h2 className="text-2xl font-bold text-white mb-1">Подцели</h2>
        <p className="text-gray-400 text-sm">AI предложил эти направления. Настрой веса под себя.</p>
      </div>

      <div className="space-y-3 flex-1">
        {categories.map((cat) => (
          <div key={cat.id} className="bg-[#1c1c24] border border-[#2a2a35] rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{cat.emoji}</span>
                <span className="text-white font-medium">{cat.name}</span>
              </div>
              <span className="text-indigo-400 font-bold text-sm">{Math.round(cat.weight * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.1} max={0.4} step={0.05}
              value={cat.weight}
              onChange={(e) => updateWeight(cat.id, parseFloat(e.target.value))}
              className="w-full accent-indigo-500"
            />
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        <button
          onClick={handleFinish}
          disabled={updateCategories.isPending}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold py-3.5 rounded-2xl transition-all flex items-center justify-center gap-2"
        >
          {updateCategories.isPending ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : '🚀 Начать трекинг'}
        </button>
      </div>
    </div>
  )
}
