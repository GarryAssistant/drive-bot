import { prisma } from './prisma.service';

/**
 * Обновляет стрик пользователя с системой grace period (3 дня пропуска)
 */
export async function updateStreak(
  userId: string,
  goalId: string,
  entryDate: Date,
  totalScore: number
): Promise<{ currentStreak: number; longestStreak: number; isNew: boolean; previousStreak: number; missedDays: number }> {
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
        missedDays: 0,
        lastMissedDate: null,
        gracePeriodUsed: false,
      },
    });
    return { currentStreak: 1, longestStreak: 1, isNew: true, previousStreak: 0, missedDays: 0 };
  }

  const lastDate = stats.lastEntryDate ? toDateOnly(stats.lastEntryDate) : null;
  const lastMissed = stats.lastMissedDate ? toDateOnly(stats.lastMissedDate) : null;

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
        missedDays: 0, // Сбрасываем счётчик пропусков при новой записи
        lastMissedDate: null,
      },
    });
    return {
      currentStreak: stats.currentStreak,
      longestStreak: stats.longestStreak,
      isNew: false,
      previousStreak: stats.currentStreak,
      missedDays: 0,
    };
  }

  // Проверяем сколько дней прошло с последней записи
  const daysSinceLastEntry = lastDate ? Math.floor((today.getTime() - lastDate.getTime()) / 86400000) : 1;
  
  if (daysSinceLastEntry === 1) {
    // Вчера была запись — увеличиваем стрик
    const newStreak = stats.currentStreak + 1;
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
        missedDays: 0, // Сбрасываем пропуски
        lastMissedDate: null,
      },
    });

    return { 
      currentStreak: newStreak, 
      longestStreak: newLongest, 
      isNew: true, 
      previousStreak: stats.currentStreak,
      missedDays: 0 
    };
  } else if (daysSinceLastEntry > 1) {
    // Пропущено несколько дней
    const newMissedDays = stats.missedDays + (daysSinceLastEntry - 1);
    
    if (newMissedDays >= 3) {
      // Пропущено 3+ дней — сбрасываем стрик
      await prisma.userStats.update({
        where: { userId },
        data: {
          currentStreak: 1,
          totalScore: stats.totalScore + totalScore,
          totalEntries: stats.totalEntries + 1,
          lastEntryDate: today,
          progressPercent: calculateProgress(stats.totalScore + totalScore, stats.totalEntries + 1),
          missedDays: 0, // Сбрасываем после сброса стрика
          lastMissedDate: null,
          gracePeriodUsed: false, // Сбрасываем флаг grace period
        },
      });

      // Возвращаем информацию для отправки уведомления о сбросе
      return { 
        currentStreak: 1, 
        longestStreak: stats.longestStreak, 
        isNew: true, 
        previousStreak: stats.currentStreak,
        missedDays: 0 
      };
    } else {
      // Grace period: пропущено меньше 3 дней
      const newStreak = stats.currentStreak; // Сохраняем текущий стрик
      const newTotal = stats.totalScore + totalScore;
      const newEntries = stats.totalEntries + 1;

      await prisma.userStats.update({
        where: { userId },
        data: {
          currentStreak: newStreak,
          totalScore: newTotal,
          totalEntries: newEntries,
          lastEntryDate: today,
          progressPercent: calculateProgress(newTotal, newEntries),
          missedDays: newMissedDays,
          lastMissedDate: today,
        },
      });

      // Возвращаем информацию для отправки предупреждения
      return { 
        currentStreak: newStreak, 
        longestStreak: stats.longestStreak, 
        isNew: true, 
        previousStreak: stats.currentStreak,
        missedDays: newMissedDays 
      };
    }
  }

  // Первая запись после создания аккаунта
  const newStreak = 1;
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
      missedDays: 0,
      lastMissedDate: null,
    },
  });

  return { 
    currentStreak: newStreak, 
    longestStreak: newLongest, 
    isNew: true, 
    previousStreak: stats.currentStreak,
    missedDays: 0 
  };
}

/**
 * Проверяет пропущенные дни и отправляет предупреждения
 */
export async function checkMissedDaysAndNotify(userId: string): Promise<{ missedDays: number; shouldNotify: boolean }> {
  const stats = await prisma.userStats.findUnique({ where: { userId } });
  if (!stats) return { missedDays: 0, shouldNotify: false };

  const today = toDateOnly(new Date());
  const lastEntry = stats.lastEntryDate ? toDateOnly(stats.lastEntryDate) : null;
  
  if (!lastEntry) return { missedDays: 0, shouldNotify: false };

  const daysSinceLastEntry = Math.floor((today.getTime() - lastEntry.getTime()) / 86400000);
  
  if (daysSinceLastEntry > 0) {
    // Есть пропущенные дни
    const newMissedDays = stats.missedDays + daysSinceLastEntry;
    
    // Обновляем счётчик пропусков
    await prisma.userStats.update({
      where: { userId },
      data: {
        missedDays: newMissedDays,
        lastMissedDate: today,
      },
    });

    // Определяем нужно ли отправлять уведомление
    const shouldNotify = 
      (stats.missedDays === 0 && newMissedDays === 1) || // Первый пропуск
      (stats.missedDays === 1 && newMissedDays === 2) || // Второй пропуск
      (newMissedDays >= 3); // Третий пропуск или больше

    return { missedDays: newMissedDays, shouldNotify };
  }

  return { missedDays: stats.missedDays, shouldNotify: false };
}

/**
 * Прогресс считается от консистентности, а не от среднего балла.
 */
function calculateProgress(totalScore: number, totalEntries: number): number {
  if (totalEntries === 0) return 40;
  
  const avgScore = totalScore / totalEntries;
  const baseStep = 1.5;
  const qualityMultiplier = avgScore >= 70 ? 1.4 : avgScore >= 50 ? 1.1 : 0.85;
  
  const progressAboveFloor = Math.min(totalEntries * baseStep * qualityMultiplier, 59);
  const total = 40 + progressAboveFloor;
  
  return Math.min(parseFloat(total.toFixed(1)), 99);
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
  return diff === 86400000;
}
