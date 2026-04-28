import { PrismaClient } from '@prisma/client';

// Connection pooling configuration
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  errorFormat: 'pretty',
  // Connection pooling settings
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

// Health check для базы данных
export async function checkDatabaseHealth(): Promise<{
  status: 'healthy' | 'unhealthy';
  latency: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latency = Date.now() - start;
    return { status: 'healthy', latency };
  } catch (err: any) {
    return { status: 'unhealthy', latency: Date.now() - start, error: err.message };
  }
}

// Статистика подключений
export async function getConnectionStats(): Promise<{
  activeConnections: number;
  idleConnections: number;
  maxConnections: number;
}> {
  try {
    // Для PostgreSQL можно получить статистику подключений
    const result = await prisma.$queryRaw<{ active: number; idle: number; max: number }[]>`
      SELECT 
        (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active,
        (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle') as idle,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max
    `;
    
    return {
      activeConnections: result[0]?.active || 0,
      idleConnections: result[0]?.idle || 0,
      maxConnections: result[0]?.max || 100,
    };
  } catch (err) {
    console.error('Failed to get connection stats:', err);
    return { activeConnections: 0, idleConnections: 0, maxConnections: 100 };
  }
}

export { prisma };
