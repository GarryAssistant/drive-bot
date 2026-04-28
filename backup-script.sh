#!/bin/bash
# backup-script.sh — ежедневные бэкапы базы данных и кода

BACKUP_DIR="/Users/pablo/Desktop/tracker goal car/backups"
PROJECT_DIR="/Users/pablo/Desktop/tracker goal car"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="$BACKUP_DIR/$DATE"
LOG_FILE="/tmp/drive-bot-backup.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

mkdir -p "$BACKUP_DIR"

log "=== Начало бэкапа Drive Bot ==="

# 1. Бэкап базы данных (только данные, без DROP)
log "Создаю бэкап базы данных..."
pg_dump -U pablo -d drive_dev --data-only --inserts > "$BACKUP_PATH-data.sql" 2>/dev/null || {
    log "❌ Ошибка бэкапа БД"
    exit 1
}

# 2. Бэкап схемы БД
log "Создаю бэкап схемы..."
pg_dump -U pablo -d drive_dev --schema-only > "$BACKUP_PATH-schema.sql" 2>/dev/null || {
    log "⚠️  Не удалось создать бэкап схемы"
}

# 3. Бэкап исходного кода
log "Создаю бэкап кода..."
tar -czf "$BACKUP_PATH-code.tar.gz" -C "$PROJECT_DIR" \
    backend/src \
    backend/package.json \
    backend/package-lock.json \
    backend/prisma/schema.prisma \
    2>/dev/null || {
    log "⚠️  Не удалось создать бэкап кода"
}

# 4. Сжимаем и проверяем
log "Проверяю бэкапы..."
if [ -f "$BACKUP_PATH-data.sql" ] && [ -s "$BACKUP_PATH-data.sql" ]; then
    DATA_SIZE=$(stat -f%z "$BACKUP_PATH-data.sql")
    log "✅ Бэкап данных: $DATA_SIZE байт"
else
    log "❌ Бэкап данных пуст или отсутствует"
fi

# 5. Очистка старых бэкапов (храним 7 дней)
log "Очищаю старые бэкапы..."
find "$BACKUP_DIR" -type f -name "*.sql" -mtime +7 -delete 2>/dev/null || true
find "$BACKUP_DIR" -type f -name "*.tar.gz" -mtime +7 -delete 2>/dev/null || true

log "=== Бэкап завершён: $BACKUP_PATH ==="
