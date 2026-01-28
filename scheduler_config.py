"""
Scheduler Configuration for Antigravity
Adaptive batch scheduling with safety limits
"""

from datetime import time
from typing import Dict, List
from pydantic import BaseModel, Field


class BatchConfig(BaseModel):
    """Configuration for batch video generation"""
    
    min_videos: int = Field(default=1, ge=1, description="Minimum videos per batch")
    max_videos: int = Field(default=5, le=10, description="Maximum videos per batch")
    default_batch_size: int = Field(default=3, description="Default batch size")
    adaptive: bool = Field(default=True, description="Allow agent to decide batch size")
    
    # Safety limits
    max_daily_videos: int = Field(default=20, description="Maximum videos per day")
    max_hourly_videos: int = Field(default=8, description="Maximum videos per hour")
    
    # API rate limiting
    api_cooldown_minutes: int = Field(default=5, description="Cooldown between API calls")
    retry_on_failure: bool = Field(default=True)
    max_retries: int = Field(default=3)


class ScheduleConfig(BaseModel):
    """Schedule timing configuration"""
    
    # Cron-style intervals
    interval_hours: int = Field(default=6, description="Hours between runs")
    
    # Optimal posting times (UTC)
    optimal_times: List[time] = Field(
        default=[
            time(9, 0),   # 9 AM UTC
            time(15, 0),  # 3 PM UTC
            time(21, 0),  # 9 PM UTC
        ],
        description="Best times to post content"
    )
    
    # Timezone
    timezone: str = Field(default="UTC", description="Scheduler timezone")
    
    # Quiet hours (pause scheduler)
    quiet_hours_start: time = Field(default=time(1, 0), description="Start of quiet period")
    quiet_hours_end: time = Field(default=time(6, 0), description="End of quiet period")


class PlatformConfig(BaseModel):
    """Per-platform scheduling rules"""
    
    enabled: bool = Field(default=True)
    max_daily_posts: int = Field(default=10)
    preferred_times: List[time] = Field(default_factory=list)
    min_interval_hours: int = Field(default=2, description="Minimum time between posts")


class AntigravitySchedulerConfig(BaseModel):
    """Master scheduler configuration"""
    
    batch: BatchConfig = Field(default_factory=BatchConfig)
    schedule: ScheduleConfig = Field(default_factory=ScheduleConfig)
    
    # Per-platform overrides
    platforms: Dict[str, PlatformConfig] = Field(
        default={
            "tiktok": PlatformConfig(max_daily_posts=5, min_interval_hours=3),
            "instagram": PlatformConfig(max_daily_posts=3, min_interval_hours=4),
            "youtube_shorts": PlatformConfig(max_daily_posts=2, min_interval_hours=6),
        }
    )
    
    # Agent decision-making
    agent_has_veto: bool = Field(
        default=True, 
        description="Agent can refuse to generate if conditions aren't right"
    )
    
    # Monitoring
    enable_metrics: bool = Field(default=True)
    enable_health_checks: bool = Field(default=True)
    
    # Deployment mode
    mode: str = Field(
        default="scheduled",
        description="Mode: 'once', 'scheduled', 'daemon'"
    )


# Default configuration instance
DEFAULT_CONFIG = AntigravitySchedulerConfig()


# Environment-based overrides
def load_config_from_env() -> AntigravitySchedulerConfig:
    """Load configuration with environment variable overrides"""
    import os
    
    config = DEFAULT_CONFIG.model_copy()
    
    # Override from env vars
    if batch_size := os.getenv("ANTIGRAVITY_BATCH_SIZE"):
        config.batch.default_batch_size = int(batch_size)
    
    if interval := os.getenv("ANTIGRAVITY_INTERVAL_HOURS"):
        config.schedule.interval_hours = int(interval)
    
    if mode := os.getenv("ANTIGRAVITY_MODE"):
        config.mode = mode
    
    if tz := os.getenv("ANTIGRAVITY_TIMEZONE"):
        config.schedule.timezone = tz
    
    return config


if __name__ == "__main__":
    # Test configuration
    config = load_config_from_env()
    print(config.model_dump_json(indent=2))
