#!/bin/bash
# bot-monitor.sh — мониторинг и автозапуск бота

LOG_FILE="/tmp/drive-bot-monitor.log"
PROJECT_DIR="/Users/pablo/Desktop/tracker goal car"
BACKEND_DIR="$PROJECT_DIR/backend"
MAX_RESTARTS=3
RESTART_COUNT_FILE="/tmp/drive-bot-restart-count"

# Инициализируем счётчик перезапусков
if [ ! -f "$RESTART_COUNT_FILE" ]; then
    echo "0" > "$RESTART_COUNT_FILE"
fi

RESTART_COUNT=$(cat "$RESTART_COUNT_FILE")

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

check_bot() {
    # Проверяем процесс
    BOT_PID=$(ps aux | grep -E "node.*bot|tsx.*bot" | grep -v grep | awk '{print $2}')
    
    if [ -z "$BOT_PID" ]; then
        log "❌ Бот не запущен"
        return 1
    fi
    
    # Проверяем health endpoint
    if ! curl -s --max-time 5 http://localhost:3000/health >/dev/null 2>&1; then
        log "⚠️  Бот запущен (PID: $BOT_PID), но health check не проходит"
        return 2
    fi
    
    log "✅ Бот работает (PID: $BOT_PID)"
    return 0
}

start_bot() {
    log "Запускаю бота..."
    cd "$BACKEND_DIR"
    
    # Останавливаем старый процесс если есть
    pkill -f "node.*bot\|tsx.*bot" 2>/dev/null || true
    sleep 2
    
    # Запускаем в фоне с логированием
    npm run bot > /tmp/drive-bot-current.log 2>&1 &
    NEW_PID=$!
    
    sleep 5
    
    # Проверяем запуск
    if ps -p "$NEW_PID" >/dev/null 2>&1 && curl -s http://localhost:3000/health >/dev/null 2>&1; then
        log "✅ Бот успешно запущен (PID: $NEW_PID)"
        echo "0" > "$RESTART_COUNT_FILE"  # Сбрасываем счётчик
        return 0
    else
        log "❌ Не удалось запустить бота"
        return 1
    fi
}

# Основной цикл
log "=== Проверка Drive Bot ==="

check_bot
STATUS=$?

if [ $STATUS -ne 0 ]; then
    log "Проблема с ботом, код: $STATUS"
    
    # Проверяем лимит перезапусков
    if [ "$RESTART_COUNT" -ge "$MAX_RESTARTS" ]; then
        log "⚠️  Достигнут лимит перезапусков ($MAX_RESTARTS). Требуется ручное вмешательство."
        exit 1
    fi
    
    # Увеличиваем счётчик и пытаемся перезапустить
    NEW_COUNT=$((RESTART_COUNT + 1))
    echo "$NEW_COUNT" > "$RESTART_COUNT_FILE"
    log "Попытка перезапуска #$NEW_COUNT из $MAX_RESTARTS"
    
    if start_bot; then
        log "✅ Бот восстановлен после сбоя"
    else
        log "❌ Не удалось восстановить бота"
        exit 1
    fi
else
    # Сбрасываем счётчик перезапусков при успешной проверке
    echo "0" > "$RESTART_COUNT_FILE"
fi

# Дополнительные проверки
log "Проверяю базу данных..."
if ! psql -U pablo -d drive_dev -c "SELECT 1" >/dev/null 2>&1; then
    log "⚠️  Проблема с подключением к PostgreSQL"
fi

log "Проверяю дисковое пространство..."
DISK_USAGE=$(df -h / | tail -1 | awk '{print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -gt 90 ]; then
    log "⚠️  Диск заполнен на ${DISK_USAGE}%"
fi

log "=== Проверка завершена ==="
