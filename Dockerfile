# Antigravity Scheduler - Production Dockerfile
# Multi-stage build for minimal image size

# ============================================
# Stage 1: Builder
# ============================================
FROM python:3.11-slim as builder

WORKDIR /build

# Install build dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy only requirements first (Docker cache optimization)
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir --user -r requirements.txt

# ============================================
# Stage 2: Runtime
# ============================================
FROM python:3.11-slim

# Metadata
LABEL maintainer="antigravity"
LABEL version="1.0"
LABEL description="Antigravity Automated Content Scheduler"

# Create non-root user for security
RUN groupadd -r antigravity && \
    useradd -r -g antigravity antigravity

# Set working directory
WORKDIR /app

# Copy Python dependencies from builder
COPY --from=builder /root/.local /home/antigravity/.local

# Copy application code
COPY --chown=antigravity:antigravity . .

# Make run.py executable
RUN chmod +x run.py

# Environment variables (defaults, override with .env or --env)
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH=/home/antigravity/.local/bin:$PATH \
    ANTIGRAVITY_MODE=daemon \
    LOG_LEVEL=INFO

# Switch to non-root user
USER antigravity

# Health check (calls healthcheck.py)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python healthcheck.py || exit 1

# Expose port (if adding web dashboard later)
EXPOSE 8080

# Default command: run as daemon
CMD ["python", "run.py", "--daemon"]

# Alternative entry points (override with docker run):
# docker run antigravity python run.py --once
# docker run antigravity python run.py --schedule
