import { useQuery } from '@tanstack/react-query'
import { progressApi } from '../lib/api'

function MiniChart({ data }: { data: { date: string; score: number; hasEntry: boolean }[] }) {
  const max = Math.max(...data.map((d) => d.score), 1)
  return (
    <div className="flex items-end gap-[2px]" style={{ height: 72 }}>
      {data.map((d, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm transition-all duration-500 min-h-[3px]"
          title={`${d.date}: ${d.score}`}
          style={{
            height: d.hasEntry
              ? `${Math.max((d.score / max) * 100, 10)}%`
              : '3px',
            background: d.hasEntry
              ? d.score >= 70 ? '#10b981'
              : d.score >= 40 ? '#6366f1'
              : '#4b5563'
              : '#2a2a35',
            opacity: d.hasEntry ? 1 : 0.5,
          }}
        />
      ))}
    </div>
  )
}

export function AnalyticsPage() {
  const { data: chartData, isLoading: chartLoading } = useQuery({
    queryKey: ['chart-30'],
    queryFn: () => progressApi.getChart(30),
  })

  const { data: reportData, isLoading: reportLoading } = useQuery({
    queryKey: ['weekly-report'],
    queryFn: () => progressApi.getWeeklyReport(),
  })

  const { data: dashData } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => progressApi.getDashboard(),
  })

  if (chartLoading || reportLoading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const chart = chartData?.data
  const report = reportData?.data?.report
  const dash = dashData?.data

  const trendIcon = report?.trend === 'improving' ? '📈' : report?.trend === 'declining' ? '📉' : '➡️'
  const trendColor = report?.trend === 'improving' ? 'text-emerald-400' : report?.trend === 'declining' ? 'text-red-400' : 'text-amber-400'

  return (
    <div className="px-4 py-6 space-y-5">
      <h1 className="text-2xl font-bold text-white">Аналитика</h1>

      {/* Общая статистика */}
      {dash && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Стрик', value: `${dash.stats.currentStreak}🔥`, sub: 'дней' },
            { label: 'Прогресс', value: `${dash.stats.progressPercent.toFixed(0)}%`, sub: 'к цели' },
            { label: 'Записей', value: dash.stats.totalEntries, sub: 'всего' },
          ].map((s) => (
            <div key={s.label} className="bg-[#1c1c24] border border-[#2a2a35] rounded-2xl p-3 text-center">
              <div className="text-xl font-bold text-white">{s.value}</div>
              <div className="text-gray-500 text-xs mt-0.5">{s.sub}</div>
              <div className="text-gray-600 text-xs">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* График 30 дней */}
      {chart && (
        <div className="bg-[#1c1c24] border border-[#2a2a35] rounded-3xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold">30 дней</h2>
            <span className="text-gray-500 text-sm">
              {chart.chartData.filter((d: any) => d.hasEntry).length} активных дней
            </span>
          </div>
          <MiniChart data={chart.chartData} />
          <div className="flex justify-between mt-2">
            <span className="text-gray-600 text-xs">30 дн. назад</span>
            <span className="text-gray-600 text-xs">Сегодня</span>
          </div>
        </div>
      )}

      {/* Подкатегории за неделю */}
      {dash?.week?.subcategories && (
        <div className="bg-[#1c1c24] border border-[#2a2a35] rounded-3xl p-5">
          <h2 className="text-white font-semibold mb-4">По направлениям (7 дней)</h2>
          <div className="space-y-3">
            {[...dash.week.subcategories]
              .sort((a: any, b: any) => b.weekAvgScore - a.weekAvgScore)
              .map((sub: any) => (
                <div key={sub.id}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-gray-300 text-sm flex items-center gap-1.5">
                      <span>{sub.emoji}</span>{sub.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 text-xs">{sub.weekEntries} зап.</span>
                      <span className="text-white text-sm font-bold w-8 text-right">{sub.weekAvgScore.toFixed(1)}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-[#0f0f13] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${(sub.weekAvgScore / 10) * 100}%`, backgroundColor: sub.color }}
                    />
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* AI Недельный отчёт */}
      {report ? (
        <div className="bg-[#1c1c24] border border-[#2a2a35] rounded-3xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-white font-semibold">AI-отчёт недели</h2>
            <span className={`text-sm font-medium ${trendColor}`}>{trendIcon} {report.trend === 'improving' ? 'Растёт' : report.trend === 'declining' ? 'Падает' : 'Стабильно'}</span>
          </div>

          <p className="text-gray-300 text-sm leading-relaxed">{report.summary}</p>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">
              <div className="text-emerald-400 text-xs mb-1">🏆 Лучшее</div>
              <div className="text-white text-sm font-medium">{report.topCategory}</div>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
              <div className="text-amber-400 text-xs mb-1">⚡ Прокачать</div>
              <div className="text-white text-sm font-medium">{report.weakCategory}</div>
            </div>
          </div>

          {report.insights?.length > 0 && (
            <div>
              <p className="text-gray-500 text-xs mb-2">Инсайты:</p>
              <ul className="space-y-1.5">
                {report.insights.map((ins: string, i: number) => (
                  <li key={i} className="text-gray-400 text-sm flex items-start gap-2">
                    <span className="text-indigo-400 mt-0.5 shrink-0">•</span>{ins}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-3">
            <p className="text-indigo-300 text-xs mb-1">🎯 Фокус на следующую неделю:</p>
            <p className="text-white text-sm">{report.nextWeekFocus}</p>
          </div>
        </div>
      ) : (
        <div className="bg-[#1c1c24] border border-[#2a2a35] rounded-3xl p-8 text-center">
          <div className="text-4xl mb-3">📊</div>
          <p className="text-gray-400 text-sm">Добавь несколько записей,<br />чтобы получить AI-анализ</p>
        </div>
      )}
    </div>
  )
}
