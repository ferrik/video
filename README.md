# 🚀 Antigravity — AI Content Lab

**Automated system for testing content ideas through AI-generated short videos**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![Docker](https://img.shields.io/badge/docker-ready-brightgreen.svg)](https://www.docker.com/)

---

## 📖 Overview

Antigravity is **not a media brand** — it's a **content laboratory** for rapid hypothesis testing through short-form video.

### Core Principle

> We don't test "ideas" — we test **algorithm and audience reactions**.  
> Topic is a variable. Format is constant.

### Key Features

- ✅ **Adaptive batch scheduling** (1-5 videos per run)
- ✅ **Multi-platform** (TikTok, Instagram, YouTube Shorts)
- ✅ **AI-powered** (agent decides when & how much to post)
- ✅ **Data-driven** (metrics-based decisions, not feelings)
- ✅ **Production-ready** (Docker, Railway/Fly.io deployment)

---

## 🎯 Quick Start

### Prerequisites

- Python 3.11+
- Docker (optional, for deployment)
- Anthropic API key

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/antigravity.git
cd antigravity

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your API keys
```

### Run

```bash
# Test (one-shot execution)
python run.py --once

# Scheduled mode
python run.py --schedule

# Daemon mode (background)
python run.py --daemon
```

---

## 📊 How It Works

### 1. Video Structure (10-18 seconds)

Every video follows this formula:

1. **Hook (0-2s)** — Pattern interrupt / bold statement
2. **Core (2-12s)** — One fact / observation
3. **Silent CTA (12-18s)** — Subtle hint, not explicit call-to-action

### 2. Content Types

- 🔹 Observations
- 🔹 Paradoxes
- 🔹 Hidden mechanics
- 🔹 "People pay for this"
- 🔹 "Nobody talks about..."
- 🔹 Local patterns
- 🔹 Anti-advice

### 3. Metrics (only these matter)

| Metric | Why Important |
|--------|---------------|
| 3-sec retention | Hook quality |
| % completion | Structure |
| Comments | Trigger effectiveness |
| Shares | Value signal |
| Full zeros | Rejection signal |

❌ Likes are secondary  
❌ Subscribers are not a KPI

---

## 🏗️ Architecture

```
antigravity/
├── scheduler/
│   ├── scheduler_config.py      # Configuration
│   ├── batch_coordinator.py     # Batch orchestration
│   └── antigravity_scheduler.py # APScheduler wrapper
├── core/
│   ├── agent.py                 # FSM agent (your implementation)
│   ├── memory.py                # Memory system
│   └── state.py                 # State management
├── tools/
│   └── ...                      # Agent tools
├── run.py                       # CLI entry point
├── Dockerfile                   # Production container
├── docker-compose.yml           # Local development
└── deploy.sh                    # Deployment helper
```

### Design Principles

- **Scheduler** = Timer (when to trigger)
- **Coordinator** = Brain (how many videos, what platforms)
- **Agent** = Decision maker (adaptive batch sizing)

---

## 🐳 Docker Deployment

### Local

```bash
# Build
./deploy.sh build

# Test
./deploy.sh test

# Run
./deploy.sh run

# Logs
./deploy.sh logs
```

### Production (Railway)

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Deploy
./deploy.sh deploy-railway
```

**Cost:** $5/month (Railway Pro — 512MB RAM, unlimited hours)

See [DEPLOY.md](DEPLOY.md) for detailed deployment guide.

---

## 📈 Scaling Strategy

### Phase 1: Validation (Days 1-14)

- 1 video/day/platform
- Test format & hooks
- Collect metrics

**Decision point:**
- ❌ 70% videos < 500 views → **change format**
- 🟡 1-2 videos "hit" → **clone pattern**
- ✅ Repeatable results → **scale**

### Phase 2: Expansion

- New languages (EN, UA, EU)
- New platforms
- New hook variations
- Remix top performers

**Rule:** Don't scale zero. Only scale what works.

---

## 🔧 Configuration

### Environment Variables

```bash
# Scheduler
ANTIGRAVITY_MODE=daemon                  # once | scheduled | daemon
ANTIGRAVITY_BATCH_SIZE=3                 # 1-5 videos per run
ANTIGRAVITY_INTERVAL_HOURS=6             # Hours between runs
ANTIGRAVITY_TIMEZONE=UTC

# Safety limits
ANTIGRAVITY_MAX_DAILY_VIDEOS=20
ANTIGRAVITY_MAX_HOURLY_VIDEOS=8

# AI
ANTHROPIC_API_KEY=sk-ant-...

# Platforms (add as needed)
TIKTOK_API_KEY=...
INSTAGRAM_ACCESS_TOKEN=...
YOUTUBE_API_KEY=...
```

See [.env.example](.env.example) for full configuration.

---

## 📚 Documentation

- [USAGE.md](USAGE.md) — Detailed usage guide
- [DEPLOY.md](DEPLOY.md) — Deployment instructions
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — System design (TODO)

---

## 🛠️ Development

### Running Tests

```bash
pytest tests/
```

### Code Style

```bash
# Format
black .

# Lint
ruff check .
```

### Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

## 📊 Roadmap

- [x] Adaptive scheduler
- [x] Batch coordinator
- [x] Docker deployment
- [ ] Real video pipeline (CapCut/Runway/Pika)
- [ ] Analytics dashboard
- [ ] Multi-language support
- [ ] A/B testing framework
- [ ] Performance optimization

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

Built with:
- [Anthropic Claude](https://www.anthropic.com/) — AI agent
- [APScheduler](https://apscheduler.readthedocs.io/) — Scheduling
- [LangGraph](https://github.com/langchain-ai/langgraph) — Agent framework

---

## 📞 Contact

- Issues: [GitHub Issues](https://github.com/yourusername/antigravity/issues)
- Discussions: [GitHub Discussions](https://github.com/yourusername/antigravity/discussions)

---

**Remember:** This is a lab, not a blog. Test fast. Kill fast. Scale what works.
