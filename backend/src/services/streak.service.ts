import { prisma } from './prisma.service';

/**
 * Обновляет стрик пользователя после новой записи.
 * Логика: если последняя запись была вчера — стрик +1.
 *         если сегодня — уже засчитано, ничего не меняем.
 *         если позавчера или раньше — стрик сбрасывается до 1.
 */
export async function updateStreak(
  userId: string,
  goalId: string,
  entryDate: Date,
  totalScore: number
): Promise<{ currentStreak: number; longestStreak: number; isNew: boolean }> {
  const today = toDateOnly(entryDate);

  const stats = await prisma.userStats.findUnique({ where: { userId } });

  if (!stats) {
    // Первая запись — создаём
    const created = await prisma.userStats.create({
      data: {
        userId,
        goalId,
        currentStreak: 1,
        longestStreak: 1,
        totalScore,
        totalEntries: 1,
        lastEntryDate: today,
        progressPercent: calculateProgress(totalScore, 1),
      },
    });
    return { currentStreak: 1, longestStreak: 1, isNew: true };
  }

  const lastDate = stats.lastEntryDate ? toDateOnly(stats.lastEntryDate) : null;

  // Уже есть запись сегодня — просто обновляем score
  if (lastDate && isSameDay(lastDate, today)) {
    await prisma.userStats.update({
      where: { userId },
      data: {
        totalScore: { increment: totalScore },
        totalEntries: { increment: 0 }, // не считаем повторный ввод
        progressPercent: calculateProgress(
          stats.totalScore + totalScore,
          stats.totalEntries
        ),
      },
    });
    return {
      currentStreak: stats.currentStreak,
      longestStreak: stats.longestStreak,
      isNew: false,
    };
  }

  const isYesterday = lastDate ? isDayBefore(lastDate, today) : false;
  const newStreak = isYesterday ? stats.currentStreak + 1 : 1;
  const newLongest = Math.max(newStreak, stats.longestStreak);
  const newTotal = stats.totalScore + totalScore;
  const newEntries = stats.totalEntries + 1;

  await prisma.userStats.update({
    where: { userId },
    data: {
      currentStreak: newStreak,
      longestStreak: newLongest,
      totalScore: newTotal,
      totalEntries: newEntries,
      lastEntryDate: today,
      progressPercent: calculateProgress(newTotal, newEntries),
    },
  });

  return { currentStreak: newStreak, longestStreak: newLongest, isNew: true };
}

/**
 * Упрощённый расчёт прогресса: накопленный средний балл / 100
 * В будущем можно заменить на дедлайн-based расчёт
 */
function calculateProgress(totalScore: number, totalEntries: number): number {
  if (totalEntries === 0) return 0;
  const avgScore = totalScore / totalEntries; // 0-100
  // Прогресс = среднее / 100, но ограничиваем 99% пока цель не достигнута явно
  return Math.min(parseFloat((avgScore / 100 * 100).toFixed(1)), 99);
}

// ─── Утилиты для дат ───────────────────────────────────────────────────────

function toDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

function isDayBefore(prev: Date, next: Date): boolean {
  const diff = next.getTime() - prev.getTime();
  return diff === 86400000; // ровно 1 день в мс
}
