import { prisma } from './prisma.service';

// ─── Уровни пользователей ─────────────────────────────────────────────────

export interface Level {
  id: number;
  name: string;
  minXP: number;
  badge: string;
  color: string;
  rewards: string[];
  description: string;
}

export const LEVELS: Level[] = [
  {
    id: 1,
    name: 'Новичок',
    minXP: 0,
    badge: '🥚',
    color: '#9CA3AF',
    rewards: ['Базовый трекинг', 'Ежедневные напоминания'],
    description: 'Только начинаете свой путь'
  },
  {
    id: 2,
    name: 'Практик',
    minXP: 1000,
    badge: '🐣',
    color: '#10B981',
    rewards: ['Расширенная аналитика', 'Категории прогресса'],
    description: 'Регулярно работаете над целью'
  },
  {
    id: 3,
    name: 'Мастер',
    minXP: 5000,
    badge: '🐥',
    color: '#3B82F6',
    rewards: ['Интеграции', 'Приватные группы'],
    description: 'Достигаете значительных результатов'
  },
  {
    id: 4,
    name: 'Легенда',
    minXP: 20000,
    badge: '🦅',
    color: '#8B5CF6',
    rewards: ['Персональный коучинг', 'AR-аватары'],
    description: 'Изменяете свою жизнь'
  }
];

// ─── Достижения (бейджи) ─────────────────────────────────────────────────

export interface Badge {
  id: string;
  name: string;
  icon: string;
  description: string;
  condition: (user: any) => Promise<boolean>;
  xpReward: number;
}

export const BADGES: Badge[] = [
  {
    id: 'first_entry',
    name: 'Первые шаги',
    icon: '👣',
    description: 'Сделал первую запись',
    condition: async (user) => {
      const entries = await prisma.entry.count({ where: { userId: user.id } });
      return entries >= 1;
    },
    xpReward: 50
  },
  {
    id: 'streak_7',
    name: 'Неделя силы',
    icon: '🔥',
    description: '7 дней подряд без пропусков',
    condition: async (user) => {
      const stats = await prisma.userStats.findUnique({ where: { userId: user.id } });
      return (stats?.currentStreak || 0) >= 7;
    },
    xpReward: 200
  },
  {
    id: 'streak_30',
    name: 'Месяц дисциплины',
    icon: '🏆',
    description: '30 дней подряд без пропусков',
    condition: async (user) => {
      const stats = await prisma.userStats.findUnique({ where: { userId: user.id } });
      return (stats?.currentStreak || 0) >= 30;
    },
    xpReward: 1000
  },
  {
    id: 'entries_100',
    name: 'Сто историй',
    icon: '💯',
    description: '100 записей в дневнике',
    condition: async (user) => {
      const entries = await prisma.entry.count({ where: { userId: user.id } });
      return entries >= 100;
    },
    xpReward: 500
  }
];

// ─── Основные функции ────────────────────────────────────────────────────

export async function getUserLevel(userId: string): Promise<Level> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { xp: true }
  });
  
  const xp = user?.xp || 0;
  
  // Находим максимальный уровень, который достиг пользователь
  let currentLevel = LEVELS[0];
  for (const level of LEVELS) {
    if (xp >= level.minXP) {
      currentLevel = level;
    } else {
      break;
    }
  }
  
  return currentLevel;
}

export async function calculateProgressToNextLevel(userId: string): Promise<{
  currentLevel: Level;
  nextLevel: Level | null;
  currentXP: number;
  xpToNextLevel: number;
  progressPercent: number;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { xp: true }
  });
  
  const xp = user?.xp || 0;
  const currentLevel = await getUserLevel(userId);
  
  // Находим следующий уровень
  const currentIndex = LEVELS.findIndex(l => l.id === currentLevel.id);
  const nextLevel = currentIndex < LEVELS.length - 1 ? LEVELS[currentIndex + 1] : null;
  
  if (!nextLevel) {
    return {
      currentLevel,
      nextLevel: null,
      currentXP: xp,
      xpToNextLevel: 0,
      progressPercent: 100
    };
  }
  
  const xpInCurrentLevel = xp - currentLevel.minXP;
  const xpNeededForNextLevel = nextLevel.minXP - currentLevel.minXP;
  const progressPercent = Math.min(100, (xpInCurrentLevel / xpNeededForNextLevel) * 100);
  
  return {
    currentLevel,
    nextLevel,
    currentXP: xp,
    xpToNextLevel: xpNeededForNextLevel - xpInCurrentLevel,
    progressPercent
  };
}

export async function awardXP(userId: string, action: string, metadata?: any): Promise<{
  xpAwarded: number;
  newLevel?: Level;
  badgesEarned: string[];
}> {
  // Маппинг действий на XP
  const xpMap: Record<string, number> = {
    // Ежедневные действия
    daily_entry: 10,
    entry_with_ai_analysis: 15,
    
    // Стрики
    streak_3: 50,
    streak_7: 100,
    streak_14: 200,
    streak_30: 500,
    
    // Социальные
    feedback: 20,
    invite_sent: 30,
    invite_accepted: 200,
    
    // Достижения
    badge_earned: 50,
    challenge_completed: 150,
    weekly_goal_met: 300
  };
  
  const baseXP = xpMap[action] || 5;
  
  // Модификаторы
  let multiplier = 1;
  if (metadata?.quality === 'high') multiplier *= 1.5;
  if (metadata?.streakBonus) multiplier *= 1.2;
  
  const xpAwarded = Math.round(baseXP * multiplier);
  
  // Обновляем XP пользователя
  await prisma.user.update({
    where: { id: userId },
    data: { xp: { increment: xpAwarded } }
  });
  
  // Проверяем, не заработал ли пользователь новый уровень
  const oldLevel = await getUserLevel(userId);
  await prisma.user.update({
    where: { id: userId },
    data: { xp: { increment: xpAwarded } }
  });
  const newLevel = await getUserLevel(userId);
  
  // Проверяем бейджи
  const badgesEarned: string[] = [];
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { badges: true }
  });
  
  if (user) {
    for (const badge of BADGES) {
      const alreadyHas = user.badges.some(b => b.type === badge.id);
      if (!alreadyHas && await badge.condition(user)) {
        // Награждаем бейджем
        await prisma.badge.create({
          data: {
            userId: user.id,
            type: badge.id
          }
        });
        
        // Даём XP за бейдж
        await awardXP(userId, 'badge_earned');
        
        badgesEarned.push(badge.name);
      }
    }
  }
  
  return {
    xpAwarded,
    newLevel: oldLevel.id !== newLevel.id ? newLevel : undefined,
    badgesEarned
  };
}

export async function getUserProfile(userId: string): Promise<{
  xp: number;
  level: Level;
  progress: any;
  badges: any[];
  rank?: number;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { badges: true }
  });
  
  if (!user) throw new Error('User not found');
  
  const level = await getUserLevel(userId);
  const progress = await calculateProgressToNextLevel(userId);
  
  // Получаем ранк пользователя (по XP)
  const allUsers = await prisma.user.findMany({
    where: { xp: { gt: 0 } },
    orderBy: { xp: 'desc' },
    select: { id: true }
  });
  
  const rank = allUsers.findIndex(u => u.id === userId) + 1;
  
  return {
    xp: user.xp || 0,
    level,
    progress,
    badges: user.badges,
    rank: rank > 0 ? rank : undefined
  };
}

// ─── Форматирование для Telegram ──────────────────────────────────────────

export function formatLevelProgress(progress: any): string {
  const barLength = 10;
  const filled = Math.round((progress.progressPercent / 100) * barLength);
  const empty = barLength - filled;
  
  const progressBar = '▓'.repeat(filled) + '░'.repeat(empty);
  
  let text = `🎮 Уровень: ${progress.currentLevel.badge} ${progress.currentLevel.name}\n`;
  text += `📊 XP: ${progress.currentXP} / ${progress.nextLevel?.minXP || 'MAX'}\n`;
  text += `${progressBar} ${Math.round(progress.progressPercent)}%\n`;
  
  if (progress.nextLevel) {
    text += `⬆️ До ${progress.nextLevel.badge} ${progress.nextLevel.name}: ${progress.xpToNextLevel} XP\n`;
  }
  
  return text;
}

export function formatBadges(badges: any[]): string {
  if (badges.length === 0) return '🎖️ Бейджей пока нет';
  
  let text = '🎖️ Ваши бейджи:\n';
  for (const badge of badges.slice(0, 10)) {
    const badgeDef = BADGES.find(b => b.id === badge.type);
    if (badgeDef) {
      text += `${badgeDef.icon} ${badgeDef.name}\n`;
    }
  }
  
  if (badges.length > 10) {
    text += `... и ещё ${badges.length - 10} бейджей`;
  }
  
  return text;
}
