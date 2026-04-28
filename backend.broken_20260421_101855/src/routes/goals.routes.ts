import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../services/prisma.service';
import { authenticate } from '../middleware/auth';
import { suggestSubcategories } from '../services/ai.service';

const CreateGoalSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(1000).optional(),
  deadline: z.string().datetime().optional(),
});

const UpdateSubcategoriesSchema = z.object({
  subcategories: z.array(
    z.object({
      name: z.string().min(1).max(50),
      emoji: z.string().max(10),
      weight: z.number().min(0.01).max(1),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    })
  ),
});

export async function goalsRoutes(app: FastifyInstance) {
  // ─── Получить активную цель пользователя ───────────────────────────────
  app.get(
    '/goals/active',
    { preHandler: authenticate },
    async (request, reply) => {
      const goal = await prisma.goal.findFirst({
        where: { userId: request.userId, isActive: true },
        include: {
          subcategories: { orderBy: { weight: 'desc' } },
          _count: { select: { entries: true } },
        },
      });

      if (!goal) return reply.code(404).send({ error: 'No active goal' });

      const stats = await prisma.userStats.findUnique({
        where: { userId: request.userId },
      });

      return reply.send({ goal, stats });
    }
  );

  // ─── Получить все цели ─────────────────────────────────────────────────
  app.get(
    '/goals',
    { preHandler: authenticate },
    async (request, reply) => {
      const goals = await prisma.goal.findMany({
        where: { userId: request.userId },
        include: { subcategories: true },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send({ goals });
    }
  );

  // ─── Создать цель + AI предлагает подкатегории ─────────────────────────
  app.post(
    '/goals',
    { preHandler: authenticate },
    async (request, reply) => {
      const body = CreateGoalSchema.parse(request.body);

      // Деактивируем предыдущую цель
      await prisma.goal.updateMany({
        where: { userId: request.userId, isActive: true },
        data: { isActive: false },
      });

      // AI предлагает подкатегории
      const suggested = await suggestSubcategories(body.title, body.description);

      const goal = await prisma.goal.create({
        data: {
          userId: request.userId,
          title: body.title,
          description: body.description,
          deadline: body.deadline ? new Date(body.deadline) : null,
          subcategories: {
            create: suggested.map((s) => ({
              name: s.name,
              emoji: s.emoji,
              weight: s.weight,
              color: s.color,
            })),
          },
        },
        include: { subcategories: true },
      });

      return reply.code(201).send({ goal, suggested });
    }
  );

  // ─── Обновить подкатегории (пользователь может отредактировать предложение AI) ─
  app.put(
    '/goals/:goalId/subcategories',
    { preHandler: authenticate },
    async (request, reply) => {
      const { goalId } = request.params as { goalId: string };
      const body = UpdateSubcategoriesSchema.parse(request.body);

      // Проверяем владение
      const goal = await prisma.goal.findFirst({
        where: { id: goalId, userId: request.userId },
      });
      if (!goal) return reply.code(404).send({ error: 'Goal not found' });

      // Нормализуем веса чтобы сумма = 1
      const totalWeight = body.subcategories.reduce((s, c) => s + c.weight, 0);
      const normalized = body.subcategories.map((c) => ({
        ...c,
        weight: parseFloat((c.weight / totalWeight).toFixed(3)),
      }));

      // Пересоздаём подкатегории
      await prisma.subcategory.deleteMany({ where: { goalId } });
      await prisma.subcategory.createMany({
        data: normalized.map((c) => ({ ...c, goalId })),
      });

      const updated = await prisma.subcategory.findMany({
        where: { goalId },
        orderBy: { weight: 'desc' },
      });

      return reply.send({ subcategories: updated });
    }
  );

  // ─── Удалить цель ──────────────────────────────────────────────────────
  app.delete(
    '/goals/:goalId',
    { preHandler: authenticate },
    async (request, reply) => {
      const { goalId } = request.params as { goalId: string };

      const goal = await prisma.goal.findFirst({
        where: { id: goalId, userId: request.userId },
      });
      if (!goal) return reply.code(404).send({ error: 'Goal not found' });

      await prisma.goal.delete({ where: { id: goalId } });

      return reply.send({ success: true });
    }
  );
}
