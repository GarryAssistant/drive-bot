-- Временный SQL для добавления полей xp и level
-- Запустить через Railway CLI или прямо в БД

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS xp INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS level TEXT DEFAULT 'новичок';

-- Создаём индекс для лидерборда
CREATE INDEX IF NOT EXISTS idx_users_xp ON users(xp DESC);

-- Проверяем
SELECT COUNT(*) as total_users, 
       SUM(xp) as total_xp,
       AVG(xp) as avg_xp,
       level,
       COUNT(*) as users_per_level
FROM users 
GROUP BY level 
ORDER BY avg_xp DESC;
