import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../services/prisma.service';
import { authenticate } from '../middleware/auth';
import { analyzeEntry } from '../services/ai.service';
import { updateStreak } from '../services/streak.service';

const CreateEntrySchema = z.object({
  rawText: z.string().min(5).max(3000),
  date: z.string().optional(), // ISO date string, default = today
});

export async function entriesRoutes(app: FastifyInstance) {
  /**
   * POST /entries
   * Главный endpoint: принимает текст дня, запускает AI-анализ, сохраняет результат
   */
  app.post(
    '/entries',
    { preHandler: authenticate },
    async (request, reply) => {
      const body = CreateEntrySchema.parse(request.body);

      // Берём активную цель
      const goal = await prisma.goal.findFirst({
        where: { userId: request.userId, isActive: true },
        include: { subcategories: { orderBy: { weight: 'desc' } } },
      });

      if (!goal) {
        return reply.code(400).send({
          error: 'No active goal',
          message: 'Create a goal first before adding entries',
        });
      }

      if (goal.subcategories.length === 0) {
        return reply.code(400).send({
          error: 'No subcategories',
          message: 'Add subcategories to your goal first',
        });
      }

      const entryDate = body.date ? new Date(body.date) : new Date();
      const dateOnly = new Date(
        Date.UTC(entryDate.getFullYear(), entryDate.getMonth(), entryDate.getDate())
      );

      // Проверяем — нет ли уже записи за этот день
      const existing = await prisma.entry.findUnique({
        where: {
          userId_goalId_date: {
            userId: request.userId,
            goalId: goal.id,
            date: dateOnly,
          },
        },
        include: { entryScores: { include: { subcategory: true } } },
      });

      if (existing) {
        return reply.code(409).send({
          error: 'Entry already exists',
          message: 'You already have an entry for today',
          entry: existing,
        });
      }

      // ── AI анализ ──────────────────────────────────────────────────────
      const subcategoryNames = goal.subcategories.map((s) => s.name);
      const analysis = await analyzeEntry(body.rawText, goal.title, subcategoryNames);

      // ── Сохраняем запись и баллы ───────────────────────────────────────
      const entry = await prisma.entry.create({
        data: {
          userId: request.userId,
          goalId: goal.id,
          rawText: body.rawText,
          date: dateOnly,
          totalScore: analysis.totalScore,
          aiComment: analysis.overallComment,
          entryScores: {
            create: analysis.subcategories
              .map((aiScore) => {
                const subcategory = goal.subcategories.find(
                  (s) => s.name.toLowerCase() === aiScore.name.toLowerCase()
                );
                if (!subcategory) return null;
                return {
                  subcategoryId: subcategory.id,
                  score: aiScore.score,
                  actions: aiScore.actions,
                  aiComment: aiScore.comment,
                };
              })
              .filter((s): s is NonNullable<typeof s> => s !== null),
          },
        },
        include: {
          entryScores: { include: { subcategory: true } },
        },
      });

      // ── Обновляем стрик ────────────────────────────────────────────────
      const streakResult = await updateStreak(
        request.userId,
        goal.id,
        dateOnly,
        analysis.totalScore
      );

      return reply.code(201).send({
        entry,
        analysis: {
          totalScore: analysis.totalScore,
          overallComment: analysis.overallComment,
          strengths: analysis.strengths,
          suggestions: analysis.suggestions,
          subcategories: analysis.subcategories,
        },
        streak: streakResult,
      });
    }
  );

  /**
   * GET /entries
   * История записей с пагинацией
   */
  app.get(
    '/entries',
    { preHandler: authenticate },
    async (request, reply) => {
      const query = (request.query as Record<string, string>);
      const page = parseInt(query.page || '1');
      const limit = Math.min(parseInt(query.limit || '20'), 50);
      const skip = (page - 1) * limit;

      const goal = await prisma.goal.findFirst({
        where: { userId: request.userId, isActive: true },
      });
      if (!goal) return reply.code(404).send({ error: 'No active goal' });

      const [entries, total] = await Promise.all([
        prisma.entry.findMany({
          where: { userId: request.userId, goalId: goal.id },
          include: {
            entryScores: { include: { subcategory: true } },
          },
          orderBy: { date: 'desc' },
          skip,
          take: limit,
        }),
        prisma.entry.count({
          where: { userId: request.userId, goalId: goal.id },
        }),
      ]);

      return reply.send({
        entries,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    }
  );

  /**
   * GET /entries/:id
   * Одна запись с полным AI-разбором
   */
  app.get(
    '/entries/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const entry = await prisma.entry.findFirst({
        where: { id, userId: request.userId },
        include: {
          entryScores: { include: { subcategory: true } },
          goal: { include: { subcategories: true } },
        },
      });

      if (!entry) return reply.code(404).send({ error: 'Entry not found' });

      return reply.send({ entry });
    }
  );

  /**
   * GET /entries/today
   * Быстрая проверка — есть ли уже запись сегодня
   */
  app.get(
    '/entries/today',
    { preHandler: authenticate },
    async (request, reply) => {
      const goal = await prisma.goal.findFirst({
        where: { userId: request.userId, isActive: true },
      });
      if (!goal) return reply.send({ hasEntry: false, entry: null });

      const now = new Date();
      const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

      const entry = await prisma.entry.findUnique({
        where: {
          userId_goalId_date: {
            userId: request.userId,
            goalId: goal.id,
            date: today,
          },
        },
        include: { entryScores: { include: { subcategory: true } } },
      });

      return reply.send({ hasEntry: !!entry, entry });
    }
  );
}
