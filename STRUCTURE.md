# Directory Structure

```
antigravity/
│
├── .github/                      # GitHub-specific files
│   └── workflows/
│       └── deploy.yml            # CI/CD (optional, for later)
│
├── scheduler/                    # Scheduler module
│   ├── __init__.py
│   ├── scheduler_config.py       # Configuration
│   ├── batch_coordinator.py      # Batch orchestration
│   └── antigravity_scheduler.py  # APScheduler wrapper
│
├── core/                         # Agent core (TODO: add your FSM agent here)
│   ├── __init__.py
│   ├── agent.py                  # Your Antigravity agent
│   ├── memory.py                 # Memory system
│   └── state.py                  # State management
│
├── tools/                        # Agent tools (TODO: add your tools here)
│   ├── __init__.py
│   └── ...
│
├── tests/                        # Tests
│   ├── __init__.py
│   ├── test_scheduler.py
│   ├── test_coordinator.py
│   └── test_integration.py
│
├── docs/                         # Documentation
│   ├── ARCHITECTURE.md
│   ├── API.md
│   └── CONTRIBUTING.md
│
├── logs/                         # Logs (gitignored)
│   └── .gitkeep
│
├── .env.example                  # Environment template
├── .gitignore                    # Git ignore rules
├── .dockerignore                 # Docker ignore rules
├── Dockerfile                    # Production container
├── docker-compose.yml            # Local development
├── railway.toml                  # Railway deployment config
├── deploy.sh                     # Deployment helper script
├── healthcheck.py                # Health check for Docker
├── run.py                        # Main entry point
├── requirements.txt              # Python dependencies
├── LICENSE                       # MIT License
├── README.md                     # Project overview
├── USAGE.md                      # Usage guide
└── DEPLOY.md                     # Deployment guide
```

## To create this structure:

```bash
# Create directories
mkdir -p scheduler core tools tests docs logs

# Create __init__.py files
touch scheduler/__init__.py core/__init__.py tools/__init__.py tests/__init__.py

# Create .gitkeep for empty directories
touch logs/.gitkeep
```

## Notes

- **scheduler/** — Complete and ready to use
- **core/** — Placeholder, add your FSM agent here
- **tools/** — Placeholder, add your agent tools here
- **tests/** — Add tests as you develop
- **docs/** — Documentation to be added
- **logs/** — Automatically created, gitignored
