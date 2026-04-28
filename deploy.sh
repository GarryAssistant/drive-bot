#!/bin/bash
# Автоматический деплой на Railway

set -e

echo "=== Деплой Drive Bot на Railway ==="

# 1. Проверяем миграции
cd backend
npx prisma migrate status
if [ 0 -ne 0 ]; then
    echo "❌ Проблема с миграциями БД"
    exit 1
fi

# 2. Собираем проект
npm run build
if [ 0 -ne 0 ]; then
    echo "❌ Ошибка сборки"
    exit 1
fi

# 3. Деплой на Railway
railway up --detach
if [ 0 -ne 0 ]; then
    echo "❌ Ошибка деплоя на Railway"
    exit 1
fi

# 4. Проверяем health
sleep 10
railway logs --lines 10
echo "✅ Деплой завершён"
