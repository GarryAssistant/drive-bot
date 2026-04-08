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

// ─── Warm-up messages for users without active goal ──────────────────────────
const WARMUP_MESSAGES = [
  { day: 1, text: `👋 Привет! Рад что ты здесь.\n\nBольшие цели начинаются с первого шага. У тебя есть идея чего хочешь достичь — машина, квартира, бизнес?\n\n🎯 Поставь цель: /goal` },
  { day: 2, text: `💡 Знаешь, в чём секрет людей которые достигают большего?\n\nОни не мотивированы каждый день. Они просто <b>записывают</b> что сделали. Маленький трекинг → большие результаты.\n\n🎯 Начни сегодня: /goal` },
  { day: 3, text: `🚗 Представь: через год ты садишься в машину мечты. Или заходишь в свою квартиру. Или запускаешь бизнес.\n\nЭто начинается сейчас, с одного решения.\n\n🎯 Поставь цель: /goal` },
  { day: 5, text: `📊 Люди с конкретной целью и системой трекинга достигают её в 3x быстрее.\n\nDrive — это твой ежедневный трекер прогресса с AI-анализом.\n\n🎯 Готов начать? /goal` },
  { day: 7, text: `⏰ Неделя прошла. Ты ещё не поставил цель.\n\nЭто нормально — многие откладывают. Но каждый день промедления это минус один день к мечте.\n\n🎯 2 минуты чтобы начать: /goal` },
];

/**
 * Ежедневный прогрев новых юзеров без цели
 */
export function scheduleWarmup(): void {
  cron.schedule('30 9 * * *', async () => { // 12:30 MSK
    const nowUTC = new Date();
    try {
      const usersWithoutGoal = await prisma.user.findMany({
        where: {
          telegramId: { not: null },
          goals: { none: {} },
        },
        select: { id: true, telegramId: true, firstName: true, createdAt: true },
      });

      for (const user of usersWithoutGoal) {
        if (!user.telegramId) continue;
        const daysSinceJoin = Math.floor((nowUTC.getTime() - user.createdAt.getTime()) / 86400000);
        const warmup = WARMUP_MESSAGES.find(m => m.day === daysSinceJoin + 1);
        if (!warmup) continue;

        const name = user.firstName || 'друг';
        await sendTelegramMessage(user.telegramId, `${name}, ${warmup.text}`);
      }
    } catch (err) {
      console.error('[Cron] Warmup error:', err);
    }
  });
  console.log('[Notification] Warmup sequence scheduled');
}

/**
 * Streak protection — предупреждение если юзер не записал за 22:00 МСК
 */
export function scheduleStreakProtection(): void {
  cron.schedule('0 19 * * *', async () => { // 22:00 MSK = 19:00 UTC
    const todayUTC = new Date();
    const todayDate = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), todayUTC.getUTCDate()));

    try {
      const usersWithStreak = await prisma.userStats.findMany({
        where: { currentStreak: { gte: 2 } },
        include: { user: { select: { telegramId: true, firstName: true } } },
      });

      for (const stats of usersWithStreak) {
        if (!stats.user?.telegramId) continue;
        // Check if already recorded today
        const goal = await prisma.goal.findFirst({ where: { userId: stats.userId, isActive: true } });
        if (!goal) continue;

        const entry = await prisma.entry.findUnique({
          where: { userId_goalId_date: { userId: stats.userId, goalId: goal.id, date: todayDate } },
        });
        if (entry) continue;

        const name = stats.user.firstName || 'друг';
        const streak = stats.currentStreak;
        await sendTelegramMessage(
          stats.user.telegramId,
          `⚠️ ${name}, стрик ${streak} дней под угрозой!\n\nЗапиши день за 2 минуты и сохрани серию 🔥\n/entry`
        );
      }
    } catch (err) {
      console.error('[Cron] Streak protection error:', err);
    }
  });
  console.log('[Notification] Streak protection scheduled (19:00 UTC / 22:00 MSK)');
}
