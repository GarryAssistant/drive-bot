import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { entriesApi } from '../lib/api'
import type { AnalysisResult } from '../lib/api'

type State = 'input' | 'loading' | 'result'

export function EntryPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [state, setState] = useState<State>('input')
  const [result, setResult] = useState<{
    analysis: AnalysisResult
    streak: { currentStreak: number; isNew: boolean }
  } | null>(null)

  // Проверяем — есть ли уже запись сегодня
  const { data: todayData } = useQuery({
    queryKey: ['entry-today'],
    queryFn: () => entriesApi.getToday(),
  })
  const hasToday = todayData?.data?.hasEntry

  const submit = useMutation({
    mutationFn: () => entriesApi.create(text),
    onMutate: () => setState('loading'),
    onSuccess: (res) => {
      setResult({ analysis: res.data.analysis, streak: res.data.streak })
      setState('result')
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['entry-today'] })
      qc.invalidateQueries({ queryKey: ['chart-30'] })
      qc.invalidateQueries({ queryKey: ['weekly-report'] })
    },
    onError: () => setState('input'),
  })

  // ── Уже есть запись сегодня ────────────────────────────────────────────
  if (hasToday && state === 'input') return (
    <div className="px-4 py-6 min-h-screen flex flex-col items-center justify-center text-center">
      <div className="text-6xl mb-4">✅</div>
      <h2 className="text-xl font-bold text-white mb-2">Уже отметился сегодня!</h2>
      <p className="text-gray-400 text-sm mb-8">Возвращайся завтра. Стрик продолжается 🔥</p>
      <button onClick={() => navigate('/')} className="bg-indigo-600 text-white px-8 py-3 rounded-2xl font-semibold">
        На главную
      </button>
    </div>
  )

  // ── Загрузка AI ────────────────────────────────────────────────────────
  if (state === 'loading') return (
    <div className="px-4 py-6 min-h-screen flex flex-col items-center justify-center">
      <div className="text-5xl mb-6 animate-pulse">🤖</div>
      <h2 className="text-xl font-bold text-white mb-2">AI анализирует день</h2>
      <p className="text-gray-400 text-sm text-center mb-6">Классифицирую действия по подцелям...</p>
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  )

  // ── Результат AI ───────────────────────────────────────────────────────
  if (state === 'result' && result) {
    const { analysis, streak } = result
    const scoreColor = analysis.totalScore >= 70 ? 'text-emerald-400'
      : analysis.totalScore >= 40 ? 'text-amber-400' : 'text-red-400'

    return (
      <div className="px-4 py-6 space-y-5">
        {/* Заголовок */}
        <div className="text-center py-4">
          <div className="text-5xl mb-3">
            {analysis.totalScore >= 70 ? '🔥' : analysis.totalScore >= 40 ? '💪' : '📝'}
          </div>
          <div className={`text-5xl font-bold mb-1 ${scoreColor}`}>{analysis.totalScore}</div>
          <div className="text-gray-400 text-sm">баллов за день</div>
          {streak.isNew && (
            <div className="mt-3 inline-flex items-center gap-1.5 bg-orange-500/10 border border-orange-500/30 px-4 py-1.5 rounded-full">
              <span>🔥</span>
              <span className="text-orange-400 text-sm font-bold">Стрик: {streak.currentStreak} {streak.currentStreak === 1 ? 'день' : 'дней'}</span>
            </div>
          )}
        </div>

        {/* Комментарий AI */}
        <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-2xl p-4">
          <p className="text-indigo-200 text-sm leading-relaxed">💬 {analysis.overallComment}</p>
        </div>

        {/* Баллы по подкатегориям */}
        <div className="bg-[#1c1c24] border border-[#2a2a35] rounded-3xl p-5">
          <h3 className="text-white font-semibold mb-4">По направлениям</h3>
          <div className="space-y-4">
            {analysis.subcategories.map((cat) => (
              <div key={cat.name}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-gray-300 text-sm">{cat.name}</span>
                  <span className={`text-sm font-bold ${cat.score >= 7 ? 'text-emerald-400' : cat.score >= 4 ? 'text-amber-400' : 'text-gray-500'}`}>
                    {cat.score}/10
                  </span>
                </div>
                <div className="h-2 bg-[#0f0f13] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${(cat.score / 10) * 100}%`,
                      background: cat.score >= 7 ? '#10b981' : cat.score >= 4 ? '#f59e0b' : '#4b5563'
                    }}
                  />
                </div>
                {cat.actions.length > 0 && (
                  <p className="text-gray-500 text-xs mt-1">
                    {cat.actions.slice(0, 2).join(' · ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Сильные стороны */}
        {analysis.strengths.length > 0 && (
          <div className="bg-[#1c1c24] border border-[#2a2a35] rounded-2xl p-4">
            <h3 className="text-white font-semibold mb-2 text-sm">💪 Сильные стороны дня</h3>
            <ul className="space-y-1">
              {analysis.strengths.map((s, i) => (
                <li key={i} className="text-gray-400 text-sm flex items-start gap-2">
                  <span className="text-emerald-500 mt-0.5">✓</span> {s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Рекомендации */}
        {analysis.suggestions.length > 0 && (
          <div className="bg-[#1c1c24] border border-[#2a2a35] rounded-2xl p-4">
            <h3 className="text-white font-semibold mb-2 text-sm">💡 Завтра попробуй</h3>
            <ul className="space-y-1">
              {analysis.suggestions.map((s, i) => (
                <li key={i} className="text-gray-400 text-sm flex items-start gap-2">
                  <span className="text-indigo-400 mt-0.5">→</span> {s}
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          onClick={() => navigate('/')}
          className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3.5 rounded-2xl transition-all"
        >
          На главную
        </button>
      </div>
    )
  }

  // ── Ввод ───────────────────────────────────────────────────────────────
  return (
    <div className="px-4 py-6 flex flex-col min-h-[calc(100vh-80px)]">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Как прошёл день?</h1>
        <p className="text-gray-400 text-sm">Пиши свободно — AI сам разберёт что к чему</p>
      </div>

      <textarea
        className="flex-1 w-full bg-[#1c1c24] border border-[#2a2a35] rounded-2xl p-4 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors resize-none text-base leading-relaxed min-h-[200px]"
        placeholder="Например: провёл созвон с клиентом на 100к, прочитал 30 страниц книги по продажам, сходил в зал..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />

      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>{text.length} символов</span>
          <span>{text.length < 10 ? '✏️ Напиши побольше' : '✅ Готово к анализу'}</span>
        </div>
        <button
          onClick={() => submit.mutate()}
          disabled={text.trim().length < 10}
          className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 text-white font-semibold py-3.5 rounded-2xl transition-all flex items-center justify-center gap-2"
        >
          <span>🤖</span> Анализировать с AI
        </button>
      </div>
    </div>
  )
}
