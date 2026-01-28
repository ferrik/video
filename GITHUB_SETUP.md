# GitHub Repository Setup Instructions

## 🎯 Quick Setup (5 minutes)

### Step 1: Create Repository on GitHub

1. Go to https://github.com/new
2. Repository name: `antigravity` (or your preferred name)
3. Description: "AI-powered content testing laboratory"
4. Visibility: **Private** (recommended) or Public
5. **Don't initialize** with README, .gitignore, or license (we have them)
6. Click **Create repository**

### Step 2: Prepare Local Files

Download all files from Claude and organize them:

```bash
# Create project directory
mkdir antigravity
cd antigravity

# Create subdirectories
mkdir -p scheduler core tools tests docs logs

# Move files to correct locations:
# 
# Root directory:
# - run.py
# - requirements.txt
# - .env.example
# - .gitignore
# - .dockerignore
# - Dockerfile
# - docker-compose.yml
# - railway.toml
# - deploy.sh
# - healthcheck.py
# - README.md
# - USAGE.md
# - DEPLOY.md
# - LICENSE
# - STRUCTURE.md (this file)
#
# scheduler/ directory:
# - scheduler_config.py
# - batch_coordinator.py
# - antigravity_scheduler.py

# Create __init__.py files
touch scheduler/__init__.py
touch core/__init__.py
touch tools/__init__.py
touch tests/__init__.py

# Create .gitkeep for empty directories
touch logs/.gitkeep

# Make deploy.sh executable
chmod +x deploy.sh
```

### Step 3: Initialize Git

```bash
# Initialize git repository
git init

# Add all files
git add .

# Initial commit
git commit -m "Initial commit: Scheduler foundation + Docker deployment"

# Add remote (replace YOUR_USERNAME and YOUR_REPO)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git

# Push to GitHub
git branch -M main
git push -u origin main
```

---

## 📁 File Organization Checklist

Before pushing to GitHub, verify this structure:

```
✅ antigravity/
   ✅ scheduler/
      ✅ __init__.py
      ✅ scheduler_config.py
      ✅ batch_coordinator.py
      ✅ antigravity_scheduler.py
   ✅ core/
      ✅ __init__.py
      📝 agent.py (TODO: add your agent)
      📝 memory.py (TODO: add your memory)
      📝 state.py (TODO: add your state)
   ✅ tools/
      ✅ __init__.py
   ✅ tests/
      ✅ __init__.py
   ✅ docs/
   ✅ logs/
      ✅ .gitkeep
   ✅ .env.example
   ✅ .gitignore
   ✅ .dockerignore
   ✅ Dockerfile
   ✅ docker-compose.yml
   ✅ railway.toml
   ✅ deploy.sh (executable)
   ✅ healthcheck.py
   ✅ run.py
   ✅ requirements.txt
   ✅ README.md
   ✅ USAGE.md
   ✅ DEPLOY.md
   ✅ LICENSE
   ✅ STRUCTURE.md
```

---

## 🔐 Security Checklist

Before pushing:

- [ ] `.env` is in `.gitignore` (it is ✅)
- [ ] No API keys in code
- [ ] No hardcoded secrets
- [ ] `.env.example` has placeholder values only

---

## 🚀 After Pushing to GitHub

### 1. Add Repository Secrets (for Railway auto-deploy)

If you want auto-deploy from GitHub to Railway:

1. Go to repository **Settings** → **Secrets and variables** → **Actions**
2. Add secrets:
   - `RAILWAY_TOKEN` (get from `railway login --token`)
   - `ANTHROPIC_API_KEY`
   - Other API keys as needed

### 2. Set Up GitHub Actions (Optional)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Railway

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install Railway
        run: npm i -g @railway/cli
      
      - name: Deploy
        run: railway up
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
```

### 3. Update README

After creating repo, update README.md:

```bash
# Replace this line:
git clone https://github.com/yourusername/antigravity.git

# With your actual repo:
git clone https://github.com/YOUR_USERNAME/antigravity.git
```

---

## 🔄 Working with Git (Daily Workflow)

### Making Changes

```bash
# Check status
git status

# Add changes
git add .

# Commit
git commit -m "Add: description of changes"

# Push to GitHub
git push
```

### Creating Branches (for new features)

```bash
# Create and switch to new branch
git checkout -b feature/video-pipeline

# Make changes, commit
git add .
git commit -m "Add video pipeline integration"

# Push branch
git push -u origin feature/video-pipeline

# On GitHub: Create Pull Request
```

---

## 📊 Recommended GitHub Settings

### Repository Settings

1. **Branches** → **Branch protection rules**
   - Protect `main` branch
   - Require pull request reviews (if team)
   - Require status checks to pass

2. **General**
   - Enable Issues
   - Enable Discussions (for community)
   - Disable Wiki (use docs/ folder instead)

### .github/ Folder (Optional)

Create these files in `.github/`:

```
.github/
├── ISSUE_TEMPLATE/
│   ├── bug_report.md
│   └── feature_request.md
├── PULL_REQUEST_TEMPLATE.md
└── workflows/
    └── deploy.yml
```

---

## 🎯 Next Steps After GitHub Setup

1. ✅ Push to GitHub
2. ✅ Verify all files are there
3. ✅ Check .gitignore is working (no .env, logs/)
4. 🔜 Deploy to Railway from GitHub
5. 🔜 Add your agent code to `core/`
6. 🔜 Add video pipeline

---

## ❓ Common Issues

### Issue: "Repository already exists"

**Solution:**
```bash
# Remove existing remote
git remote remove origin

# Add correct remote
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
```

### Issue: "Permission denied"

**Solution:**
```bash
# Use SSH instead of HTTPS
git remote set-url origin git@github.com:YOUR_USERNAME/YOUR_REPO.git

# Or authenticate with:
gh auth login
```

### Issue: ".env file accidentally pushed"

**Solution:**
```bash
# Remove from Git (but keep locally)
git rm --cached .env

# Add to .gitignore (already there)
echo ".env" >> .gitignore

# Commit
git add .gitignore
git commit -m "Remove .env from tracking"
git push

# Rotate all API keys that were exposed!
```

---

## ✅ Verification

After pushing, verify on GitHub:

- [ ] All files visible
- [ ] README displays correctly
- [ ] .env is NOT visible (good!)
- [ ] logs/ directory is there but empty (good!)
- [ ] deploy.sh has executable permissions

---

**Ready to push? Let's go! 🚀**
