#!/bin/bash
# Добавляет начисление XP после создания записи

FILE="bot.service.ts"

# Первое место (текстовые записи)
sed -i '' '/await prisma\.entry\.upsert({/,/^\s*}),;/ {
  /^\s*}),;/ {
    a\
        // Начисляем XP за запись\
        const entryQuality = analysis.totalScore >= 70 ? "high" : "normal";\
        await awardXPForEntry(sess, ctx, entryQuality);
  }
}' "$FILE"

# Второе место (голосовые записи)
sed -i '' '/const today = todayUTC();/,/^\s*}),;/ {
  /^\s*}),;/ {
    a\
        // Начисляем XP за голосовую запись\
        const entryQuality = analysis.totalScore >= 70 ? "high" : "normal";\
        await awardXPForEntry(sess, ctx, entryQuality);
  }
}' "$FILE"

echo "✅ XP начисление добавлено в оба места"
