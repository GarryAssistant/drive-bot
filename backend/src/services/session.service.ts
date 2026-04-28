import { redisService } from './redis.service';

interface SessionData {
  state: 'idle'
    | 'awaiting_about'
    | 'awaiting_goal_type'
    | 'awaiting_goal_details'
    | 'awaiting_income'
    | 'awaiting_life_areas'
    | 'awaiting_strategy'
    | 'awaiting_goal_title'
    | 'awaiting_goal_deadline'
    | 'awaiting_custom_deadline'
    | 'confirming_subcategories'
    | 'awaiting_edit_subcategories'
    | 'awaiting_entry_text'
    | 'awaiting_feedback';
  goalTitle?: string;
  goalDeadline?: Date;
  suggestedSubcategories?: any[];
  about?: string;
  goalType?: string;
  goalTypeEmoji?: string;
  goalTypeLabel?: string;
  goalDetails?: string;
  income?: string;
  lifeAreas?: string[];
  strategy?: string;
  // Дополнительные поля для отслеживания
  createdAt?: Date;
  lastActivity?: Date;
  messageCount?: number;
}

class SessionService {
  async getSession(userId: number): Promise<SessionData | null> {
    const session = await redisService.getSession(userId);
    if (session) {
      // Обновляем время последней активности
      session.lastActivity = new Date();
      session.messageCount = (session.messageCount || 0) + 1;
      await this.setSession(userId, session);
    }
    return session;
  }

  async setSession(userId: number, data: SessionData): Promise<void> {
    if (!data.createdAt) {
      data.createdAt = new Date();
    }
    data.lastActivity = new Date();
    await redisService.setSession(userId, data);
    
    // Логируем активность
    await redisService.incrementUserStat('active_sessions');
  }

  async deleteSession(userId: number): Promise<void> {
    await redisService.deleteSession(userId);
    await redisService.incrementUserStat('ended_sessions');
  }

  async updateSessionState(userId: number, state: SessionData['state'], additionalData?: Partial<SessionData>): Promise<void> {
    let session = await this.getSession(userId);
    if (!session) {
      session = { state, ...additionalData } as SessionData;
    } else {
      session.state = state;
      if (additionalData) {
        Object.assign(session, additionalData);
      }
    }
    await this.setSession(userId, session);
  }

  async clearSession(userId: number): Promise<void> {
    await this.deleteSession(userId);
  }

  // Статистика сессий
  async getSessionStats(): Promise<{
    totalActive: number;
    totalCreated: number;
    avgDuration: number;
  }> {
    // Здесь можно добавить более сложную логику сбора статистики
    const active = await redisService.getUserStat('active_sessions');
    const ended = await redisService.getUserStat('ended_sessions');
    
    return {
      totalActive: active,
      totalCreated: active + ended,
      avgDuration: 0, // Можно рассчитать если хранить время создания
    };
  }

  // Очистка устаревших сессий (можно запускать по cron)
  async cleanupStaleSessions(maxAgeHours: number = 24): Promise<number> {
    // В реальной реализации нужно сканировать ключи session:*
    // и удалять те, которые старше maxAgeHours
    // Для простоты возвращаем 0
    return 0;
  }
}

export const sessionService = new SessionService();
