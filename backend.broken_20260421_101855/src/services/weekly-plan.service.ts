import { Context } from 'telegraf';
import { prisma } from './prisma.service';
import { generateWeeklyPlan } from './ai.service';

function getMondayUTC(date: Date = new Date()): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

export async function handleWeeklyPlanCommand(ctx: Context): Promise<void> {
  const tgId = String(ctx.from!.id);
  const user = await prisma.user.findUnique({ where: { telegramId: tgId } });
  if (!user) { await ctx.reply('Сначала /start'); return; }

  const goal = await prisma.goal.findFirst({
    where: { userId: user.id, isActive: true },
    include: { subcategories: { orderBy: { weight: 'desc' } } },
  });
  if (!goal) { await ctx.reply('Нет активной цели. Используй /goal 🎯'); return; }

  // Check if plan already exists for this week
  const weekStart = getMondayUTC();
  const existing = await (prisma as any).weeklyPlan.findUnique({
    where: { userId_weekStart: { userId: user.id, weekStart } },
  });
  if (existing) {
    const created = new Date(existing.createdAt).toLocaleDateString('ru-RU');
    await ctx.reply(
      `📅 *План на эту неделю* _(создан ${created})_\n\n${existing.planText}`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Get last 7 days stats
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  const recentEntries = await prisma.entry.findMany({
    where: { userId: user.id, goalId: goal.id, date: { gte: sevenDaysAgo } },
    include: { entryScores: { include: { subcategory: true } } },
    orderBy: { date: 'asc' },
  });

  await ctx.reply('🤖 AI составляет план на неделю...');

  const entrySummary = recentEntries.map(e => ({
    date: e.date.toLocaleDateString('ru-RU'),
    totalScore: e.totalScore,
    topCategories: e.entryScores.sort((a, b) => b.score - a.score).slice(0, 2).map(s => s.subcategory.name),
  }));

  try {
    const plan = await generateWeeklyPlan(
      goal.title,
      goal.subcategories.map(s => ({ name: s.name, emoji: s.emoji, weight: s.weight })),
      entrySummary
    );

    // Save plan
    await (prisma as any).weeklyPlan.create({
      data: {
        userId: user.id,
        goalId: goal.id,
        weekStart,
        planText: plan.planText,
        aiInsights: plan.insights,
      },
    });

    await ctx.reply(plan.planText, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('[WeeklyPlan] Error:', err);
    await ctx.reply('❌ Не удалось сгенерировать план. Попробуй позже.');
  }
}

// Called by notification scheduler on Sunday evening
export async function sendWeeklyPlans(bot: any): Promise<void> {
  const users = await prisma.user.findMany({
    where: { notifyEnabled: true, goals: { some: { isActive: true } } },
    include: { goals: { where: { isActive: true }, include: { subcategories: { orderBy: { weight: 'desc' } } } } },
  });

  const weekStart = getMondayUTC(new Date(Date.now() + 7 * 86400000)); // next Monday

  for (const user of users) {
    if (!user.telegramId || !user.goals[0]) continue;
    const goal = user.goals[0];

    // Skip if plan already sent
    const exists = await (prisma as any).weeklyPlan.findFirst({
      where: { userId: user.id, weekStart },
    });
    if (exists) continue;

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const entries = await prisma.entry.findMany({
      where: { userId: user.id, goalId: goal.id, date: { gte: sevenDaysAgo } },
      include: { entryScores: { include: { subcategory: true } } },
      orderBy: { date: 'asc' },
    });

    if (entries.length < 2) continue; // not enough data

    try {
      const summary = entries.map(e => ({
        date: e.date.toLocaleDateString('ru-RU'),
        totalScore: e.totalScore,
        topCategories: e.entryScores.sort((a, b) => b.score - a.score).slice(0, 2).map(s => s.subcategory.name),
      }));

      const plan = await generateWeeklyPlan(
        goal.title,
        goal.subcategories.map(s => ({ name: s.name, emoji: s.emoji, weight: s.weight })),
        summary
      );

      await (prisma as any).weeklyPlan.create({
        data: { userId: user.id, goalId: goal.id, weekStart, planText: plan.planText, aiInsights: plan.insights },
      });

      await bot.telegram.sendMessage(user.telegramId, plan.planText, { parse_mode: 'Markdown' });
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`[WeeklyPlan] Failed for ${user.telegramId}:`, err);
    }
  }
}
