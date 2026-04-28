#!/bin/bash
# safe-update.sh — безопасное обновление бота без остановки

set -e

PROJECT_DIR="/Users/pablo/Desktop/tracker goal car"
BACKEND_DIR="$PROJECT_DIR/backend"
BACKUP_DIR="$PROJECT_DIR/backups/$(date +%Y%m%d_%H%M%S)"
LOG_FILE="/tmp/drive-bot-update.log"

echo "=== Безопасное обновление Drive Bot ===" | tee -a "$LOG_FILE"
echo "Дата: $(date)" | tee -a "$LOG_FILE"

# 1. Создаём бэкап
mkdir -p "$BACKUP_DIR"
echo "Создаю бэкап в $BACKUP_DIR..." | tee -a "$LOG_FILE"

# Бэкап исходного кода
cp -r "$BACKEND_DIR/src" "$BACKUP_DIR/src-backup" 2>/dev/null || true
cp "$BACKEND_DIR/package.json" "$BACKUP_DIR/" 2>/dev/null || true
cp "$BACKEND_DIR/package-lock.json" "$BACKUP_DIR/" 2>/dev/null || true
cp "$BACKEND_DIR/prisma/schema.prisma" "$BACKUP_DIR/" 2>/dev/null || true

# Бэкап базы данных (только схема)
pg_dump -U pablo -d drive_dev --schema-only > "$BACKUP_DIR/db-schema.sql" 2>/dev/null || echo "Не удалось создать бэкап схемы БД" | tee -a "$LOG_FILE"

# 2. Проверяем компиляцию
echo "Проверяю компиляцию TypeScript..." | tee -a "$LOG_FILE"
cd "$BACKEND_DIR"
if ! npx tsc --noEmit 2>&1 | tail -20; then
    echo "❌ Ошибка компиляции. Откатываю изменения..." | tee -a "$LOG_FILE"
    # Восстанавливаем из бэкапа
    rm -rf "$BACKEND_DIR/src"
    cp -r "$BACKUP_DIR/src-backup" "$BACKEND_DIR/src" 2>/dev/null || true
    exit 1
fi

# 3. Применяем миграции БД (если есть изменения схемы)
if [ -f "$BACKEND_DIR/prisma/migrations" ]; then
    echo "Применяю миграции БД..." | tee -a "$LOG_FILE"
    npx prisma migrate deploy 2>&1 | tail -20 || {
        echo "❌ Ошибка миграции БД" | tee -a "$LOG_FILE"
        exit 1
    }
fi

# 4. Перезапускаем бота (если запущен)
BOT_PID=$(ps aux | grep -E "node.*bot|tsx.*bot" | grep -v grep | awk '{print $2}')
if [ -n "$BOT_PID" ]; then
    echo "Перезапускаю бота (PID: $BOT_PID)..." | tee -a "$LOG_FILE"
    kill "$BOT_PID" 2>/dev/null || true
    sleep 2
fi

# 5. Запускаем бота в фоне
echo "Запускаю бота..." | tee -a "$LOG_FILE"
cd "$BACKEND_DIR"
npm run bot > /tmp/drive-bot.log 2>&1 &
NEW_PID=$!
echo "Бот запущен с PID: $NEW_PID" | tee -a "$LOG_FILE"

# 6. Проверяем health
sleep 5
if curl -s http://localhost:3000/health >/dev/null 2>&1; then
    echo "✅ Обновление успешно. Бот работает." | tee -a "$LOG_FILE"
else
    echo "❌ Бот не отвечает после обновления" | tee -a "$LOG_FILE"
    # Пытаемся восстановить из бэкапа
    echo "Восстанавливаю из бэкапа..." | tee -a "$LOG_FILE"
    rm -rf "$BACKEND_DIR/src"
    cp -r "$BACKUP_DIR/src-backup" "$BACKEND_DIR/src" 2>/dev/null || true
    # Запускаем старую версию
    kill "$NEW_PID" 2>/dev/null || true
    cd "$BACKEND_DIR"
    npm run bot > /tmp/drive-bot.log 2>&1 &
    echo "Восстановлена старая версия" | tee -a "$LOG_FILE"
fi

echo "=== Обновление завершено ===" | tee -a "$LOG_FILE"
