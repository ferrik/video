"""
Batch Coordinator for Antigravity
Manages batch execution with adaptive decision-making
"""

import asyncio
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple
from enum import Enum
import logging

from pydantic import BaseModel


logger = logging.getLogger(__name__)


class BatchStatus(str, Enum):
    """Status of batch execution"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    PARTIAL = "partial"
    FAILED = "failed"
    SKIPPED = "skipped"


class VideoResult(BaseModel):
    """Result of single video generation"""
    video_id: Optional[str] = None
    platform: str
    niche: str
    status: str  # success, failed, skipped
    error: Optional[str] = None
    generation_time: float
    metadata: Dict = {}


class BatchResult(BaseModel):
    """Result of batch execution"""
    batch_id: str
    status: BatchStatus
    requested_count: int
    successful_count: int
    failed_count: int
    skipped_count: int
    total_time: float
    videos: List[VideoResult]
    agent_decision: Dict = {}  # Agent's reasoning
    timestamp: datetime


class BatchCoordinator:
    """
    Coordinates batch video generation with adaptive scheduling
    
    Responsibilities:
    - Decide batch size based on agent input
    - Execute batch sequentially or parallel
    - Handle partial failures
    - Track metrics and health
    """
    
    def __init__(self, config, agent, memory_store=None):
        """
        Args:
            config: AntigravitySchedulerConfig
            agent: Antigravity FSM agent instance
            memory_store: Optional memory/analytics store
        """
        self.config = config
        self.agent = agent
        self.memory = memory_store
        
        # Runtime state
        self.current_batch: Optional[str] = None
        self.execution_history: List[BatchResult] = []
        
        # Rate limiting
        self.last_execution: Optional[datetime] = None
        self.daily_video_count = 0
        self.hourly_video_count = 0
        self.last_hour_reset = datetime.utcnow()
        self.last_day_reset = datetime.utcnow()
        
    async def execute_batch(
        self, 
        platforms: Optional[List[str]] = None,
        niche: Optional[str] = None,
        force_count: Optional[int] = None
    ) -> BatchResult:
        """
        Execute a batch of video generations
        
        Args:
            platforms: Target platforms (default: all enabled)
            niche: Content niche (default: agent decides)
            force_count: Force specific batch size (override agent)
        
        Returns:
            BatchResult with execution details
        """
        batch_id = f"batch_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
        self.current_batch = batch_id
        
        logger.info(f"🚀 Starting batch execution: {batch_id}")
        
        start_time = datetime.utcnow()
        
        try:
            # Step 1: Check if we should run at all
            if not await self._should_execute():
                return self._create_skipped_result(batch_id, "Rate limit or quiet hours")
            
            # Step 2: Ask agent to decide batch size
            batch_size = await self._determine_batch_size(force_count, platforms, niche)
            
            if batch_size == 0:
                return self._create_skipped_result(batch_id, "Agent vetoed execution")
            
            logger.info(f"📊 Batch size determined: {batch_size} videos")
            
            # Step 3: Execute videos
            results = await self._execute_videos(batch_size, platforms, niche)
            
            # Step 4: Compile results
            batch_result = self._compile_batch_result(
                batch_id, batch_size, results, start_time
            )
            
            # Step 5: Update metrics
            self._update_metrics(batch_result)
            
            # Step 6: Store in memory
            if self.memory:
                await self._store_batch_result(batch_result)
            
            logger.info(
                f"✅ Batch {batch_id} completed: "
                f"{batch_result.successful_count}/{batch_result.requested_count} successful"
            )
            
            return batch_result
            
        except Exception as e:
            logger.error(f"❌ Batch {batch_id} failed: {e}", exc_info=True)
            return self._create_failed_result(batch_id, str(e), start_time)
        
        finally:
            self.current_batch = None
    
    async def _should_execute(self) -> bool:
        """Check if batch execution should proceed"""
        
        # Reset counters if needed
        self._reset_counters()
        
        # Check daily limit
        if self.daily_video_count >= self.config.batch.max_daily_videos:
            logger.warning(f"⚠️ Daily limit reached: {self.daily_video_count}")
            return False
        
        # Check hourly limit
        if self.hourly_video_count >= self.config.batch.max_hourly_videos:
            logger.warning(f"⚠️ Hourly limit reached: {self.hourly_video_count}")
            return False
        
        # Check cooldown
        if self.last_execution:
            cooldown = timedelta(minutes=self.config.batch.api_cooldown_minutes)
            if datetime.utcnow() - self.last_execution < cooldown:
                logger.info("⏳ Cooldown period, skipping")
                return False
        
        # Check quiet hours
        if self._is_quiet_hours():
            logger.info("🌙 Quiet hours, skipping")
            return False
        
        return True
    
    def _is_quiet_hours(self) -> bool:
        """Check if current time is in quiet hours"""
        now = datetime.utcnow().time()
        start = self.config.schedule.quiet_hours_start
        end = self.config.schedule.quiet_hours_end
        
        if start < end:
            return start <= now <= end
        else:  # Quiet hours cross midnight
            return now >= start or now <= end
    
    def _reset_counters(self):
        """Reset hourly/daily counters if needed"""
        now = datetime.utcnow()
        
        # Hourly reset
        if now - self.last_hour_reset >= timedelta(hours=1):
            self.hourly_video_count = 0
            self.last_hour_reset = now
        
        # Daily reset
        if now - self.last_day_reset >= timedelta(days=1):
            self.daily_video_count = 0
            self.last_day_reset = now
    
    async def _determine_batch_size(
        self, 
        force_count: Optional[int],
        platforms: Optional[List[str]],
        niche: Optional[str]
    ) -> int:
        """
        Determine batch size adaptively
        
        Logic:
        1. If force_count provided → use it (within limits)
        2. If agent has veto power → ask agent
        3. Otherwise → use default
        """
        
        # Force count (admin override)
        if force_count is not None:
            return min(force_count, self.config.batch.max_videos)
        
        # Agent decides (adaptive mode)
        if self.config.batch.adaptive and self.config.agent_has_veto:
            try:
                decision = await self._ask_agent_for_batch_size(platforms, niche)
                return decision["batch_size"]
            except Exception as e:
                logger.error(f"Agent decision failed: {e}, using default")
                return self.config.batch.default_batch_size
        
        # Default
        return self.config.batch.default_batch_size
    
    async def _ask_agent_for_batch_size(
        self, 
        platforms: Optional[List[str]], 
        niche: Optional[str]
    ) -> Dict:
        """
        Ask agent to decide batch size based on current state
        
        This is where FSM + Memory integration happens
        """
        
        # Prepare context for agent
        context = {
            "current_metrics": {
                "daily_videos": self.daily_video_count,
                "hourly_videos": self.hourly_video_count,
                "remaining_daily": self.config.batch.max_daily_videos - self.daily_video_count,
            },
            "recent_performance": self._get_recent_performance(),
            "platforms": platforms or ["tiktok", "instagram"],
            "niche": niche,
            "time_of_day": datetime.utcnow().hour,
        }
        
        # Agent decision prompt
        decision_prompt = f"""
You are deciding how many videos to generate in this batch.

Current context:
- Daily videos created: {context['current_metrics']['daily_videos']}
- Remaining daily budget: {context['current_metrics']['remaining_daily']}
- Target platforms: {context['platforms']}
- Recent success rate: {context['recent_performance'].get('success_rate', 'unknown')}

Constraints:
- Min: {self.config.batch.min_videos}
- Max: {self.config.batch.max_videos}
- Default: {self.config.batch.default_batch_size}

Decide:
1. How many videos to generate (1-5)?
2. Should we proceed at all (you can veto)?

Respond with your reasoning and decision.
"""
        
        # Call agent (this integrates with your FSM)
        # For now, placeholder — you'll integrate with actual agent.run()
        
        try:
            # Example agent call (adapt to your FSM interface)
            # response = await self.agent.run(decision_prompt, context=context)
            
            # Placeholder: use default with some randomness based on time
            import random
            batch_size = self.config.batch.default_batch_size
            
            # Adjust based on time of day (simple heuristic)
            hour = datetime.utcnow().hour
            if 9 <= hour <= 11 or 15 <= hour <= 17:  # Peak times
                batch_size = min(batch_size + 1, self.config.batch.max_videos)
            
            return {
                "batch_size": batch_size,
                "reasoning": "Peak time adjustment",
                "should_proceed": True
            }
            
        except Exception as e:
            logger.error(f"Agent decision error: {e}")
            return {
                "batch_size": self.config.batch.default_batch_size,
                "reasoning": f"Fallback due to error: {e}",
                "should_proceed": True
            }
    
    async def _execute_videos(
        self, 
        count: int, 
        platforms: Optional[List[str]], 
        niche: Optional[str]
    ) -> List[VideoResult]:
        """Execute video generation batch"""
        
        results = []
        platforms = platforms or ["tiktok", "instagram"]
        
        logger.info(f"🎬 Generating {count} videos for {platforms}")
        
        for i in range(count):
            # Select platform (round-robin or weighted)
            platform = platforms[i % len(platforms)]
            
            logger.info(f"  [{i+1}/{count}] Generating for {platform}...")
            
            try:
                start = datetime.utcnow()
                
                # Call your actual agent here
                # video_result = await self.agent.generate_video(
                #     platform=platform,
                #     niche=niche
                # )
                
                # Placeholder
                await asyncio.sleep(2)  # Simulate generation
                
                result = VideoResult(
                    video_id=f"vid_{datetime.utcnow().timestamp()}",
                    platform=platform,
                    niche=niche or "general",
                    status="success",
                    generation_time=(datetime.utcnow() - start).total_seconds(),
                    metadata={"index": i}
                )
                
                results.append(result)
                logger.info(f"  ✅ Video {i+1} completed")
                
            except Exception as e:
                logger.error(f"  ❌ Video {i+1} failed: {e}")
                results.append(VideoResult(
                    platform=platform,
                    niche=niche or "general",
                    status="failed",
                    error=str(e),
                    generation_time=0
                ))
                
                # Decide whether to continue or abort batch
                if not self.config.batch.retry_on_failure:
                    logger.warning("Aborting batch due to failure")
                    break
        
        return results
    
    def _compile_batch_result(
        self, 
        batch_id: str, 
        requested: int, 
        results: List[VideoResult],
        start_time: datetime
    ) -> BatchResult:
        """Compile results into BatchResult"""
        
        successful = sum(1 for r in results if r.status == "success")
        failed = sum(1 for r in results if r.status == "failed")
        skipped = requested - len(results)
        
        if successful == requested:
            status = BatchStatus.COMPLETED
        elif successful > 0:
            status = BatchStatus.PARTIAL
        elif failed > 0:
            status = BatchStatus.FAILED
        else:
            status = BatchStatus.SKIPPED
        
        return BatchResult(
            batch_id=batch_id,
            status=status,
            requested_count=requested,
            successful_count=successful,
            failed_count=failed,
            skipped_count=skipped,
            total_time=(datetime.utcnow() - start_time).total_seconds(),
            videos=results,
            timestamp=datetime.utcnow()
        )
    
    def _update_metrics(self, result: BatchResult):
        """Update internal metrics"""
        self.daily_video_count += result.successful_count
        self.hourly_video_count += result.successful_count
        self.last_execution = datetime.utcnow()
        self.execution_history.append(result)
        
        # Keep only last 100 batches in memory
        if len(self.execution_history) > 100:
            self.execution_history = self.execution_history[-100:]
    
    def _get_recent_performance(self) -> Dict:
        """Get recent performance metrics"""
        if not self.execution_history:
            return {"success_rate": None}
        
        recent = self.execution_history[-10:]  # Last 10 batches
        total_requested = sum(b.requested_count for b in recent)
        total_successful = sum(b.successful_count for b in recent)
        
        return {
            "success_rate": total_successful / total_requested if total_requested > 0 else 0,
            "avg_batch_size": total_requested / len(recent),
            "total_batches": len(recent)
        }
    
    async def _store_batch_result(self, result: BatchResult):
        """Store result in memory/database"""
        # Integrate with your memory system
        logger.info(f"💾 Storing batch result: {result.batch_id}")
    
    def _create_skipped_result(self, batch_id: str, reason: str) -> BatchResult:
        """Create a skipped batch result"""
        return BatchResult(
            batch_id=batch_id,
            status=BatchStatus.SKIPPED,
            requested_count=0,
            successful_count=0,
            failed_count=0,
            skipped_count=0,
            total_time=0,
            videos=[],
            agent_decision={"reason": reason},
            timestamp=datetime.utcnow()
        )
    
    def _create_failed_result(
        self, 
        batch_id: str, 
        error: str, 
        start_time: datetime
    ) -> BatchResult:
        """Create a failed batch result"""
        return BatchResult(
            batch_id=batch_id,
            status=BatchStatus.FAILED,
            requested_count=0,
            successful_count=0,
            failed_count=1,
            skipped_count=0,
            total_time=(datetime.utcnow() - start_time).total_seconds(),
            videos=[],
            agent_decision={"error": error},
            timestamp=datetime.utcnow()
        )
    
    def get_stats(self) -> Dict:
        """Get current statistics"""
        return {
            "daily_videos": self.daily_video_count,
            "hourly_videos": self.hourly_video_count,
            "total_batches": len(self.execution_history),
            "recent_performance": self._get_recent_performance(),
            "is_running": self.current_batch is not None,
            "current_batch": self.current_batch
        }
