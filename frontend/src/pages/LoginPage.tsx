import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/auth'

// Telegram WebApp global type
declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string
        ready: () => void
        expand: () => void
      }
    }
  }
}

export function LoginPage() {
  const login = useAuthStore((s) => s.login)
  const loginWithTelegram = useAuthStore((s) => s.loginWithTelegram)
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Auto-login when running inside Telegram Mini App
  useEffect(() => {
    const tg = window.Telegram?.WebApp
    if (tg?.initData) {
      tg.ready()
      tg.expand()
      setLoading(true)
      loginWithTelegram(tg.initData).catch(() => {
        setError('Не удалось войти через Telegram. Попробуй вручную.')
        setLoading(false)
      })
    }
  }, [loginWithTelegram])

  const handleLogin = async () => {
    if (!username.trim()) return
    setLoading(true)
    setError('')
    try {
      await login(username.trim())
    } catch {
      setError('Не удалось войти. Попробуй ещё раз.')
    } finally {
      setLoading(false)
    }
  }

  // Full-screen loader while Telegram auto-login is in progress
  if (loading && window.Telegram?.WebApp?.initData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0f0f13]">
        <div className="text-6xl mb-6">🎯</div>
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-sm mt-4">Входим через Telegram...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-[#0f0f13]">
      {/* Logo */}
      <div className="mb-10 text-center">
        <div className="text-6xl mb-4">🎯</div>
        <h1 className="text-3xl font-bold text-white mb-2">Goal Tracker</h1>
        <p className="text-gray-400 text-sm">AI-трекер твоей большой цели</p>
      </div>

      {/* Form */}
      <div className="w-full max-w-sm space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-2">Имя пользователя</label>
          <input
            className="w-full bg-[#1c1c24] border border-[#2a2a35] rounded-2xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors"
            placeholder="Например: alex"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            autoFocus
          />
        </div>

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}

        <button
          onClick={handleLogin}
          disabled={loading || !username.trim()}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:text-indigo-500 text-white font-semibold py-3 rounded-2xl transition-all duration-200 flex items-center justify-center gap-2"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            'Войти'
          )}
        </button>
      </div>

      <p className="mt-8 text-gray-600 text-xs text-center">
        Dev-режим: введи любое имя
      </p>
    </div>
  )
}
