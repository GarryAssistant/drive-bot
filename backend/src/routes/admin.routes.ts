import { FastifyInstance } from 'fastify';
import { prisma } from '../services/prisma.service';

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'dev-admin-secret-123';

export async function adminRoutes(app: FastifyInstance) {
  console.log("[Admin] Dashboard registered at /admin/*");

  // ─── Full dashboard with all analytics ────────────────────────────────────
  app.get('/admin/dashboard', async (request, reply) => {
    const secret = (request.headers['x-admin-secret'] as string) || 
                   (request.query as any).secret;
    
    if (secret !== ADMIN_SECRET) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const now = new Date();
    const day1 = new Date(now.getTime() - 1 * 86400000);
    const day7 = new Date(now.getTime() - 7 * 86400000);
    const day30 = new Date(now.getTime() - 30 * 86400000);

    const [
      totalUsers,
      usersWithGoal,
      usersDAU,
      usersWAU,
      usersMAU,
      totalGoals,
      totalEntries,
      entriesLast7,
      totalFeedbacks,
      avgScoreResult,
      badgesCount,
      feedbackWithRatings,
      abStats,
      topHour,
      dailySignups,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { goals: { some: { isActive: true } } } }),
      prisma.user.count({ where: { entries: { some: { createdAt: { gte: day1 } } } } }),
      prisma.user.count({ where: { entries: { some: { createdAt: { gte: day7 } } } } }),
      prisma.user.count({ where: { entries: { some: { createdAt: { gte: day30 } } } } }),
      prisma.goal.count(),
      prisma.entry.count(),
      prisma.entry.count({ where: { createdAt: { gte: day7 } } }),
      prisma.feedback.count(),
      prisma.entry.aggregate({ _avg: { totalScore: true } }),
      prisma.badge.groupBy({ by: ['type'], _count: { id: true }, orderBy: { _count: { id: 'desc' } } }),
      prisma.feedback.count({ where: { rating: { not: null } } }),
      prisma.user.groupBy({ by: ['abVariant'], _count: { id: true } }),
      prisma.user.groupBy({ by: ['notifyHour'], _count: { id: true }, orderBy: { _count: { id: 'desc' } }, take: 1 }),
      prisma.$queryRawUnsafe("SELECT DATE(created_at) as day, count(*)::int as new_users FROM users GROUP BY day ORDER BY day DESC LIMIT 60"),
    ]);

    // Retention
    const usersOlderThan7d = await prisma.user.count({ where: { createdAt: { lte: day7 } } });
    const returnedOld = usersOlderThan7d > 0
      ? await prisma.user.count({
          where: {
            createdAt: { lte: day7 },
            entries: { some: { createdAt: { gte: day7 } } },
          },
        })
      : 0;
    const retention7d = usersOlderThan7d > 0 ? ((returnedOld / usersOlderThan7d) * 100).toFixed(1) : 'N/A';

    const usersOlderThan30d = await prisma.user.count({ where: { createdAt: { lte: day30 } } });
    const returnedOld30 = usersOlderThan30d > 0
      ? await prisma.user.count({
          where: {
            createdAt: { lte: day30 },
            entries: { some: { createdAt: { gte: day30 } } },
          },
        })
      : 0;
    const retention30d = usersOlderThan30d > 0 ? ((returnedOld30 / usersOlderThan30d) * 100).toFixed(1) : 'N/A';

    const avgScore = avgScoreResult._avg.totalScore?.toFixed(1) ?? 0;
    const conversionRate = totalUsers > 0 ? ((usersWithGoal / totalUsers) * 100).toFixed(1) : '0';
    const mostUsedHour = topHour.length > 0 ? topHour[0].notifyHour : null;

    // Level distribution
    const levels = [
      { id: 1, name: 'Новичок', minXP: 0 },
      { id: 2, name: 'Практик', minXP: 1000 },
      { id: 3, name: 'Мастер', minXP: 5000 },
      { id: 4, name: 'Легенда', minXP: 20000 },
    ];
    const levelDist: any[] = [];
    const users = await prisma.user.findMany({ select: { xp: true } });
    for (const lv of levels) {
      const nextMin = levels.find(l => l.id === lv.id + 1)?.minXP ?? Infinity;
      const count = users.filter(u => u.xp >= lv.minXP && u.xp < nextMin).length;
      levelDist.push({ level: lv.name, xpFrom: lv.minXP, count });
    }

    return {
      overview: {
        totalUsers,
        usersWithActiveGoal: usersWithGoal,
        conversionToGoal: parseFloat(conversionRate),
        totalGoals,
        totalEntries,
        avgScore: Number(avgScore),
        mostUsedNotifyHour: mostUsedHour,
      },
      activity: {
        dau: usersDAU,
        wau: usersWAU,
        mau: usersMAU,
        entriesLast7Days: entriesLast7,
      },
      retention: {
        day7: retention7d === 'N/A' ? null : parseFloat(retention7d),
        day30: retention30d === 'N/A' ? null : parseFloat(retention30d),
      },
      signups: { daily: dailySignups },
      feedback: {
        total: totalFeedbacks,
        withRating: feedbackWithRatings,
      },
      badges: badgesCount.map(b => ({ type: b.type, count: b._count.id })),
      abTest: abStats.map(a => ({ variant: a.abVariant, users: a._count.id })),
      levelDistribution: levelDist,
      topUsers: await prisma.user.findMany({
        orderBy: { xp: 'desc' },
        take: 30,
        select: {
          telegramId: true, username: true, firstName: true,
          xp: true, createdAt: true, notifyEnabled: true, abVariant: true,
          _count: { select: { goals: true, entries: true, badges: true } },
        },
      }),
    };
  });

  // ─── Legacy stats endpoint ────────────────────────────────────────────────
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
        telegramId: true, username: true, firstName: true,
        xp: true, createdAt: true, notifyEnabled: true, abVariant: true,
        _count: { select: { goals: true, entries: true } },
      },
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
      dailySignups,
    };
  });
}
