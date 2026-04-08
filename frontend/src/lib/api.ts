import axios from 'axios';

export const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

// Автоматически добавляем токен из localStorage
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('gt_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Типы ответов API
export interface User { id: string; username?: string; firstName?: string; }
export interface Subcategory { id: string; goalId: string; name: string; emoji: string; weight: number; color: string; }
export interface Goal { id: string; title: string; description?: string; deadline?: string; subcategories: Subcategory[]; }
export interface EntryScore { subcategoryId: string; score: number; actions: string[]; aiComment?: string; subcategory: Subcategory; }
export interface Entry { id: string; rawText: string; date: string; totalScore: number; aiComment?: string; entryScores: EntryScore[]; }
export interface Stats { currentStreak: number; longestStreak: number; totalEntries: number; progressPercent: number; lastEntryDate?: string; }
export interface AnalysisResult {
  totalScore: number;
  overallComment: string;
  strengths: string[];
  suggestions: string[];
  subcategories: { name: string; score: number; actions: string[]; comment: string }[];
}

// API методы
export const authApi = {
  devLogin: (username: string) =>
    api.post<{ token: string; user: User }>('/auth/dev', { username }),
  telegramLogin: (initData: string) =>
    api.post<{ token: string; user: User }>('/auth/telegram', { initData }),
};

export const goalsApi = {
  getActive: () => api.get<{ goal: Goal; stats: Stats }>('/goals/active'),
  create: (data: { title: string; description?: string; deadline?: string }) =>
    api.post<{ goal: Goal; suggested: Subcategory[] }>('/goals', data),
  updateSubcategories: (goalId: string, subcategories: Partial<Subcategory>[]) =>
    api.put(`/goals/${goalId}/subcategories`, { subcategories }),
};

export const entriesApi = {
  create: (rawText: string) =>
    api.post<{ entry: Entry; analysis: AnalysisResult; streak: { currentStreak: number; isNew: boolean } }>('/entries', { rawText }),
  getToday: () => api.get<{ hasEntry: boolean; entry: Entry | null }>('/entries/today'),
  getHistory: (page = 1) => api.get<{ entries: Entry[]; pagination: any }>(`/entries?page=${page}`),
};

export const progressApi = {
  getDashboard: () => api.get<{
    goal: Pick<Goal, 'id' | 'title' | 'deadline'>;
    stats: Stats;
    week: { entries: number; avgScore: number; subcategories: any[] };
    recentEntries: Pick<Entry, 'id' | 'date' | 'totalScore' | 'aiComment'>[];
    forecast: { daysLeft: number | null; onTrack: boolean; projectedDays: number | null };
  }>('/progress'),
  getChart: (days = 30) => api.get<{ chartData: any[]; categoryCharts: any[] }>(`/progress/chart?days=${days}`),
  getWeeklyReport: () => api.get<{ report: any; entriesCount: number }>('/progress/weekly-report'),
};
