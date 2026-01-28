#!/usr/bin/env python3
"""
Antigravity Scheduler - Main Entry Point

Usage:
    python run.py --once                    # Run once and exit
    python run.py --schedule                # Start scheduled runs
    python run.py --daemon                  # Run as daemon (blocking)
    python run.py --status                  # Check scheduler status
    python run.py --manual --platform tiktok  # Manual trigger
"""

import argparse
import asyncio
import logging
import sys
from pathlib import Path

# Add project to path
sys.path.insert(0, str(Path(__file__).parent))

from scheduler_config import load_config_from_env
from batch_coordinator import BatchCoordinator
from antigravity_scheduler import AntigravityScheduler


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('antigravity.log')
    ]
)

logger = logging.getLogger(__name__)


def load_agent():
    """
    Load Antigravity agent
    
    TODO: Replace with actual agent initialization
    This is where you import and initialize your FSM agent
    """
    logger.info("🤖 Loading Antigravity agent...")
    
    # Placeholder: Import your actual agent
    # from core.agent import AntigravityAgent
    # agent = AntigravityAgent(config=...)
    
    # Mock agent for now
    class MockAgent:
        async def generate_video(self, platform, niche=None):
            """Mock video generation"""
            await asyncio.sleep(2)
            return {
                "video_id": f"mock_{platform}_{asyncio.get_event_loop().time()}",
                "status": "success"
            }
        
        async def run(self, prompt, context=None):
            """Mock agent run"""
            return {"response": "Mock agent decision"}
    
    agent = MockAgent()
    logger.info("✅ Agent loaded (mock mode)")
    
    return agent


async def run_once(args):
    """Run batch once and exit"""
    config = load_config_from_env()
    agent = load_agent()
    
    coordinator = BatchCoordinator(config, agent)
    scheduler = AntigravityScheduler(coordinator, config)
    
    platforms = args.platform.split(',') if args.platform else None
    
    result = await scheduler.run_once(
        platforms=platforms,
        niche=args.niche
    )
    
    # Print summary
    print("\n" + "="*60)
    print("📊 BATCH SUMMARY")
    print("="*60)
    print(f"Status:       {result.status}")
    print(f"Videos:       {result.successful_count}/{result.requested_count}")
    print(f"Failed:       {result.failed_count}")
    print(f"Duration:     {result.total_time:.2f}s")
    print("="*60)
    
    if result.videos:
        print("\n📹 Generated Videos:")
        for i, video in enumerate(result.videos, 1):
            status_icon = "✅" if video.status == "success" else "❌"
            print(f"  {status_icon} {i}. {video.platform} - {video.video_id or 'failed'}")
    
    sys.exit(0 if result.successful_count > 0 else 1)


def run_scheduled(args):
    """Start scheduled execution"""
    config = load_config_from_env()
    agent = load_agent()
    
    coordinator = BatchCoordinator(config, agent)
    scheduler = AntigravityScheduler(coordinator, config)
    
    scheduler.start_scheduled()
    
    print("\n" + "="*60)
    print("🚀 ANTIGRAVITY SCHEDULER STARTED")
    print("="*60)
    print(f"Mode:         Scheduled")
    print(f"Timezone:     {config.schedule.timezone}")
    print(f"Interval:     {config.schedule.interval_hours} hours")
    print(f"Batch size:   {config.batch.min_videos}-{config.batch.max_videos} (adaptive)")
    print("="*60)
    print("\nPress Ctrl+C to stop\n")
    
    # Keep alive
    try:
        asyncio.get_event_loop().run_forever()
    except KeyboardInterrupt:
        print("\n🛑 Shutting down...")
        scheduler.stop()


def run_daemon(args):
    """Run as daemon (Docker mode)"""
    config = load_config_from_env()
    agent = load_agent()
    
    coordinator = BatchCoordinator(config, agent)
    scheduler = AntigravityScheduler(coordinator, config)
    
    logger.info("🔄 Starting daemon mode...")
    scheduler.run_daemon()


def check_status(args):
    """Check scheduler status"""
    # This would query a running scheduler
    # For now, just show config
    config = load_config_from_env()
    
    print("\n" + "="*60)
    print("📊 ANTIGRAVITY STATUS")
    print("="*60)
    print(f"Mode:              {config.mode}")
    print(f"Batch size:        {config.batch.default_batch_size}")
    print(f"Daily limit:       {config.batch.max_daily_videos}")
    print(f"Schedule interval: {config.schedule.interval_hours}h")
    print(f"Platforms:         {', '.join(config.platforms.keys())}")
    print("="*60)


async def manual_trigger(args):
    """Manually trigger a batch"""
    config = load_config_from_env()
    agent = load_agent()
    
    coordinator = BatchCoordinator(config, agent)
    
    platforms = args.platform.split(',') if args.platform else None
    count = args.count if hasattr(args, 'count') else None
    
    print(f"\n🎯 Manually triggering batch...")
    print(f"   Platforms: {platforms or 'all'}")
    print(f"   Count: {count or 'adaptive'}\n")
    
    result = await coordinator.execute_batch(
        platforms=platforms,
        niche=args.niche,
        force_count=count
    )
    
    print(f"\n✅ Batch completed: {result.successful_count}/{result.requested_count} videos")


def main():
    """Main CLI entry point"""
    
    parser = argparse.ArgumentParser(
        description="Antigravity - Automated AI Content Scheduler",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Run once
  python run.py --once
  
  # Run with specific platform
  python run.py --once --platform tiktok
  
  # Start scheduler
  python run.py --schedule
  
  # Run as daemon (Docker)
  python run.py --daemon
  
  # Manual trigger
  python run.py --manual --platform instagram --count 3
        """
    )
    
    # Mode selection (mutually exclusive)
    mode_group = parser.add_mutually_exclusive_group(required=True)
    mode_group.add_argument('--once', action='store_true', help='Run once and exit')
    mode_group.add_argument('--schedule', action='store_true', help='Start scheduled execution')
    mode_group.add_argument('--daemon', action='store_true', help='Run as daemon (blocking)')
    mode_group.add_argument('--status', action='store_true', help='Check status')
    mode_group.add_argument('--manual', action='store_true', help='Manual trigger')
    
    # Options
    parser.add_argument('--platform', type=str, help='Target platform(s) (comma-separated)')
    parser.add_argument('--niche', type=str, help='Content niche')
    parser.add_argument('--count', type=int, help='Force specific batch size')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose logging')
    
    args = parser.parse_args()
    
    # Adjust logging
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    # Route to appropriate function
    try:
        if args.once:
            asyncio.run(run_once(args))
        elif args.schedule:
            run_scheduled(args)
        elif args.daemon:
            run_daemon(args)
        elif args.status:
            check_status(args)
        elif args.manual:
            asyncio.run(manual_trigger(args))
    
    except Exception as e:
        logger.error(f"❌ Fatal error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
