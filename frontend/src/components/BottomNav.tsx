import { useLocation, useNavigate } from 'react-router-dom'

const tabs = [
  { path: '/',          icon: '🏠', label: 'Главная' },
  { path: '/entry',     icon: '✍️',  label: 'Запись' },
  { path: '/analytics', icon: '📊', label: 'Аналитика' },
]

export function BottomNav() {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  return (
    <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-[#0f0f13]/95 backdrop-blur-md border-t border-[#2a2a35]">
      <div className="flex">
        {tabs.map((tab) => {
          const active = pathname === tab.path
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 transition-all ${
                active ? 'text-indigo-400' : 'text-gray-600 hover:text-gray-400'
              }`}
            >
              <span className="text-xl">{tab.icon}</span>
              <span className="text-[10px] font-medium">{tab.label}</span>
              {active && <div className="absolute -top-px w-8 h-0.5 bg-indigo-500 rounded-full" />}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
