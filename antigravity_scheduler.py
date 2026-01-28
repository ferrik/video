"""
Scheduler for Antigravity
APScheduler-based automation with cron fallback
"""

import asyncio
import signal
import sys
from datetime import datetime
from typing import Optional, Callable
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger


logger = logging.getLogger(__name__)


class AntigravityScheduler:
    """
    Production scheduler for Antigravity
    
    Supports:
    - Interval-based scheduling (every N hours)
    - Cron-based scheduling (specific times)
    - One-shot execution
    - Graceful shutdown
    """
    
    def __init__(self, coordinator, config):
        """
        Args:
            coordinator: BatchCoordinator instance
            config: AntigravitySchedulerConfig
        """
        self.coordinator = coordinator
        self.config = config
        
        self.scheduler = AsyncIOScheduler(timezone=config.schedule.timezone)
        self.is_running = False
        
        # Graceful shutdown handling
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
    
    def _signal_handler(self, signum, frame):
        """Handle shutdown signals"""
        logger.info(f"🛑 Received signal {signum}, shutting down...")
        self.stop()
        sys.exit(0)
    
    async def run_once(
        self, 
        platforms: Optional[list] = None, 
        niche: Optional[str] = None
    ):
        """
        Execute batch once and exit
        
        Use case: Manual trigger, testing, or cron-based deployment
        """
        logger.info("🎯 Running in ONE-SHOT mode")
        
        try:
            result = await self.coordinator.execute_batch(
                platforms=platforms,
                niche=niche
            )
            
            logger.info(f"✅ One-shot completed: {result.status}")
            logger.info(f"   Videos: {result.successful_count}/{result.requested_count}")
            
            return result
            
        except Exception as e:
            logger.error(f"❌ One-shot failed: {e}", exc_info=True)
            raise
    
    def start_scheduled(self, job_function: Optional[Callable] = None):
        """
        Start scheduled execution
        
        Args:
            job_function: Optional custom job function (default: coordinator.execute_batch)
        """
        logger.info("🚀 Starting SCHEDULED mode")
        
        # Default job: execute batch
        if job_function is None:
            job_function = self._default_scheduled_job
        
        # Add job based on config
        if self.config.schedule.optimal_times:
            # Cron-based (specific times)
            self._add_cron_jobs(job_function)
        else:
            # Interval-based (every N hours)
            self._add_interval_job(job_function)
        
        # Start scheduler
        self.scheduler.start()
        self.is_running = True
        
        logger.info(f"⏰ Scheduler started (timezone: {self.config.schedule.timezone})")
        self._print_next_runs()
    
    def _add_cron_jobs(self, job_function: Callable):
        """Add jobs for specific times"""
        for time in self.config.schedule.optimal_times:
            trigger = CronTrigger(
                hour=time.hour,
                minute=time.minute,
                timezone=self.config.schedule.timezone
            )
            
            self.scheduler.add_job(
                job_function,
                trigger=trigger,
                id=f"antigravity_cron_{time.hour}_{time.minute}",
                replace_existing=True,
                max_instances=1  # Prevent overlapping executions
            )
            
            logger.info(f"  📅 Scheduled: {time.strftime('%H:%M')} {self.config.schedule.timezone}")
    
    def _add_interval_job(self, job_function: Callable):
        """Add interval-based job"""
        trigger = IntervalTrigger(
            hours=self.config.schedule.interval_hours,
            timezone=self.config.schedule.timezone
        )
        
        self.scheduler.add_job(
            job_function,
            trigger=trigger,
            id="antigravity_interval",
            replace_existing=True,
            max_instances=1
        )
        
        logger.info(f"  ⏱️  Interval: every {self.config.schedule.interval_hours} hours")
    
    async def _default_scheduled_job(self):
        """Default scheduled job: execute batch"""
        try:
            logger.info("⏰ Scheduled execution triggered")
            
            result = await self.coordinator.execute_batch()
            
            logger.info(
                f"✅ Scheduled batch completed: {result.status} "
                f"({result.successful_count}/{result.requested_count} videos)"
            )
            
        except Exception as e:
            logger.error(f"❌ Scheduled batch failed: {e}", exc_info=True)
    
    def _print_next_runs(self):
        """Print next scheduled runs"""
        jobs = self.scheduler.get_jobs()
        
        if not jobs:
            logger.warning("⚠️  No jobs scheduled!")
            return
        
        logger.info("📋 Next scheduled runs:")
        for job in jobs[:5]:  # Show next 5
            next_run = job.next_run_time
            if next_run:
                logger.info(f"   • {next_run.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    
    def run_daemon(self):
        """
        Run scheduler as daemon (blocking)
        
        Use case: Docker container, systemd service
        """
        logger.info("🔄 Starting DAEMON mode")
        
        self.start_scheduled()
        
        try:
            # Keep running
            logger.info("✅ Scheduler running. Press Ctrl+C to stop.")
            asyncio.get_event_loop().run_forever()
            
        except (KeyboardInterrupt, SystemExit):
            logger.info("🛑 Daemon stopped")
            self.stop()
    
    def stop(self):
        """Stop scheduler gracefully"""
        if not self.is_running:
            return
        
        logger.info("🛑 Stopping scheduler...")
        
        if self.scheduler.running:
            self.scheduler.shutdown(wait=True)
        
        self.is_running = False
        logger.info("✅ Scheduler stopped")
    
    def get_status(self) -> dict:
        """Get scheduler status"""
        jobs = self.scheduler.get_jobs() if self.scheduler.running else []
        
        return {
            "running": self.is_running,
            "mode": self.config.mode,
            "timezone": self.config.schedule.timezone,
            "job_count": len(jobs),
            "next_run": jobs[0].next_run_time if jobs else None,
            "coordinator_stats": self.coordinator.get_stats()
        }
    
    async def manual_trigger(self, **kwargs):
        """Manually trigger a batch execution"""
        logger.info("🎯 Manual trigger requested")
        return await self.coordinator.execute_batch(**kwargs)


# CLI-friendly helper functions

async def run_once_cli(config, agent):
    """CLI: Run once and exit"""
    from batch_coordinator import BatchCoordinator
    
    coordinator = BatchCoordinator(config, agent)
    scheduler = AntigravityScheduler(coordinator, config)
    
    result = await scheduler.run_once()
    print(f"\n✅ Completed: {result.successful_count}/{result.requested_count} videos")
    
    return result


def run_daemon_cli(config, agent):
    """CLI: Run as daemon"""
    from batch_coordinator import BatchCoordinator
    
    coordinator = BatchCoordinator(config, agent)
    scheduler = AntigravityScheduler(coordinator, config)
    
    scheduler.run_daemon()


if __name__ == "__main__":
    # Example usage
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Mock config and agent for testing
    from scheduler_config import load_config_from_env
    
    config = load_config_from_env()
    
    # Mock agent
    class MockAgent:
        async def generate_video(self, **kwargs):
            await asyncio.sleep(1)
            return {"status": "success"}
    
    agent = MockAgent()
    
    # Test
    print("Testing scheduler...")
    print(f"Mode: {config.mode}")
    
    if config.mode == "once":
        asyncio.run(run_once_cli(config, agent))
    else:
        run_daemon_cli(config, agent)
