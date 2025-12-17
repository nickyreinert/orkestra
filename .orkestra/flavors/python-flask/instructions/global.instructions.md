# Global Instructions

## Core
- Lang: EN only (code, vars, docs)
- Folders: group by feature
- Modular: separate concerns/files
- Clean: readable, low complexity, descriptive names
- reuse funcs and avoid redundancy
- prefer removing old code
- parameters and configurable data like urls, keys, paths are maintained in config files only (not hardcoded)
- config.json for non-sensitive config, data models, constants
- .env for sensitive config (API keys, passwords)
- microservice approach: frontend, backend, API separated
- use virtual env + requirements.txt
- avoid external dependencies unless necessary
- execution targets are
    - local and direct via app.py
    - containerized via Docker
    - via Docker on Coolify
- Only do requested task, be self sceptic, not suggest or assume, ask if unclear
- keep preambles to a single declarative sentence ("I'm scanning the repo and then drafting a minimal fix.") — no approval requests.
- replace "propose a follow-up" with "propose and execute the best alternative by default; ask only for destructive/irreversible choices."

## Structure
(project folder layout)
```
project/
├── app.py
├── config.json
├── .env.example
├── .gitignore
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── README.md
├── UNFINISHED.md
├── ARCHITECTURE.md
├── functions/
│   ├── ui/
│   ├── auth/
│   ├── data/
│   └── api/
├── templates/
├── static/
│   ├── css/
│   ├── js/
│   └── images/
├── tests/{test_ui,test_auth,test_data}/
│   ├── test_ui/
│   ├── test_auth/
│   ├── test_data/
└── utils/
    └── logger.py
```

## Docs
- README.md: brief bullets points, consists of three parts:
    - purpose
    - setup as-is
    - setup in Docker
    - usage examples
- UNFINISHED.md
    - current task the AI agent is working on, prune if task is done and user confirms
- ARCHITECTURE.md
    - high-level system overview based on file system: FOLDERS -> SUBFOLDERS -> FILES -> MODULES -> FUNCTIONS/CLASSES
    - strictly brief explaination of interdependencies and purposes
- No historical notes ("Previously", "Fixed", "Changed")

# Workflow

## Repo Management
- local git repo must exist
- commit after each task
- Commit msg: `[feat|fix|refactor|docs]: short, brief, bullet point description`

## Context Management
- At start of every iteration: Re-read copilot-instructions.md, UNFINISHED.md and README.md
- After 3 failed attempts on same task:
    1. Log "Blocked" in UNFINISHED.md
    2. Ask user for alternative approach
- On "Refresh context" command:
    1.  Reload all anchor files and restate current task + constraints

## Workflow
1. Setup folder structure + Docker
2. Config .env + config.py
3. Logging system
4. Modular funcs + tests
5. Security validation
6. Update README.md + UNFINISHED.md
8. Run full_test.py `run_tests`
9. Commit if tests pass

# IMPORTANT Global Restrictions
- No emojis
- No example text unless asked
- No removing comments
- No anticipating needs
- No globals
- No direct SQL
- No apologizing

# IMPORTANT Global Mindset
- Validate assumptions
- Assume you dont have all context
- Don’t declare “final” until user confirms
- always refer to UNFINISHED.md to prevent redundant work
- be pragmatic, concise, blunt, honest
- After EVERY user msg → re-read this file
