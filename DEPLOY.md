# Antigravity Deployment Guide

## 🚀 Quick Start (Local Docker)

### 1. Prerequisites

```bash
# Install Docker
# macOS: https://docs.docker.com/desktop/mac/install/
# Linux: https://docs.docker.com/engine/install/
# Windows: https://docs.docker.com/desktop/windows/install/

# Verify
docker --version
docker-compose --version
```

### 2. Setup

```bash
# Clone/navigate to project
cd antigravity

# Copy environment template
cp .env.example .env

# Edit .env with your API keys
nano .env  # or vim, code, etc.
```

**Required in `.env`:**
```bash
ANTHROPIC_API_KEY=sk-ant-...
ANTIGRAVITY_MODE=daemon
ANTIGRAVITY_BATCH_SIZE=3
ANTIGRAVITY_INTERVAL_HOURS=6
```

### 3. Build & Test

```bash
# Make deploy script executable
chmod +x deploy.sh

# Build image
./deploy.sh build

# Test (one-shot execution)
./deploy.sh test
```

**Expected output:**
```
🚀 Starting batch execution: batch_20260127_153045
📊 Batch size determined: 3 videos
✅ Batch completed: 3/3 successful
```

### 4. Run

```bash
# Start scheduler as daemon
./deploy.sh run

# View logs
./deploy.sh logs

# Check status
./deploy.sh status

# Stop
./deploy.sh stop
```

---

## ☁️ Cloud Deployment

### Option 1: Railway (Recommended)

**Why Railway:**
- ✅ $5/month (includes 512MB RAM, enough for scheduler)
- ✅ Auto-deploy from GitHub
- ✅ Built-in metrics & logs
- ✅ Easy environment variables
- ✅ Free SSL + custom domain

#### Setup Steps

1. **Install Railway CLI**
```bash
npm i -g @railway/cli
```

2. **Login**
```bash
railway login
```

3. **Initialize project**
```bash
# In your antigravity directory
railway init

# Link to existing project (or create new)
railway link
```

4. **Set environment variables**
```bash
# Add via CLI
railway variables set ANTHROPIC_API_KEY=sk-ant-...

# Or via Railway dashboard (easier)
# https://railway.app/dashboard
# → Select project → Variables
```

**Required variables:**
```bash
ANTHROPIC_API_KEY=sk-ant-...
ANTIGRAVITY_MODE=daemon
ANTIGRAVITY_BATCH_SIZE=3
ANTIGRAVITY_INTERVAL_HOURS=6
ANTIGRAVITY_TIMEZONE=UTC
```

5. **Deploy**
```bash
./deploy.sh deploy-railway

# Or manually
railway up
```

6. **Monitor**
```bash
# View logs
railway logs

# Open dashboard
railway open
```

#### Auto-deploy from GitHub

1. **Push to GitHub**
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-repo-url>
git push -u origin main
```

2. **Connect in Railway dashboard**
- Go to Railway dashboard
- Settings → GitHub Repo
- Select your repo
- Deploy automatically on push to `main`

---

### Option 2: Fly.io

**Why Fly.io:**
- ✅ Free tier: 3 shared VMs (256MB each)
- ✅ Global edge deployment
- ✅ Good for long-running processes

#### Setup Steps

1. **Install Fly CLI**
```bash
# macOS
brew install flyctl

# Linux
curl -L https://fly.io/install.sh | sh

# Windows
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

2. **Login**
```bash
fly auth login
```

3. **Create `fly.toml`**
```bash
fly launch --no-deploy

# Follow prompts:
# - App name: antigravity-yourname
# - Region: nearest to you
# - No PostgreSQL (for now)
# - No Redis (for now)
```

**Edit `fly.toml`:**
```toml
app = "antigravity-yourname"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  ANTIGRAVITY_MODE = "daemon"
  ANTIGRAVITY_BATCH_SIZE = "3"
  ANTIGRAVITY_INTERVAL_HOURS = "6"

[[services]]
  internal_port = 8080
  protocol = "tcp"

  [[services.ports]]
    port = 80
    handlers = ["http"]

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]

[checks]
  [checks.health]
    port = 8080
    type = "http"
    interval = "30s"
    timeout = "5s"
    path = "/health"
```

4. **Set secrets**
```bash
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
```

5. **Deploy**
```bash
fly deploy
```

6. **Monitor**
```bash
# View logs
fly logs

# SSH into VM
fly ssh console

# Status
fly status
```

---

### Option 3: VPS (DigitalOcean, Linode, etc.)

**For full control:**

1. **SSH into VPS**
```bash
ssh root@your-vps-ip
```

2. **Install Docker**
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install docker-compose
apt-get install docker-compose-plugin
```

3. **Clone repo & setup**
```bash
git clone <your-repo>
cd antigravity

cp .env.example .env
nano .env  # Add your keys
```

4. **Run with systemd (auto-restart)**

Create `/etc/systemd/system/antigravity.service`:
```ini
[Unit]
Description=Antigravity Scheduler
After=docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=/root/antigravity
ExecStart=/usr/bin/docker-compose up
ExecStop=/usr/bin/docker-compose down
Restart=always

[Install]
WantedBy=multi-user.target
```

**Enable & start:**
```bash
systemctl enable antigravity
systemctl start antigravity

# Check status
systemctl status antigravity

# View logs
journalctl -u antigravity -f
```

---

## 📊 Monitoring & Debugging

### View Logs

**Docker:**
```bash
docker-compose logs -f antigravity
```

**Railway:**
```bash
railway logs
```

**Fly.io:**
```bash
fly logs
```

### Health Check

**Local:**
```bash
docker exec antigravity-scheduler python healthcheck.py
```

**Railway/Fly:**
```bash
curl https://your-app.railway.app/health
```

### Debug Container

**Enter running container:**
```bash
# Docker
docker-compose exec antigravity /bin/bash

# Railway
railway run bash

# Fly.io
fly ssh console
```

**Check logs inside container:**
```bash
tail -f antigravity.log
cat antigravity.log | grep ERROR
```

---

## 🔧 Troubleshooting

### Issue: Container keeps restarting

**Check:**
```bash
docker logs antigravity-scheduler
```

**Common causes:**
1. Missing `.env` file → Copy `.env.example`
2. Invalid API keys → Verify in `.env`
3. Port conflict → Change PORT in `.env`

### Issue: No videos generated

**Debug:**
```bash
# Enter container
docker exec -it antigravity-scheduler /bin/bash

# Run once manually
python run.py --once --verbose
```

### Issue: Out of memory

**Railway/Fly.io:**
- Upgrade plan (Railway: $5/mo for 1GB)
- Or reduce batch size: `ANTIGRAVITY_BATCH_SIZE=2`

**Docker:**
```bash
# Increase memory limit in docker-compose.yml
deploy:
  resources:
    limits:
      memory: 2G
```

---

## 🚨 Production Checklist

Before deploying to production:

- [ ] All API keys in `.env` (not in code)
- [ ] `ANTIGRAVITY_MODE=daemon`
- [ ] Batch size set (2-5 recommended)
- [ ] Interval configured (4-12 hours)
- [ ] Timezone set correctly
- [ ] Health check passing
- [ ] Logs rotating (max 10MB per file)
- [ ] Resource limits set (1GB RAM recommended)
- [ ] Restart policy: `on-failure`
- [ ] Monitoring enabled (Railway/Fly dashboard)

---

## 💰 Cost Estimates

### Railway
- **Free tier:** $0 (500 hours/month, enough for testing)
- **Pro:** $5/month (unlimited hours, 512MB RAM)
- **Recommended:** Pro ($5/mo)

### Fly.io
- **Free tier:** 3 VMs × 256MB (shared CPU)
- **Paid:** $1.94/mo per VM (dedicated 256MB)
- **Recommended:** Free tier (sufficient)

### VPS (DigitalOcean)
- **Basic:** $6/month (1GB RAM, 25GB SSD)
- **Recommended:** If running other services too

---

## 🎯 Next Steps After Deployment

1. ✅ Monitor first 24 hours
2. ✅ Check batch execution in logs
3. ✅ Verify videos being created
4. ✅ Adjust batch size if needed
5. ✅ Add video pipeline integration
6. 🔜 Scale to multiple platforms
7. 🔜 Add analytics dashboard

---

## 📞 Support

**Logs not helping?**
1. Check `antigravity.log` file
2. Run `healthcheck.py` manually
3. Test with `--once --verbose`
4. Verify all env vars are set

**Still stuck?**
- Railway Discord: https://discord.gg/railway
- Fly.io Community: https://community.fly.io
