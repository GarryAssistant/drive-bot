-- Добавляем поле xp в таблицу users
ALTER TABLE users ADD COLUMN IF NOT EXISTS xp INTEGER DEFAULT 0;

-- Добавляем поле level (можно хранить как integer или text)
ALTER TABLE users ADD COLUMN IF NOT EXISTS level TEXT DEFAULT 'новичок';

-- Создаём индекс для быстрого лидерборда
CREATE INDEX IF NOT EXISTS idx_users_xp ON users(xp DESC);

-- Обновляем существующих пользователей (если нужно)
-- UPDATE users SET xp = 0 WHERE xp IS NULL;
-- UPDATE users SET level = 'новичок' WHERE level IS NULL;
