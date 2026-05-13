import { FastifyInstance } from 'fastify';
import { prisma } from '../services/prisma.service';

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'dev-admin-secret-123';

export async function adminRoutes(app: FastifyInstance) {
  // Admin statistics endpoint
  app.get('/admin/stats', async (request, reply) => {
    const secret = (request.headers['x-admin-secret'] as string) || 
                   (request.query as any).secret;
    
    if (secret !== ADMIN_SECRET) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const totalUsers = await prisma.user.count();
    const withGoals = await prisma.user.count({
      where: { goals: { some: {} } }
    });
    const totalGoals = await prisma.goal.count();
    const totalEntries = await prisma.entry.count();
    
    const topUsers = await prisma.user.findMany({
      orderBy: { xp: 'desc' },
      take: 30,
      select: {
        telegramId: true,
        username: true,
        firstName: true,
        xp: true,
        createdAt: true,
        notifyEnabled: true,
        abVariant: true,
        _count: { select: { goals: true, entries: true } }
      }
    });
    
    const dailySignups = await prisma.$queryRawUnsafe(
      "SELECT DATE(created_at) as day, count(*)::int as new_users FROM users GROUP BY day ORDER BY day DESC LIMIT 60"
    );
    
    return {
      totalUsers,
      usersWithGoals: withGoals,
      totalGoals,
      totalEntries,
      topUsers,
      dailySignups
    };
  });
}
