# 🚀 Deployment Best Practices — Drive Bot

## 🔴 Root Cause Last Crash (20 Apr 2026)

**Build failed at Railway** → service never started → 404 Application not found.

**Root cause:** `ioredis` version `^5.10.1` in `package.json` — npm ci installed a newer minor version where `retryDelayOnFailover` option was removed/renamed. TypeScript compilation failed.

**Lesson:** `^` range in package.json allows breaking changes on minor/patch. Always pin or lock.

---

## 🛡️ Prevention Checklist

### Before any deploy:

1. **Lock dependencies**
   - `package-lock.json` must be committed and up-to-date
   - Run `npm ci` (not `npm install`) → installs exactly from lockfile
   - Railway uses `npm ci` — if lockfile is stale, build breaks

2. **Local build test**
   ```bash
   cd backend && npm run build
   ```
   Always compile locally first. Railway build is remote — you won't see TS errors until deploy fails.

3. **Check Railway config consistency**
   - `PORT` environment variable matches what the app listens on
   - `healthcheckPath` exists in code
   - `healthcheckTimeout` is reasonable (>30s if DB migrations run at startup)
   - Dockerfile `EXPOSE` matches expected port (optional on Railway)

4. **Prisma healthcheck**
   - Health endpoint checks DB (`SELECT 1`) and Redis (`PING`)
   - If DB takes >30s to respond, healthcheck fails → replica killed

### Critical files (keep in sync):

| File | Purpose |
|------|---------|
| `railway.json` | Nixpacks config (legacy — not used if `railway.toml` exists) |
| `railway.toml` | Overrides `railway.json` — currently active config |
| `Dockerfile.bot` | Builds bot-standalone (lightweight) |
| `Dockerfile.production` | Deprecated full-stack Dockerfile |

---

## 🔄 Recovery Playbook

### If healthcheck fails on Railway:

1. **Check logs:** `cd ~/Desktop/tracker\ goal\ car && railway logs --lines 50`
2. **Check deploy events:** Railway dashboard > Deployments tab
3. **Build locally:** `cd backend && npm run build`
4. **Fix TS errors** → commit → `railway up --detach`

### If "Application not found":

Service has 0 replicas. Run:
```bash
cd ~/Desktop/tracker\ goal\ car && railway up --detach
```

---

## 📊 Monitoring

- Health endpoint: `https://drive-bot-production.up.railway.app/health`
- Health check script: `bash ~/Desktop/tracker\ goal\ car/bot-monitor.sh`
- Auto-recovery: `bash ~/Desktop/tracker\ goal\ car/auto-recovery.sh`

---

## 🧪 Local Dev vs Railway Deploy

| Aspect | Local | Railway |
|--------|-------|---------|
| Build tool | `tsx watch` | `tsc` → `node dist/` |
| DB | Local SQLite/Postgres | Railway Postgres |
| Redis | Optional (falls back) | Required (Railway Redis) |
| Healthcheck | Direct | Railway probes `/health` |
| Port | 3000 (hardcoded fallback) | 8080 (env var) |

