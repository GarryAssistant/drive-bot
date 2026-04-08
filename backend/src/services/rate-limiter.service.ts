// Simple in-memory rate limiter
// Limits: 1 message per 2s (anti-spam), 20 messages per minute (anti-flood)

interface UserBucket {
  lastMessageAt: number;
  minuteCount: number;
  minuteWindowStart: number;
}

const buckets = new Map<number, UserBucket>();

const MIN_INTERVAL_MS = 2000;     // min 2s between messages
const MAX_PER_MINUTE = 20;        // max 20 messages per minute

export function checkRateLimit(userId: number): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const bucket = buckets.get(userId) ?? {
    lastMessageAt: 0,
    minuteCount: 0,
    minuteWindowStart: now,
  };

  // Reset minute window if expired
  if (now - bucket.minuteWindowStart > 60_000) {
    bucket.minuteCount = 0;
    bucket.minuteWindowStart = now;
  }

  // Check min interval
  if (now - bucket.lastMessageAt < MIN_INTERVAL_MS) {
    return { allowed: false, reason: 'too_fast' };
  }

  // Check per-minute limit
  if (bucket.minuteCount >= MAX_PER_MINUTE) {
    return { allowed: false, reason: 'too_many' };
  }

  bucket.lastMessageAt = now;
  bucket.minuteCount += 1;
  buckets.set(userId, bucket);
  return { allowed: true };
}
