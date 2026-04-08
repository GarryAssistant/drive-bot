import { prisma } from './prisma.service';

// ─── Badge definitions ────────────────────────────────────────────────────────
export const BADGES: Record<string, { emoji: string; title: string; description: string }> = {
  first_entry:   { emoji: '🌱', title: 'Первый шаг',      description: 'Добавил первую запись' },
  streak_3:      { emoji: '🔥', title: '3 дня подряд',    description: 'Стрик 3 дня' },
  streak_7:      { emoji: '⚡️', title: 'Неделя без пауз', description: 'Стрик 7 дней' },
  streak_14:     { emoji: '💎', title: '2 недели',         description: 'Стрик 14 дней' },
  streak_30:     { emoji: '👑', title: 'Месяц силы',       description: 'Стрик 30 дней' },
  streak_60:     { emoji: '🏆', title: '2 месяца!',        description: 'Стрик 60 дней' },
  streak_100:    { emoji: '🚀', title: '100 дней',         description: 'Легендарный стрик 100 дней' },
  entries_10:    { emoji: '📝', title: '10 записей',       description: '10 дней в трекере' },
  entries_30:    { emoji: '📚', title: '30 записей',       description: '30 дней в трекере' },
  entries_50:    { emoji: '🎖',  title: '50 записей',      description: '50 дней в трекере' },
  score_100:     { emoji: '💯', title: 'Идеальный день',   description: 'Оценка 100/100' },
  comeback:      { emoji: '💪', title: 'Камбэк',           description: 'Вернулся после паузы >3 дней' },
};

// Check and award badges after an entry. Returns list of newly earned badges.
export async function checkAndAwardBadges(
  userId: string,
  streak: number,
  totalEntries: number,
  todayScore: number,
  prevStreak: number,
): Promise<string[]> {
  const earned: string[] = [];

  const candidates: string[] = [];

  if (totalEntries === 1)  candidates.push('first_entry');
  if (streak >= 3)         candidates.push('streak_3');
  if (streak >= 7)         candidates.push('streak_7');
  if (streak >= 14)        candidates.push('streak_14');
  if (streak >= 30)        candidates.push('streak_30');
  if (streak >= 60)        candidates.push('streak_60');
  if (streak >= 100)       candidates.push('streak_100');
  if (totalEntries >= 10)  candidates.push('entries_10');
  if (totalEntries >= 30)  candidates.push('entries_30');
  if (totalEntries >= 50)  candidates.push('entries_50');
  if (todayScore >= 100)   candidates.push('score_100');
  if (prevStreak === 0 && streak === 1 && totalEntries > 3) candidates.push('comeback');

  for (const type of candidates) {
    try {
      await prisma.badge.create({ data: { userId, type } });
      earned.push(type);
    } catch {
      // Already exists (unique constraint) — skip
    }
  }

  return earned;
}

// Format badge award message
export function formatBadgeMessage(type: string): string {
  const b = BADGES[type];
  if (!b) return '';
  return `\n\n🏅 *Новый бейдж: ${b.emoji} ${b.title}*\n_${b.description}_`;
}
