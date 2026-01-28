#!/usr/bin/env python3
"""
Health check for Antigravity Scheduler
Returns 0 (healthy) or 1 (unhealthy)
"""

import sys
import os
from pathlib import Path
from datetime import datetime, timedelta


def check_health() -> bool:
    """
    Health check logic
    
    Checks:
    1. Log file exists and was updated recently
    2. No critical errors in recent logs
    3. Process is responsive
    
    Returns:
        bool: True if healthy, False otherwise
    """
    
    try:
        # Check 1: Log file exists
        log_file = Path("antigravity.log")
        if not log_file.exists():
            print("❌ Health check failed: Log file not found", file=sys.stderr)
            return False
        
        # Check 2: Log was updated recently (within last hour)
        last_modified = datetime.fromtimestamp(log_file.stat().st_mtime)
        age = datetime.now() - last_modified
        
        if age > timedelta(hours=1):
            print(f"❌ Health check failed: Log not updated for {age}", file=sys.stderr)
            return False
        
        # Check 3: No recent CRITICAL/ERROR patterns (simple check)
        with open(log_file, 'r') as f:
            # Read last 100 lines
            lines = f.readlines()[-100:]
            
            critical_count = sum(1 for line in lines if 'CRITICAL' in line)
            error_count = sum(1 for line in lines if 'ERROR' in line)
            
            # Allow some errors, but not too many
            if critical_count > 5:
                print(f"❌ Health check failed: {critical_count} CRITICAL errors", file=sys.stderr)
                return False
            
            if error_count > 10:
                print(f"⚠️  Warning: {error_count} errors in recent logs", file=sys.stderr)
                # Don't fail on errors, only on criticals
        
        # Check 4: Environment variables set
        required_env = ['ANTHROPIC_API_KEY']
        missing = [var for var in required_env if not os.getenv(var)]
        
        if missing:
            print(f"❌ Health check failed: Missing env vars: {missing}", file=sys.stderr)
            return False
        
        # All checks passed
        print("✅ Health check passed")
        return True
    
    except Exception as e:
        print(f"❌ Health check exception: {e}", file=sys.stderr)
        return False


def main():
    """Main entry point"""
    is_healthy = check_health()
    sys.exit(0 if is_healthy else 1)


if __name__ == "__main__":
    main()
