# Antigravity Scheduler - Usage Guide

## 🚀 Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your API keys
```

### 3. Run

#### One-shot execution (test mode)
```bash
python run.py --once
```

#### Scheduled mode (production)
```bash
python run.py --schedule
```

#### Daemon mode (Docker/background)
```bash
python run.py --daemon
```

---

## 📖 Detailed Usage

### Mode 1: One-Shot Execution

**Use case:** Testing, manual triggers, cron jobs

```bash
# Basic run
python run.py --once

# Specific platform
python run.py --once --platform tiktok

# Multiple platforms
python run.py --once --platform tiktok,instagram

# With niche
python run.py --once --platform tiktok --niche "fitness"

# Verbose logging
python run.py --once --verbose
```

**Output:**
```
🚀 Starting batch execution: batch_20260127_140523
📊 Batch size determined: 3 videos
🎬 Generating 3 videos for ['tiktok', 'instagram']
  [1/3] Generating for tiktok...
  ✅ Video 1 completed
  [2/3] Generating for instagram...
  ✅ Video 2 completed
  [3/3] Generating for tiktok...
  ✅ Video 3 completed
✅ Batch batch_20260127_140523 completed: 3/3 successful

============================================================
📊 BATCH SUMMARY
============================================================
Status:       completed
Videos:       3/3
Failed:       0
Duration:     6.45s
============================================================
```

---

### Mode 2: Scheduled Execution

**Use case:** Production automation, set-and-forget

```bash
# Start scheduler with defaults (from .env)
python run.py --schedule

# Custom interval (override .env)
ANTIGRAVITY_INTERVAL_HOURS=4 python run.py --schedule
```

**Output:**
```
🚀 Starting SCHEDULED mode
  📅 Scheduled: 09:00 UTC
  📅 Scheduled: 15:00 UTC
  📅 Scheduled: 21:00 UTC
⏰ Scheduler started (timezone: UTC)

============================================================
🚀 ANTIGRAVITY SCHEDULER STARTED
============================================================
Mode:         Scheduled
Timezone:     UTC
Interval:     6 hours
Batch size:   1-5 (adaptive)
============================================================

Press Ctrl+C to stop

📋 Next scheduled runs:
   • 2026-01-27 15:00:00 UTC
   • 2026-01-27 21:00:00 UTC
   • 2026-01-28 09:00:00 UTC
```

The scheduler will:
1. Run at specified times (9 AM, 3 PM, 9 PM UTC)
2. Ask agent to decide batch size (1-5 videos)
3. Respect rate limits and quiet hours
4. Log all executions to `antigravity.log`

---

### Mode 3: Daemon Mode (Docker/Production)

**Use case:** Containerized deployment, systemd service

```bash
# Run as daemon
python run.py --daemon
```

This mode:
- Runs in foreground (suitable for Docker)
- Handles SIGTERM/SIGINT for graceful shutdown
- Logs to stdout and file
- Never exits (unless stopped)

---

### Mode 4: Manual Trigger

**Use case:** Testing, admin override, one-off campaigns

```bash
# Trigger batch manually
python run.py --manual

# Force specific count (override agent)
python run.py --manual --count 5

# Specific platform + niche
python run.py --manual --platform instagram --niche "travel"
```

---

### Mode 5: Status Check

```bash
python run.py --status
```

**Output:**
```
============================================================
📊 ANTIGRAVITY STATUS
============================================================
Mode:              scheduled
Batch size:        3
Daily limit:       20
Schedule interval: 6h
Platforms:         tiktok, instagram, youtube_shorts
============================================================
```

---

## 🔧 Configuration Examples

### Scenario 1: Aggressive Posting (Startup Growth)

`.env`:
```bash
ANTIGRAVITY_MODE=scheduled
ANTIGRAVITY_BATCH_SIZE=5
ANTIGRAVITY_INTERVAL_HOURS=4
ANTIGRAVITY_MAX_DAILY_VIDEOS=30
ENABLE_ADAPTIVE_BATCHING=false  # Force 5 every time
```

**Result:** 5 videos every 4 hours = ~30 videos/day

---

### Scenario 2: Conservative (Quality over Quantity)

`.env`:
```bash
ANTIGRAVITY_MODE=scheduled
ANTIGRAVITY_BATCH_SIZE=2
ANTIGRAVITY_INTERVAL_HOURS=8
ANTIGRAVITY_MAX_DAILY_VIDEOS=10
ENABLE_ADAPTIVE_BATCHING=true   # Agent decides 1-3
```

**Result:** 2-3 videos every 8 hours = ~6-9 videos/day

---

### Scenario 3: Peak Times Only

`.env`:
```bash
ANTIGRAVITY_MODE=scheduled
# In scheduler_config.py, set optimal_times:
# optimal_times = [time(9,0), time(17,0)]  # 9 AM, 5 PM only
```

**Result:** Posts only at 9 AM and 5 PM (best engagement times)

---

## 🐛 Troubleshooting

### Issue: Scheduler not running

**Check:**
```bash
python run.py --status
# Verify mode is 'scheduled' or 'daemon'
```

### Issue: No videos generated

**Debug:**
```bash
python run.py --once --verbose
# Check logs for errors
tail -f antigravity.log
```

### Issue: Rate limits hit

**Solution:**
```bash
# Reduce interval or batch size in .env
ANTIGRAVITY_INTERVAL_HOURS=12
ANTIGRAVITY_BATCH_SIZE=2
```

### Issue: Agent always vetoes

**Check agent decision logic:**
- Review `batch_coordinator.py::_ask_agent_for_batch_size()`
- Verify agent is receiving correct context
- Check if daily/hourly limits are already hit

---

## 📊 Monitoring

### Logs

```bash
# Real-time monitoring
tail -f antigravity.log

# Filter for errors only
grep ERROR antigravity.log

# Show batch summaries
grep "Batch.*completed" antigravity.log
```

### Health Check (if you add HTTP endpoint)

```bash
curl http://localhost:8080/health
```

**Response:**
```json
{
  "status": "healthy",
  "scheduler": {
    "running": true,
    "next_run": "2026-01-27T15:00:00Z"
  },
  "coordinator": {
    "daily_videos": 12,
    "hourly_videos": 3,
    "recent_success_rate": 0.95
  }
}
```

---

## 🔗 Integration with Your Agent

### Current Integration Points

In `batch_coordinator.py`, you need to replace mock agent calls:

```python
# Line ~250: Replace mock agent decision
async def _ask_agent_for_batch_size(self, platforms, niche):
    # REPLACE THIS:
    # return {"batch_size": 3, "reasoning": "mock"}
    
    # WITH YOUR ACTUAL AGENT:
    decision = await self.agent.run(
        prompt=decision_prompt,
        context=context
    )
    
    return {
        "batch_size": decision.get("video_count", 3),
        "reasoning": decision.get("reasoning", ""),
        "should_proceed": decision.get("proceed", True)
    }
```

```python
# Line ~330: Replace mock video generation
async def _execute_videos(self, count, platforms, niche):
    # REPLACE THIS:
    # await asyncio.sleep(2)
    
    # WITH YOUR ACTUAL AGENT:
    video_result = await self.agent.generate_video(
        platform=platform,
        niche=niche
    )
```

---

## 🎯 Next Steps

1. ✅ Test one-shot mode
2. ✅ Integrate with your actual agent
3. ✅ Run scheduled mode locally
4. 🔜 Add Docker (next section)
5. 🔜 Deploy to Railway/Fly.io

---

## 💡 Pro Tips

1. **Start with --once**: Always test new configs in one-shot mode first
2. **Use --verbose**: When debugging, verbose logs are your friend
3. **Monitor daily limits**: Set conservative limits initially
4. **Let agent decide**: Adaptive batching > fixed schedules
5. **Check logs regularly**: `tail -f antigravity.log`
