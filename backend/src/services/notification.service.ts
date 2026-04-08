import cron from 'node-cron';
import { prisma } from './prisma.service';

async function sendTelegramMessage(telegramId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log(`[Notification] → ${telegramId}: ${text.substring(0, 60)}...`);
    return;
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: telegramId, text, parse_mode: 'HTML' }),
  });
  if (!response.ok) {
    const err = await response.text();
    console.error(`[Notification] Failed to send to ${telegramId}: ${err}`);
  }
}

/**
 * Вечернее напоминание — каждый час проверяем у каких пользователей
 * сейчас их час уведомления (по МСК, UTC+3).
 */
export function scheduleDailyReminder(): void {
  // Запускаем каждый час в начале
  cron.schedule('0 * * * *', async () => {
    const nowUTC = new Date();
    const mskHour = (nowUTC.getUTCHours() + 3) % 24;
    const todayUTC = new Date(Date.UTC(nowUTC.getUTCFullYear(), nowUTC.getUTCMonth(), nowUTC.getUTCDate()));

    try {
      const users = await prisma.user.findMany({
        where: {
          telegramId: { not: null },
          notifyEnabled: true,
          notifyHour: mskHour,
          goals: { some: { isActive: true } },
        },
      });

      let sent = 0;
      for (const user of users) {
        if (!user.telegramId) continue;

        // Не отправляли сегодня
        if (user.lastNotifiedAt) {
          const lastDate = new Date(user.lastNotifiedAt);
          if (lastDate >= todayUTC) continue;
        }

        const goal = await prisma.goal.findFirst({ where: { userId: user.id, isActive: true } });
        if (!goal) continue;

        // Нет записи сегодня?
        const entry = await prisma.entry.findUnique({
          where: { userId_goalId_date: { userId: user.id, goalId: goal.id, date: todayUTC } },
        });
        if (entry) continue;

        const stats = await prisma.userStats.findUnique({ where: { userId: user.id } });
        const streak = stats?.currentStreak ?? 0;
        const streakText = streak > 0 ? ` 🔥 Стрик: ${streak} дней` : '';
        const name = user.firstName || user.username || 'друг';

        await sendTelegramMessage(
          user.telegramId,
          `Привет, ${name}! Как прошёл твой день?${streakText}\n\n` +
          `📌 Цель: <b>${goal.title}</b>\n\n` +
          `Напиши, что сделал сегодня — это займёт 1 минуту 💪\n/entry`
        );

        await prisma.user.update({
          where: { id: user.id },
          data: { lastNotifiedAt: todayUTC },
        });
        sent++;
      }

      if (sent > 0) {
        console.log(`[Cron] Daily reminder sent to ${sent} users (MSK hour: ${mskHour})`);
      }
    } catch (err) {
      console.error('[Cron] Daily reminder error:', err);
    }
  });

  console.log('[Notification] Daily reminder scheduled (hourly, sends at user\'s notifyHour MSK)');
}

/**
 * Еженедельный отчёт — воскресенье в 10:00 МСК (07:00 UTC)
 */
export function scheduleWeeklyReport(): void {
  cron.schedule('0 7 * * 0', async () => {
    console.log('[Cron] Running weekly report...');
    try {
      const users = await prisma.user.findMany({
        where: { telegramId: { not: null }, goals: { some: { isActive: true } } },
      });

      let sent = 0;
      for (const user of users) {
        if (!user.telegramId) continue;
        const stats = await prisma.userStats.findUnique({ where: { userId: user.id } });
        if (!stats || stats.totalEntries === 0) continue;
        const goal = await prisma.goal.findFirst({ where: { userId: user.id, isActive: true } });
        if (!goal) continue;

        const name = user.firstName || user.username || 'друг';
        await sendTelegramMessage(
          user.telegramId,
          `📊 <b>Итоги недели, ${name}!</b>\n\n` +
          `📌 Цель: <b>${goal.title}</b>\n` +
          `📈 Прогресс: <b>${stats.progressPercent.toFixed(0)}%</b>\n` +
          `🔥 Стрик: <b>${stats.currentStreak} дней</b>\n` +
          `📝 Всего записей: <b>${stats.totalEntries}</b>\n\n` +
          `Посмотреть AI-анализ недели: /week`
        );
        sent++;
      }
      console.log(`[Cron] Weekly report done (${sent} users)`);
    } catch (err) {
      console.error('[Cron] Weekly report error:', err);
    }
  });
  console.log('[Notification] Weekly report scheduled (Sunday 07:00 UTC / 10:00 MSK)');
}

export async function sendMilestoneNotification(userId: string, milestone: number): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.telegramId) return;
  const messages: Record<number, string> = {
    25: '🎉 Ты прошёл 25% пути к своей цели! Первый квартал позади — так держать!',
    50: '🚀 Половина пути пройдена! Не останавливайся!',
    75: '💥 75%! Финишная прямая. Ещё немного — и цель достигнута!',
    90: '🏁 90%! Ты почти у цели. Не сдавайся!',
  };
  const text = messages[milestone];
  if (text) await sendTelegramMessage(user.telegramId, text);
}
