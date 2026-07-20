# Design: Hooks + Topologies für Orkestra

Status: **draft** — zur Diskussion vor Implementierung

---

## 1. Ziel

Orkestra soll nach `orkestra init` nicht nur Agent-Instructions liefern,
sondern auch **Qualitäts-Enforcement** (Git-Hooks) und **Stack-spezifische
Bundles** (Topologies). Beides bleibt so einfach und selbsterklärend wie
Orkestra selbst — kein SDLC-Overkill wie ApexYard.

### Nicht-Ziele (bewusst ausgelassen)

- Keine Rollen, kein Ticket-System, keine Merge-Gate-Marker-Dateien
- Keine Governance-Infrastruktur (AgDR, CEO-Approval, etc.)
- Keine Abhängigkeit von `gh` CLI oder externen Diensten
- Hooks sind optional, nicht erzwungen

---

## 2. Zwei neue Konzepte

### 2.1 Hooks

Ein **Hook** ist ein Shell-Script, das an einem Git-Event hängt
(`pre-commit`, `commit-msg`, `pre-push`). Orkestra liefert eine Sammlung
nützlicher Hooks mit und installiert sie auf Wunsch in `.git/hooks/`.

**Quellen-Layout** (in der Distribution):

```
content/
  hooks/
    common/
      check-secrets.sh          # blockiert API-Keys, Tokens in staged files
      validate-commit-msg.sh    # prüft "type: subject" Format
      block-main-push.sh        # verhindert direkten Push auf main
    python/
      run-pytest.sh             # pre-push: pytest muss grün sein
      check-type-hints.sh       # pre-commit: mypy auf staged files
    typescript/
      run-lint.sh               # pre-push: eslint/tsc muss grün sein
      check-imports.sh          # pre-commit: keine circular imports
    go/
      run-tests.sh              # pre-push: go test ./...
```

**Projekt-Layout** (nach Install):

```
my-project/
  .orkestra/
    hooks/
      manifest.yaml             # welche Hooks aktiv sind + ihre Checksums
  .git/
    hooks/
      pre-commit                # generiert von Orkestra, ruft ork-Hook-Scripts
      commit-msg                # generiert von Orkestra
      pre-push                  # generiert von Orkestra
```

Der generierte `.git/hooks/pre-commit` ist ein **Dispatcher** — er ruft
alle aktivierten Orkestra-Hook-Scripts der Reihe nach auf. So bleibt
`.git/hooks/` sauber und Hooks sind einzeln de-/aktivierbar.

Beispiel generierter Dispatcher:

```bash
#!/usr/bin/env bash
# orkestra:generated hooks/pre-commit
set -euo pipefail
source .orkestra/hooks/runner.sh  # kopiert bei install, bleibt lokal
ork_run_hooks pre-commit
```

`runner.sh` liest `.orkestra/hooks/manifest.yaml` und ruft nur aktive
Scripts auf.

### 2.2 Topologies

Eine **Topology** ist ein gebündeltes Paket für einen bestimmten
Projekt-Typ. Sie gruppiert Instructions, Hooks und CI-Workflows, die
für diesen Stack sinnvoll sind.

Eine Topology ist **kein Ersatz für ein Template** — sie erweitert es.
Template = Projekt-Typ-Scaffolding. Topology = Quality-Stack dazu.

Topologies können einem Template zugewiesen sein (`python-flask` →
Topology `python`) oder manuell gewählt werden.

**Quellen-Layout** (in der Distribution):

```
content/
  topologies/
    python/
      topology.yaml             # Metadaten + Default-Hooks-Liste
      hooks/                    # Topology-spezifische Hooks (optional)
      instructions/             # Topology-spezifische Instructions
      ci/                       # CI-Workflow-Templates (optional)
        github-actions.yml
    typescript/
      topology.yaml
      hooks/
      instructions/
      ci/
        github-actions.yml
    go/
      topology.yaml
      hooks/
      instructions/
```

Beispiel `topology.yaml`:

```yaml
name: python
description: Python projects (Flask, FastAPI, CLI tools)
default_hooks:
  pre-commit:
    - common/check-secrets.sh
    - python/check-type-hints.sh
  commit-msg:
    - common/validate-commit-msg.sh
  pre-push:
    - common/block-main-push.sh
    - python/run-pytest.sh
instructions:
  - instructions/python-standards.md
ci:
  github_actions: ci/github-actions.yml
```

---

## 3. CLI-Erweiterungen

### 3.1 `orkestra init` — neues `--topology` Flag

```
orkestra init [--template T] [--topology TOP] [--agents a,b] [--hooks] [-y]
```

Im interaktiven Wizard:

```
Pick a template:  python-flask
Apply topology?   python (recommended for python-flask)  ← vorausgefüllt
Install hooks?    yes / no
Add CI workflow?  yes / no
```

Wenn `--hooks` gesetzt oder im Wizard "yes" gewählt → `.git/hooks/`
Dispatcher + `.orkestra/hooks/manifest.yaml` werden geschrieben.

### 3.2 `orkestra hooks` — neuer Unterbefehl

```
orkestra hooks list             # zeigt aktive Hooks + Event-Zuordnung
orkestra hooks install          # (re-)installiert Dispatcher in .git/hooks/
orkestra hooks add <name>       # aktiviert einen Hook (trägt in manifest.yaml ein)
orkestra hooks remove <name>    # deaktiviert einen Hook
orkestra hooks run <event>      # manueller Test: führt alle Hooks für <event> aus
```

### 3.3 `orkestra topology` — neuer Unterbefehl

```
orkestra topology list          # zeigt verfügbare Topologies
orkestra topology apply <name>  # wendet Topology auf aktuelles Projekt an
orkestra topology status        # zeigt aktive Topology + Drift zu Distribution
```

### 3.4 `orkestra update` — Erweiterung

Bestehend: re-rendert Instructions auf neue Distribution-Versionen.
Neu: vergleicht auch Hook-Scripts + Topology-Dateien (Checksums aus
`manifest.yaml`) und bietet Updates an.

---

## 4. Manifest-Erweiterungen

Das bestehende `.orkestra/manifest.yaml` erhält zwei neue Sektionen:

```yaml
# bestehend
orkestra_version: 2.0.0
template: python-flask
agents: [copilot, claude]
sources: [...]

# neu
topology: python

hooks:
  pre-commit:
    - id: common/check-secrets
      sha256: 9f1c…
      enabled: true
    - id: python/check-type-hints
      sha256: a3f7…
      enabled: true
  commit-msg:
    - id: common/validate-commit-msg
      sha256: b8d2…
      enabled: true
  pre-push:
    - id: common/block-main-push
      sha256: c1e9…
      enabled: true
    - id: python/run-pytest
      sha256: d4a5…
      enabled: false          # user hat deaktiviert

ci:
  github_actions:
    installed: true
    sha256: e6b3…
    path: .github/workflows/ci.yml
```

---

## 5. Implementierungs-Reihenfolge

### Phase 1 — Hooks (unabhängig von Topologies)

1. `content/hooks/common/` — die drei nützlichsten Hooks
   - `check-secrets.sh` (blockiert `api_key=`, `password=`, `token=` in staged files)
   - `validate-commit-msg.sh` (prüft `type: subject` Format)
   - `block-main-push.sh` (blockiert `git push origin main`)
2. `lib/core/hooks.sh` — Hook-Runner + Manifest-Helpers
3. `lib/cli/hooks.sh` — `orkestra hooks` Unterbefehl
4. `bin/orkestra` Dispatch-Eintrag für `hooks`
5. `lib/cli/init.sh` — `--hooks` Flag + Wizard-Frage
6. `orkestra doctor` — prüft ob Hooks installiert + aktuell sind

### Phase 2 — Topologies

1. `content/topologies/python/` + `content/topologies/typescript/`
2. `lib/core/topology.sh` — Topology-Helpers (laden, anwenden, Drift-Check)
3. `lib/cli/topology.sh` — `orkestra topology` Unterbefehl
4. `lib/cli/init.sh` — `--topology` Flag + empfohlene Topology
5. CI-Templates unter `content/topologies/<name>/ci/`
6. `orkestra update` — Topology-Drift-Erkennung

### Phase 3 — Stack-spezifische Hooks

1. `content/hooks/python/`
2. `content/hooks/typescript/`
3. `content/hooks/go/`

---

## 6. Designentscheidungen

| Entscheidung | Begründung |
|---|---|
| Hooks sind optional, kein Zwang | Orkestra soll *helfen*, nicht blocken — User entscheidet |
| Dispatcher-Pattern für `.git/hooks/` | Ein Script pro Event statt viele; einzelne Hooks de-/aktivierbar ohne `.git/hooks/` anzufassen |
| `runner.sh` wird lokal kopiert, nicht symlinked | Symlinks brechen wenn `~/.orkestra` bewegt wird; kopierte Datei ist stabil |
| Topology ≠ Template | Templates scaffolden Projekt-Code; Topologies liefern Quality-Stack — trennbar |
| `topology.yaml` statt Code | Deklarativ, lesbar, ohne Bash-Kenntnisse anpassbar |
| Hooks in `content/hooks/` nach Sprache gruppiert | Eindeutig, discoverable, leicht erweiterbar durch User in `~/.config/orkestra/hooks/` |
| Keine externen Abhängigkeiten | Hooks brauchen nur Bash + Standard-Unix-Tools (grep, awk, git) |

---

## 7. Offene Fragen (vor Implementierung klären)

1. **Hook-Konflikte**: Was passiert wenn das Projekt bereits `.git/hooks/pre-commit` hat?
   → Vorschlag: Backup als `pre-commit.pre-orkestra`, Dispatcher anfügen

2. **Monorepo**: Soll `orkestra init` auch in Unterverzeichnissen arbeiten, die kein
   eigenes `.git/` haben?
   → Vorschlag: v1 nur Projekte mit eigenem `.git/`, Monorepo-Support deferred

3. **Topology-Überschreibung durch User**: Soll `~/.config/orkestra/topologies/` custom
   Topologies erlauben (analog zu custom Templates)?
   → Vorschlag: Ja, gleiche User-Dir-Wins-Logik wie bei Templates

4. **Windows-Kompatibilität**: Git-Hooks unter Windows (Git Bash)?
   → Vorschlag: Explizit nicht unterstützt in v1, Hinweis in docs

---

## 8. Dateien die entstehen (vollständige Liste)

### Neue Dateien in Distribution (`~/.orkestra/`)

```
content/hooks/
  common/
    check-secrets.sh
    validate-commit-msg.sh
    block-main-push.sh
  python/
    run-pytest.sh
    check-type-hints.sh
  typescript/
    run-lint.sh
  go/
    run-tests.sh

content/topologies/
  python/
    topology.yaml
    instructions/python-standards.md
    ci/github-actions.yml
  typescript/
    topology.yaml
    instructions/typescript-standards.md
    ci/github-actions.yml

lib/core/
  hooks.sh                    # neu
  topology.sh                 # neu

lib/cli/
  hooks.sh                    # neu (orkestra hooks Unterbefehl)
  topology.sh                 # neu (orkestra topology Unterbefehl)
```

### Geänderte Dateien

```
lib/cli/init.sh               # --topology, --hooks Flags + Wizard
lib/core/manifest.sh          # hooks: + topology: Sektionen schreiben/lesen
lib/core/paths.sh             # ork_list_topologies(), ork_topology_dir()
bin/orkestra                  # Dispatch für hooks + topology
ARCHITECTURE.md               # Konzepte Hooks + Topologies ergänzen
```

### Neue Dateien im User-Projekt (nach `orkestra init --hooks`)

```
.orkestra/
  hooks/
    manifest.yaml             # aktive Hooks + Checksums
    runner.sh                 # kopiert aus Distribution
.git/hooks/
  pre-commit                  # Dispatcher (generiert)
  commit-msg                  # Dispatcher (generiert)
  pre-push                    # Dispatcher (generiert)
```
