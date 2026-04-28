import Redis from 'ioredis';

// Конфигурация Redis
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const SESSION_TTL = 60 * 60 * 24; // 24 часа
const CACHE_TTL = 60 * 5; // 5 минут

class RedisService {
  private client: Redis;

  constructor() {
    this.client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 1000,
      enableReadyCheck: true,
    });

    this.client.on('error', (err) => {
      console.error('Redis error:', err);
    });

    this.client.on('connect', () => {
      console.log('✅ Redis connected');
    });
  }

  // Сессии пользователей
  async setSession(userId: number, data: any): Promise<void> {
    const key = `session:${userId}`;
    await this.client.setex(key, SESSION_TTL, JSON.stringify(data));
  }

  async getSession(userId: number): Promise<any | null> {
    const key = `session:${userId}`;
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async deleteSession(userId: number): Promise<void> {
    const key = `session:${userId}`;
    await this.client.del(key);
  }

  // Кеширование частых запросов
  async cacheGet(key: string): Promise<any | null> {
    const data = await this.client.get(`cache:${key}`);
    return data ? JSON.parse(data) : null;
  }

  async cacheSet(key: string, data: any, ttl: number = CACHE_TTL): Promise<void> {
    await this.client.setex(`cache:${key}`, ttl, JSON.stringify(data));
  }

  async cacheDelete(key: string): Promise<void> {
    await this.client.del(`cache:${key}`);
  }

  // Статистика пользователей (для мониторинга)
  async incrementUserStat(stat: string, value: number = 1): Promise<number> {
    const key = `stats:${stat}`;
    return await this.client.incrby(key, value);
  }

  async getUserStat(stat: string): Promise<number> {
    const key = `stats:${stat}`;
    const value = await this.client.get(key);
    return parseInt(value || '0', 10);
  }

  // Очистка всех данных (для тестов)
  async flushAll(): Promise<void> {
    await this.client.flushall();
  }

  // Проверка здоровья
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch (err) {
      return false;
    }
  }
}

export const redisService = new RedisService();
