import { FastifyInstance } from 'fastify';
import { prisma } from '../services/prisma.service';
import { authenticate } from '../middleware/auth';
import { generateWeeklyReport } from '../services/ai.service';

export async function progressRoutes(app: FastifyInstance) {
  /**
   * GET /progress
   * Основной дашборд: общий прогресс, стрик, последние 7 дней
   */
  app.get(
    '/progress',
    { preHandler: authenticate },
    async (request, reply) => {
      const goal = await prisma.goal.findFirst({
        where: { userId: request.userId, isActive: true },
        include: { subcategories: { orderBy: { weight: 'desc' } } },
      });

      if (!goal) return reply.code(404).send({ error: 'No active goal' });

      const stats = await prisma.userStats.findUnique({
        where: { userId: request.userId },
      });

      // Последние 30 записей для графика
      const recentEntries = await prisma.entry.findMany({
        where: { userId: request.userId, goalId: goal.id },
        include: { entryScores: { include: { subcategory: true } } },
        orderBy: { date: 'desc' },
        take: 30,
      });

      // Агрегаты по подкатегориям за последние 7 дней
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const weekEntries = recentEntries.filter(
        (e) => new Date(e.date) >= sevenDaysAgo
      );

      const subcategoryTotals = goal.subcategories.map((sub) => {
        const scores = weekEntries.flatMap((e) =>
          e.entryScores.filter((s) => s.subcategoryId === sub.id)
        );
        const avgScore =
          scores.length > 0
            ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length
            : 0;
        return {
          id: sub.id,
          name: sub.name,
          emoji: sub.emoji,
          color: sub.color,
          weight: sub.weight,
          weekAvgScore: parseFloat(avgScore.toFixed(1)),
          weekEntries: scores.length,
        };
      });

      // Прогноз достижения цели
      const forecast = computeForecast(goal.deadline, stats?.progressPercent ?? 0);

      return reply.send({
        goal: {
          id: goal.id,
          title: goal.title,
          deadline: goal.deadline,
        },
        stats: {
          currentStreak: stats?.currentStreak ?? 0,
          longestStreak: stats?.longestStreak ?? 0,
          totalEntries: stats?.totalEntries ?? 0,
          progressPercent: stats?.progressPercent ?? 0,
          lastEntryDate: stats?.lastEntryDate ?? null,
        },
        week: {
          entries: weekEntries.length,
          avgScore:
            weekEntries.length > 0
              ? parseFloat(
                  (
                    weekEntries.reduce((s, e) => s + e.totalScore, 0) /
                    weekEntries.length
                  ).toFixed(1)
                )
              : 0,
          subcategories: subcategoryTotals,
        },
        recentEntries: recentEntries.slice(0, 7).map((e) => ({
          id: e.id,
          date: e.date,
          totalScore: e.totalScore,
          aiComment: e.aiComment,
        })),
        forecast,
      });
    }
  );

  /**
   * GET /progress/chart
   * Данные для графика: баллы по дням + по подкатегориям
   */
  app.get(
    '/progress/chart',
    { preHandler: authenticate },
    async (request, reply) => {
      const query = request.query as Record<string, string>;
      const days = Math.min(parseInt(query.days || '30'), 90);

      const goal = await prisma.goal.findFirst({
        where: { userId: request.userId, isActive: true },
        include: { subcategories: true },
      });
      if (!goal) return reply.code(404).send({ error: 'No active goal' });

      const since = new Date();
      since.setDate(since.getDate() - days);

      const entries = await prisma.entry.findMany({
        where: {
          userId: request.userId,
          goalId: goal.id,
          date: { gte: since },
        },
        include: { entryScores: true },
        orderBy: { date: 'asc' },
      });

      // Заполняем пропущенные дни нулями
      const chartData = fillMissingDays(entries, days);

      // Данные по каждой подкатегории
      const categoryCharts = goal.subcategories.map((sub) => ({
        id: sub.id,
        name: sub.name,
        emoji: sub.emoji,
        color: sub.color,
        data: entries.map((e) => {
          const score = e.entryScores.find((s) => s.subcategoryId === sub.id);
          return { date: e.date, score: score?.score ?? 0 };
        }),
      }));

      return reply.send({ chartData, categoryCharts });
    }
  );

  /**
   * GET /progress/weekly-report
   * AI-отчёт за последнюю неделю
   */
  app.get(
    '/progress/weekly-report',
    { preHandler: authenticate },
    async (request, reply) => {
      const goal = await prisma.goal.findFirst({
        where: { userId: request.userId, isActive: true },
        include: { subcategories: true },
      });
      if (!goal) return reply.code(404).send({ error: 'No active goal' });

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const entries = await prisma.entry.findMany({
        where: {
          userId: request.userId,
          goalId: goal.id,
          date: { gte: sevenDaysAgo },
        },
        include: { entryScores: { include: { subcategory: true } } },
        orderBy: { date: 'asc' },
      });

      if (entries.length === 0) {
        return reply.send({
          report: null,
          message: 'Not enough data for weekly report',
        });
      }

      const summary = entries.map((e) => ({
        date: e.date.toISOString().split('T')[0],
        totalScore: e.totalScore,
        topCategories: e.entryScores
          .sort((a, b) => b.score - a.score)
          .slice(0, 2)
          .map((s) => s.subcategory.name),
      }));

      const report = await generateWeeklyReport(goal.title, summary);

      return reply.send({ report, entriesCount: entries.length });
    }
  );
}

// ─── Утилиты ───────────────────────────────────────────────────────────────

function computeForecast(
  deadline: Date | null,
  progressPercent: number
): { daysLeft: number | null; onTrack: boolean; projectedDays: number | null } {
  const now = new Date();

  if (!deadline) {
    return { daysLeft: null, onTrack: true, projectedDays: null };
  }

  const daysLeft = Math.ceil(
    (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Грубый прогноз: при текущем прогрессе сколько дней до 100%
  const projectedDays =
    progressPercent > 0
      ? Math.ceil((100 - progressPercent) / (progressPercent / 30)) // на основе темпа за 30 дней
      : null;

  const onTrack = projectedDays !== null ? projectedDays <= daysLeft : true;

  return { daysLeft, onTrack, projectedDays };
}

function fillMissingDays(
  entries: { date: Date; totalScore: number }[],
  days: number
): { date: string; score: number; hasEntry: boolean }[] {
  const result: { date: string; score: number; hasEntry: boolean }[] = [];
  const entryMap = new Map(
    entries.map((e) => [e.date.toISOString().split('T')[0], e.totalScore])
  );

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    // Use local date components to match how entries are stored (Date.UTC(local y/m/d))
    const dateStr = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
      .toISOString().split('T')[0];
    const score = entryMap.get(dateStr) ?? 0;
    result.push({ date: dateStr, score, hasEntry: entryMap.has(dateStr) });
  }

  return result;
}
