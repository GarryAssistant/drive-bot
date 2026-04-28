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
}

class SessionBackupService {
  // Сохраняем сессию в Redis для восстановления при рестарте
  async backupSession(userId: number, session: SessionData): Promise<void> {
    try {
      await redisService.setSession(userId, session);
      console.log(`✅ Сессия пользователя ${userId} сохранена в Redis`);
    } catch (err) {
      console.error(`❌ Ошибка сохранения сессии ${userId}:`, err);
    }
  }

  // Восстанавливаем сессию из Redis
  async restoreSession(userId: number): Promise<SessionData | null> {
    try {
      const session = await redisService.getSession(userId);
      if (session) {
        console.log(`✅ Сессия пользователя ${userId} восстановлена из Redis`);
        return session;
      }
    } catch (err) {
      console.error(`❌ Ошибка восстановления сессии ${userId}:`, err);
    }
    return null;
  }

  // Удаляем бэкап сессии
  async removeBackup(userId: number): Promise<void> {
    try {
      await redisService.deleteSession(userId);
    } catch (err) {
      console.error(`❌ Ошибка удаления бэкапа сессии ${userId}:`, err);
    }
  }

  // Восстанавливаем все сессии при запуске бота
  async restoreAllSessions(sessions: Map<number, SessionData>): Promise<number> {
    try {
      // В реальной реализации нужно сканировать ключи session:*
      // Для простоты возвращаем 0
      return 0;
    } catch (err) {
      console.error('❌ Ошибка восстановления сессий:', err);
      return 0;
    }
  }

  // Периодическое сохранение всех активных сессий
  async backupAllSessions(sessions: Map<number, SessionData>): Promise<number> {
    let backedUp = 0;
    for (const [userId, session] of sessions.entries()) {
      try {
        await this.backupSession(userId, session);
        backedUp++;
      } catch (err) {
        console.error(`❌ Ошибка бэкапа сессии ${userId}:`, err);
      }
    }
    console.log(`✅ Сохранено ${backedUp} сессий в Redis`);
    return backedUp;
  }

  // Статистика бэкапов
  async getBackupStats(): Promise<{
    totalBackups: number;
    lastBackupTime: Date | null;
  }> {
    try {
      const total = await redisService.getUserStat('session_backups');
      return {
        totalBackups: total,
        lastBackupTime: new Date(), // В реальности нужно хранить время
      };
    } catch (err) {
      return { totalBackups: 0, lastBackupTime: null };
    }
  }
}

export const sessionBackupService = new SessionBackupService();
