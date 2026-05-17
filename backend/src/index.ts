import { checkDatabaseHealth } from './services/database.service';
import { redisService } from './services/redis.service';
import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';

import { authRoutes } from './routes/auth.routes';
import { goalsRoutes } from './routes/goals.routes';
import { entriesRoutes } from './routes/entries.routes';
import { progressRoutes } from './routes/progress.routes';
import { adminRoutes } from './routes/admin.routes';
import { prisma } from './services/prisma.service';
import { scheduleDailyReminder, scheduleWeeklyReport, scheduleWeeklyPlan, scheduleMorningDigest } from './services/notification.service';
import { startBot } from './services/bot.service';

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    transport:
      process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
});

async function bootstrap() {
  // ─── Plugins ─────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',')
      : true,  // allow all (frontend served from same domain)
    credentials: true,
  });

  await app.register(jwt, {
    secret: process.env.JWT_SECRET || 'fallback-dev-secret',
  });

  await app.register(rateLimit, {
    max: 60,          // 60 запросов
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: 'Too Many Requests',
      message: 'Slow down! Max 60 requests per minute.',
    }),
  });

  // ─── Routes ──────────────────────────────────────────────────────────────
  await app.register(authRoutes,     { prefix: '/api/v1' });
  await app.register(goalsRoutes,    { prefix: '/api/v1' });
  await app.register(entriesRoutes,  { prefix: '/api/v1' });
  await app.register(progressRoutes, { prefix: '/api/v1' });
  await app.register(adminRoutes);

  


  // ─── Health check ─────────────────────────────────────────────────────────
  app.get('/health', async () => {
    const dbHealth = await checkDatabaseHealth();
    const redisHealth = await redisService.healthCheck();
    const uptime = process.uptime();
    const memory = process.memoryUsage();
    
    return {
      status: dbHealth.status === 'healthy' && redisHealth ? 'ok' : 'degraded',
      uptime: Math.floor(uptime),
      memory: {
        rss: Math.round(memory.rss / 1024 / 1024),
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
      },
      database: dbHealth,
      redis: redisHealth,
      timestamp: new Date().toISOString(),
    };
  });

  // ─── Global error handler ─────────────────────────────────────────────────
  app.setErrorHandler((error, request, reply) => {
    // Zod validation errors
    if (error.name === 'ZodError') {
      return reply.code(400).send({
        error: 'Validation Error',
        details: JSON.parse(error.message),
      });
    }
    // Prisma unique constraint
    if (error.message?.includes('Unique constraint')) {
      return reply.code(409).send({
        error: 'Conflict',
        message: 'Resource already exists',
      });
    }

    app.log.error(error);
    reply.code(error.statusCode || 500).send({
      error: error.name || 'Internal Server Error',
      message:
        process.env.NODE_ENV === 'production'
          ? 'Something went wrong'
          : error.message,
    });
  });

  // ─── Cron jobs ────────────────────────────────────────────────────────────
  scheduleDailyReminder();
  scheduleWeeklyReport();
  scheduleMorningDigest();

  // ─── Telegram Bot ─────────────────────────────────────────────────────────
  startBot();

  // ─── Start ────────────────────────────────────────────────────────────────
  const port = parseInt(process.env.PORT || '3000');
  await app.listen({ port, host: '0.0.0.0' });

  console.log(`\n🚀 Goal Tracker API running at http://localhost:${port}`);
  console.log(`📋 Routes:`);
  console.log(`   POST /api/v1/auth/dev          — dev login`);
  console.log(`   POST /api/v1/auth/telegram     — telegram login`);
  console.log(`   GET  /api/v1/goals/active      — active goal`);
  console.log(`   POST /api/v1/goals             — create goal`);
  console.log(`   POST /api/v1/entries           — add day entry`);
  console.log(`   GET  /api/v1/entries/today     — today's entry`);
  console.log(`   GET  /api/v1/progress          — dashboard data`);
  console.log(`   GET  /api/v1/progress/chart    — chart data`);
  console.log(`   GET  /api/v1/progress/weekly-report — AI report`);
  console.log(`   GET  /health                   — health check\n`);
}

// ─── Graceful shutdown ────────────────────────────────────────────────────

const shutdown = async (signal: string) => {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
