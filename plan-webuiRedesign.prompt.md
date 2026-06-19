# Plan: Orkestra Config-Driven Deployment Model & WebUI Redesign

## Goal

Orkestra soll eine zentrale, agent-agnostische aber agent-spezifisch konfigurierbare Deployment-Registry bekommen. Diese Config beschreibt, welche Agents existieren, welche Item-Typen unterstuetzt werden, welche Sources deploybar sind, wohin sie auf Global- oder Project-Scope installiert werden und welche Deployment-Strategie dafuer gilt.

CLI und WebUI nutzen dieselbe Config-Semantik. Die WebUI ist dabei die visuelle Oberflaeche fuer Auswahl, Status, Preview und Diff; die CLI ist die scriptbare Oberflaeche fuer dieselben Deployment-Regeln.

## Core Decisions

- **Zentrale Config ist Source of Truth**: Keine hardcodierten Agent-Zielpfade in WebUI oder CLI, ausser als Uebergangsschicht.
- **Deployment ist deklarativ**: Agent, Scope, Item-Typ, Source, Target und Strategy kommen aus der Config.
- **WebUI ist kein eigener Renderer**: Sie zeigt Config-State, Ziel-State und Diffs, stoesst aber dieselbe Deployment-Engine an wie die CLI.
- **Item-Typen haben unterschiedliche Strategien**: Instructions koennen gebuendelt werden; Skills, MCP, Plugins und Workflows werden kopiert oder spaeter gemerged.
- **Global und Project sind gleichwertige Scopes**: Beide koennen Instructions, Skills, MCP, Plugins usw. aufnehmen.
- **Project Scope ist template-/framework-relevant**: Project Deployments koennen von Template, Sprache oder Framework abhaengen.
- **Gitignore/Tracked ist Backend-Verantwortung**: Frontend zeigt nur den vom Backend ermittelten Status.

## Step 1: Config-Schema definieren

**Datei:** `settings/agents-config.yaml`

Die Config beschreibt Agents, Item-Typen und konkrete Deployment-Regeln.

### Mindest-Schema

```yaml
version: 1

agents:
  - id: claude
    label: Claude
    enabled: true

  - id: codex
    label: Codex
    enabled: true

  - id: copilot
    label: Copilot
    enabled: true

item_types:
  - id: instructions
    label: Instructions
    source_roots:
      - instructions/global
      - templates/{template}/instructions
    default_strategy: bundle

  - id: skills
    label: Skills
    source_roots:
      - skills
    default_strategy: copy_tree

  - id: mcp
    label: MCP
    source_roots:
      - mcp
    default_strategy: copy_file

  - id: workflows
    label: Workflows
    source_roots:
      - workflows
    default_strategy: copy_file

  - id: plugins
    label: Plugins
    source_roots:
      - plugins
    default_strategy: copy_tree

deployments:
  - id: claude-global-instructions
    agent: claude
    item_type: instructions
    scope: global
    source:
      - instructions/global/*.md
    target: ~/CLAUDE.md
    strategy: bundle
    gitignore: false

  - id: claude-project-instructions
    agent: claude
    item_type: instructions
    scope: project
    source:
      - instructions/global/*.md
      - templates/{template}/instructions/*.md
    target: CLAUDE.md
    strategy: bundle
    gitignore: false

  - id: claude-global-skills
    agent: claude
    item_type: skills
    scope: global
    source:
      - skills/claude/*
    target: ~/.claude/skills/
    strategy: copy_tree
    gitignore: false

  - id: claude-project-skills
    agent: claude
    item_type: skills
    scope: project
    source:
      - skills/claude/*
    target: .claude/skills/
    strategy: copy_tree
    gitignore: false

  - id: copilot-project-main-instructions
    agent: copilot
    item_type: instructions
    scope: project
    source:
      - instructions/global/*.md
    target: .github/copilot-instructions.md
    strategy: bundle
    gitignore: false

  - id: copilot-project-template-instructions
    agent: copilot
    item_type: instructions
    scope: project
    source:
      - templates/{template}/instructions/*.md
    target: .github/instructions/
    strategy: copy_file
    gitignore: false

  - id: codex-project-instructions
    agent: codex
    item_type: instructions
    scope: project
    source:
      - instructions/global/*.md
      - templates/{template}/instructions/*.md
    target: AGENTS.md
    strategy: bundle
    gitignore: false
```

### Config-Requirements

- Unterstuetzt `{template}` als Platzhalter.
- Unterstuetzt `~` fuer Global Targets.
- Unterstuetzt Source-Globs.
- Deployment-Regeln sind ueber `id` eindeutig.
- Neue Agents und Item-Typen koennen hinzugefuegt werden, ohne WebUI-Code umzubauen.
- Schema bleibt bewusst einfach genug fuer dependency-arme Parser.

## Step 2: Config Loader und Validierung bauen

**Dateien:**

- `tools/webui_server.py`
- optional neu: `lib/core/agents_config.sh`
- optional neu: `tools/agents_config.py`

### Aufgaben

- `load_agents_config()` implementieren.
- Config validieren:
  - `version` vorhanden
  - eindeutige Agent IDs
  - eindeutige Item-Type IDs
  - eindeutige Deployment IDs
  - Deployment referenziert existierenden Agent
  - Deployment referenziert existierenden Item-Typ
  - `scope` ist `global` oder `project`
  - `strategy` ist bekannt
- Endpoint hinzufuegen:
  - `GET /api/agents-config`
- In `/api/templates` oder einem neuen Index-Endpoint Deployment-Metadaten mitliefern.

### Wichtige Entscheidung

Da Python kein YAML in der Standardbibliothek hat:

- Entweder eine stark begrenzte YAML-Teilmenge parsern,
- oder Config als JSON/TOML strukturieren,
- oder bewusst PyYAML als Dependency einfuehren.

Empfehlung: Fuer dieses Projekt entweder einfache YAML-Subset-Regeln dokumentieren oder JSON verwenden, wenn Robustheit wichtiger ist als Lesbarkeit.

## Step 3: Deployment Engine zentralisieren

**Ziel:** Eine zentrale Deployment-Schicht, die von CLI und WebUI verwendet wird.

**Moegliche Dateien:**

- `tools/webui_server.py` als erster Implementierungsort
- spaeter extrahieren nach:
  - `tools/deploy_engine.py`
  - `lib/cli/deploy.sh`
  - `lib/core/deploy.sh`

### Neue zentrale Operation

Konzeptionell:

```text
deploy(agent, scope, deployment_ids, selected_sources, template)
```

### Unterstuetzte Strategien

1. **`bundle`**
   - Mehrere Text-/Markdown-Sources werden zu einer Zieldatei kombiniert.
   - Geeignet fuer `CLAUDE.md`, `AGENTS.md`, `copilot-instructions.md`.

2. **`copy_file`**
   - Source-Dateien werden einzeln in ein Zielverzeichnis kopiert.
   - Geeignet fuer `.github/instructions/*.md`, Workflows, einzelne MCP-Dateien.

3. **`copy_tree`**
   - Source-Verzeichnisse werden rekursiv kopiert.
   - Geeignet fuer Skills, Plugins.

4. **`merge_json`** spaeter
   - Fuer MCP-Configs, wenn mehrere Quellen in eine bestehende JSON-Config gemerged werden muessen.
   - Fuer die erste Version kann `copy_file` reichen.

### Wichtig

`compose_selected_sources_bundle()` darf nicht zur generischen Deployment-Loesung fuer alle Item-Typen werden. Es bleibt eine Strategy-Implementierung fuer `bundle`.

## Step 4: CLI an Config-Deployment anbinden

**Betroffene Dateien:**

- `lib/cli/init.sh`
- `lib/cli/render.sh`
- optional neu: `lib/cli/deploy.sh`
- `bin/orkestra`

### Aufgaben

- Neuen CLI-Befehl einfuehren:

```bash
orkestra deploy --agent claude --scope global --item-type skills
orkestra deploy --agent copilot --scope project --deployment copilot-project-main-instructions
orkestra deploy --agent claude --scope project --template python-flask
```

- `orkestra init` nutzt Config-Deployments fuer Project Scope.
- `orkestra render` nutzt Config-Deployments statt hardcodierter Adapter-Ziele, oder bleibt zunaechst Adapter-basiert und wird schrittweise migriert.
- Bestehende Adapter koennen als Uebergang weiterleben, sollten aber perspektivisch aus Config-Regeln gespeist werden.

### Uebergangsstrategie

Nicht alles sofort ersetzen. Erst:

- Config einfuehren.
- WebUI und neue Deploy-API darauf setzen.
- Bestehendes `render` kompatibel halten.
- Danach Adapterpfade schrittweise config-driven machen.

## Step 5: Backend API fuer Deployment-State erweitern

**Datei:** `tools/webui_server.py`

### Neue oder erweiterte Endpoints

```text
GET  /api/agents-config
GET  /api/deploy-index
POST /api/deploy
GET  /api/file
POST /api/compare-files
```

### `GET /api/deploy-index`

Liefert alles, was die WebUI braucht:

```json
{
  "agents": [],
  "itemTypes": [],
  "deployments": [],
  "sourceItems": [],
  "globalItems": [],
  "projectItems": [],
  "project": {
    "path": "...",
    "initialized": true,
    "template": "python-flask"
  }
}
```

Jedes Item sollte enthalten:

```json
{
  "id": "claude-project-skills:skills/claude/foo",
  "agent": "claude",
  "itemType": "skills",
  "scope": "project",
  "sourcePath": "skills/claude/foo",
  "targetPath": ".claude/skills/foo",
  "strategy": "copy_tree",
  "exists": true,
  "tracked": false,
  "gitignored": true,
  "readable": true,
  "diffable": false
}
```

## Step 6: Gitignore/Tracked-Status korrekt bestimmen

**Betroffene Dateien:**

- `tools/webui_server.py`
- `lib/cli/init.sh`

### Backend-Logik

Fuer Project Scope:

- `tracked`: via `git ls-files --error-unmatch <path>`
- `gitignored`: via `git check-ignore <path>`
- Fallback wenn kein Git-Repo:
  - `tracked: false`
  - `gitignored`: Config-Default oder `.gitignore`-Heuristik

### `.gitignore` Update

- Config-Deployments mit `gitignore: true` sollen bei Project Deploy entsprechende Patterns in `.gitignore` eintragen.
- Bestehende Eintraege nicht duplizieren.
- `.orkestra/tmp/` bleibt weiterhin default-gitignored.

## Step 7: WebUI Header und Agent-Filter umbauen

**Dateien:**

- `webui/index.html`
- `webui/app.js`
- `webui/styles.css`

### Header-Ziel

Drei Spalten:

```text
Orkestra | Project Path / Template | Agent Filter
```

### Aenderungen

- Agent Filter aus Column B/C entfernen.
- Einen zentralen `activeAgentFilter` einfuehren.
- Status nicht ersatzlos entfernen:
  - entweder als kompakter Header-Status behalten,
  - oder durch Toast/inline activity area ersetzen.
- Filter wirkt auf:
  - Source column
  - Global column
  - Project/Rendered column
  - Apply buttons
  - Diff-Auswahl

### Wichtig

`activeAgentFilter` ist Single-Agent Source of Truth. Wenn Multi-Agent Deploy spaeter gewuenscht ist, kommt dafuer ein separater Multi-Select-Modus.

## Step 8: Source Column config-driven rendern

**Datei:** `webui/app.js`

### Ziel

Column A zeigt nicht mehr hardcodiert Templates, Global Instructions und Extras, sondern deploybare Source Items aus `/api/deploy-index`.

Gruppierung:

```text
A: Orkestra Sources
  Instructions
    Global
    Templates
  Skills
  MCP
  Workflows
  Plugins
```

### Template-Auswahl

- Template bleibt single-select.
- Template-Auswahl beeinflusst Source-Expansion fuer `{template}`-Globs.
- Global Instructions und Extras bleiben multi-select.

### State

Ersetzen von spezialisierten Strukturen wie:

```js
sourceDeployState.globalFiles
sourceDeployState.templateFiles
sourceDeployState.extrasFiles
```

durch eine einheitliche Auswahl:

```js
selectedSourceItems = {
  [sourceItemId]: true
}
```

## Step 9: Global und Project Columns config-aware machen

**Datei:** `webui/app.js`

### Column B: Global

Zeigt installierte oder installierbare Items fuer:

- aktiven Agent
- Scope `global`
- alle Item-Typen aus Config

Gruppierung:

```text
B: Global
  Instructions
  Skills
  MCP
  Plugins
```

### Column C: Project

Nicht nur "Rendered Instructions", sondern Project Scope.

Gruppierung:

```text
C: Project
  Instructions
    Tracked
    Gitignored
  Skills
    Tracked
    Gitignored
  MCP
    Tracked
    Gitignored
```

Empfehlung: Erst nach Item-Typ gruppieren, weil das besser zur Mental Map der User passt.

## Step 10: Diff-Funktion auf Deployment-Regeln erweitern

**Betroffene Dateien:**

- `tools/webui_server.py`
- `webui/app.js`

### Ziel

Diff nicht nur Source Instruction -> Rendered Instruction, sondern:

```text
source item -> configured target item
```

### Verhalten nach Strategy

- `bundle`: Diff zwischen zusammengesetztem Bundle und Ziel-Datei.
- `copy_file`: Diff zwischen Source-Datei und Ziel-Datei.
- `copy_tree`: Liste der Dateien anzeigen; Diff pro Datei erlauben.
- `merge_json`: spaeter strukturierter Diff.

### Wichtig

Nicht alle Items sind sinnvoll diffbar. Directory-Skills brauchen eher file-by-file Diff oder Statusanzeige.

## Step 11: Apply Buttons vereinheitlichen

**Datei:** `webui/app.js`

Weiterhin zwei Hauptaktionen:

```text
Apply to Global
Apply to Project
```

Aber beide nutzen dieselbe API:

```http
POST /api/deploy
```

Payload:

```json
{
  "agent": "claude",
  "scope": "project",
  "template": "python-flask",
  "selectedSourceItemIds": [
    "instructions/global/communication.md",
    "skills/claude/orkestra"
  ]
}
```

Backend resolved daraus:

- passende Deployment-Regeln
- Source-Pfade
- Target-Pfade
- Strategy
- Gitignore-Policy

Apply Button ist aktiv nur wenn:

- ein Agent gewaehlt ist
- ein Scope-Ziel gewaehlt ist
- mindestens ein kompatibles Source Item ausgewaehlt ist

## Step 12: Architektur dokumentieren

**Datei:** `ARCHITECTURE.md`

Dokumentieren:

- `agents-config.yaml` Schema
- Deployment-Matrix
- Item-Typen
- Strategies
- Scope-Konzept: `global` vs `project`
- Gitignore/Tracked Semantik
- Verhaeltnis von Config, CLI, WebUI und Adapters
- Uebergangsstrategie von alten hardcodierten Adapterpfaden zu Config-driven Deployments

## Verification

1. `settings/agents-config.yaml` laedt ohne Fehler.
2. Config-Validierung erkennt ungueltige Agents, Item-Typen, Scopes und Strategies.
3. `/api/agents-config` liefert Agents, Item-Typen und Deployments.
4. `/api/deploy-index` liefert Source, Global und Project Items config-basiert.
5. WebUI zeigt Agent-Filter im Header.
6. Agent-Filter beeinflusst Source, Global und Project Columns.
7. Source Column zeigt Instructions, Skills, MCP, Workflows und Plugins aus Config.
8. Template-Auswahl beeinflusst `{template}`-Sources.
9. `Apply to Global` nutzt `/api/deploy`.
10. `Apply to Project` nutzt `/api/deploy`.
11. `bundle` schreibt erwartete Agent-Instruktionsdatei.
12. `copy_file` kopiert Dateien an erwartete Zielpfade.
13. `copy_tree` kopiert Skill-/Plugin-Verzeichnisse.
14. Project Items zeigen `tracked` und `gitignored` korrekt.
15. `.gitignore` wird fuer Config-Eintraege mit `gitignore: true` aktualisiert.
16. Diff funktioniert fuer `bundle` und `copy_file`.
17. Directory Items zeigen sinnvollen Status und erlauben spaeter file-by-file Diff.
18. Bestehende `orkestra init` und `orkestra render` Workflows brechen nicht waehrend der Migration.

## Revised Implementation Order

1. Config-Schema und Beispiel-Config erstellen.
2. Config Loader und Validator bauen.
3. `/api/agents-config` und `/api/deploy-index` implementieren.
4. Deployment Engine mit `bundle`, `copy_file`, `copy_tree` bauen.
5. `/api/deploy` implementieren.
6. Gitignore/Tracked-Erkennung implementieren.
7. WebUI auf `activeAgentFilter` und Deploy Index umbauen.
8. Source/Global/Project Columns config-driven rendern.
9. Diff config-aware erweitern.
10. CLI Deploy-Befehl ergaenzen.
11. `init`/`render` schrittweise auf Config-Regeln migrieren.
12. Architektur aktualisieren.

## Main Risk To Avoid

Der wichtigste Architekturfehler waere, die WebUI lediglich um weitere hardcodierte Faelle zu erweitern:

```text
if path starts with skills -> do X
if path starts with mcp -> do Y
if agent is claude -> write here
```

Das wuerde dem eigentlichen Ziel widersprechen.

Die saubere Richtung ist:

```text
Config beschreibt was deploybar ist.
Deployment Engine beschreibt wie Strategien ausgefuehrt werden.
CLI und WebUI rufen dieselbe Semantik auf.
```

Dann wird Orkestra tatsaechlich erweiterbar, statt nur um ein paar neue feste Pfade ergaenzt.