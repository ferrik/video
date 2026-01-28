#!/bin/bash
# Antigravity Deployment Helper
# Quick commands for building, testing, and deploying

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# ============================================
# Command: build
# ============================================
build() {
    log_info "Building Docker image..."
    docker build -t antigravity:latest .
    log_info "✅ Build complete"
}

# ============================================
# Command: test
# ============================================
test() {
    log_info "Running container in test mode (one-shot)..."
    
    if [ ! -f .env ]; then
        log_error ".env file not found. Copy .env.example to .env first."
        exit 1
    fi
    
    docker run --rm \
        --env-file .env \
        antigravity:latest \
        python run.py --once --verbose
    
    log_info "✅ Test complete"
}

# ============================================
# Command: run
# ============================================
run() {
    log_info "Starting Antigravity scheduler..."
    
    docker-compose up -d
    
    log_info "✅ Scheduler started"
    log_info "View logs: docker-compose logs -f"
    log_info "Stop: docker-compose down"
}

# ============================================
# Command: logs
# ============================================
logs() {
    docker-compose logs -f antigravity
}

# ============================================
# Command: stop
# ============================================
stop() {
    log_info "Stopping Antigravity..."
    docker-compose down
    log_info "✅ Stopped"
}

# ============================================
# Command: status
# ============================================
status() {
    log_info "Container status:"
    docker-compose ps
    
    echo ""
    log_info "Recent logs:"
    docker-compose logs --tail=20 antigravity
}

# ============================================
# Command: shell
# ============================================
shell() {
    log_info "Opening shell in container..."
    docker-compose exec antigravity /bin/bash
}

# ============================================
# Command: deploy-railway
# ============================================
deploy_railway() {
    log_info "Deploying to Railway..."
    
    # Check if Railway CLI is installed
    if ! command -v railway &> /dev/null; then
        log_error "Railway CLI not found. Install: npm i -g @railway/cli"
        exit 1
    fi
    
    # Link project (first time only)
    if [ ! -f .railway ]; then
        log_warn "No Railway project linked. Run: railway link"
        exit 1
    fi
    
    # Deploy
    railway up
    
    log_info "✅ Deployed to Railway"
    log_info "View logs: railway logs"
}

# ============================================
# Command: clean
# ============================================
clean() {
    log_info "Cleaning up..."
    
    docker-compose down -v
    docker rmi antigravity:latest 2>/dev/null || true
    
    log_info "✅ Cleaned"
}

# ============================================
# Command: help
# ============================================
show_help() {
    cat << EOF
Antigravity Deployment Helper

Usage: ./deploy.sh [command]

Commands:
  build              Build Docker image
  test               Run one-shot test in container
  run                Start scheduler with docker-compose
  logs               View live logs
  stop               Stop scheduler
  status             Show container status and recent logs
  shell              Open shell in running container
  deploy-railway     Deploy to Railway.app
  clean              Remove containers and images
  help               Show this help

Examples:
  ./deploy.sh build
  ./deploy.sh test
  ./deploy.sh run
  ./deploy.sh logs

EOF
}

# ============================================
# Main
# ============================================
case "$1" in
    build)
        build
        ;;
    test)
        test
        ;;
    run)
        run
        ;;
    logs)
        logs
        ;;
    stop)
        stop
        ;;
    status)
        status
        ;;
    shell)
        shell
        ;;
    deploy-railway)
        deploy_railway
        ;;
    clean)
        clean
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        log_error "Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac
