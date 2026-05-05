# Coding Agent Orchestrator — Technická Specifikace v0.3

**Verze:** 0.3  
**Datum:** Květen 2026  
**Klíčové změny od v0.2:**
- Dashboard přepsán na **Vue 3 + Nuxt**
- **OpenCode** jako agent runtime místo přímého volání LLM API
- Strategie pro **kvalitní frontend output** (AI frontends jsou obecně špatné)
- **Agent Configuration System** — plně konfigurovatelní agenti přes UI
- Embedding zjednodušeno — vše přes OpenCode + GitHub Copilot

---

## 1. Proč OpenCode jako runtime

Místo abychom sami řešili volání LLM API, tool use, file editing, a MCP integraci — použijeme **OpenCode** jako spustitelný agent runtime. OpenCode to všechno už umí, je open-source (MIT), podporuje 75+ providerů a GitHub Copilot, a jde spustit neinteraktivně ze skriptu.

**Náš orchestrátor pak dělá:**
- Plánování (jaký agent, v jakém pořadí, s jakým modelem)
- Spouštění OpenCode procesů s odpovídající konfigurací
- Parsování jejich JSON výstupu
- Streamování eventů do Vue dashboardu
- Udržování project knowledge base (RAG)
- Správu kontextů a secrets

**OpenCode dělá:**
- Volání LLM (přes GitHub Copilot nebo direct API)
- Tool use (filesystem, shell, git, MCP servery)
- LSP integrace (diagnostics, type checking)
- Session management

---

## 2. Architektura (v0.3)

```
┌─────────────────────────────────────────────────────────────────┐
│                    DASHBOARD (Nuxt 3 + Vue 3)                    │
│  Chat | Agent Monitor | Context Inspector | Agent Config | Costs │
└───────────────────────────┬─────────────────────────────────────┘
                            │ WebSocket + REST
┌───────────────────────────▼─────────────────────────────────────┐
│                  ORCHESTRATOR API (Fastify + Node)               │
│  Task Planner | Model Router | Process Manager | Event Bus       │
│  Context Manager | Agent Config Registry | Cost Tracker          │
└───┬──────────────┬──────────────┬──────────────┬───────────────┘
    │              │              │              │
┌───▼───┐     ┌───▼───┐     ┌───▼───┐     ┌───▼───┐
│OpenCode│    │OpenCode│    │OpenCode│    │OpenCode│  ...paralelně
│Arch.   │    │Backend │    │Frontend│    │Infra   │
│Process │    │Process │    │Process │    │Process │
└───┬───┘     └───┬───┘     └───┬───┘     └───┬───┘
    │              │              │              │
    └──────────────┴──────────────┴──────────────┘
                            │
         ┌──────────────────▼─────────────────────┐
         │         GitHub Copilot API              │
         │  Claude | GPT-5.x | Gemini | Grok | ... │
         │  + Free models (GPT-4o, Raptor mini...) │
         └──────────────────┬─────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  Shared Workspace: /workspaces/{project-id}/                     │
│  ├── .opencode/          ← per-agent konfigurace                 │
│  ├── .obsidian/          ← ADRs, rozhodnutí, docs               │
│  ├── src/                ← výsledný kód                          │
│  └── .project-knowledge/ ← RAG chunks, function registry        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  code-server (VS Code v browseru)   PostgreSQL   Redis           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. OpenCode Agent Runtime

### Jak se spouští agent

Pro každý subtask orchestrátor:

1. Vygeneruje `opencode.json` pro daného agenta (model, system prompt, MCP servery, pravidla)
2. Spustí OpenCode process v sandbox kontejneru s projektem mountnutým
3. Parsuje JSON output v reálném čase
4. Streamuje eventy do dashboardu přes WebSocket

```typescript
async function spawnAgent(task: AgentTask, agentConfig: AgentConfig) {
  const opencodeConfig = buildOpencodeConfig(agentConfig, task.context);
  
  // Zapíše config do workspace
  await fs.writeFile(
    `/workspaces/${task.projectId}/.opencode/agent-${agentConfig.type}.json`,
    JSON.stringify(opencodeConfig)
  );

  // Spustí OpenCode neinteraktivně s JSON outputem
  const proc = spawn("opencode", [
    "-p", task.prompt,
    "-f", "json",        // strukturovaný output
    "-q",                // bez spinneru
    "--config", `.opencode/agent-${agentConfig.type}.json`,
  ], {
    cwd: `/workspaces/${task.projectId}`,
    env: { ...buildEnv(task.context) }, // secrets, API keys
  });

  // Stream parsování
  proc.stdout.on("data", (chunk) => {
    const events = parseOpencodeOutput(chunk);
    events.forEach(event => {
      eventBus.publish(`agent:${task.id}`, event);       // → WebSocket
      persistAgentLog(task.id, event);                   // → PostgreSQL
      trackCost(task.id, event);                         // → cost tracker
    });
  });
}
```

### OpenCode JSON output events (co parsujeme)

```typescript
// OpenCode -f json vrací strukturované eventy:
type OpencodeEvent =
  | { type: "message";    role: "assistant"; content: string }
  | { type: "tool_use";   name: string; input: Record<string, unknown> }
  | { type: "tool_result"; name: string; output: string; error?: string }
  | { type: "usage";      input_tokens: number; output_tokens: number; model: string }
  | { type: "complete";   summary: string }
  | { type: "error";      message: string }
```

---

## 4. Model Router (updated pro OpenCode)

OpenCode konfiguraci generujeme dynamicky — model se nastaví v `opencode.json` pro daný agent run.

```typescript
// Generování opencode.json pro konkrétního agenta
function buildOpencodeConfig(agent: AgentConfig, complexity: TaskComplexity) {
  const model = resolveModel(agent.defaultComplexity, complexity);
  
  return {
    model: model.id,           // "github-copilot/claude-sonnet-4-6"
    provider: "github-copilot",
    
    // System prompt = agent persona + project kontext + pravidla
    systemPrompt: buildSystemPrompt(agent, project),
    
    // MCP servery povolené pro tohoto agenta
    mcp: agent.allowedMcpServers.map(s => mcpServerConfigs[s]),
    
    // OpenCode agent rules (ekvivalent .cursor/rules)
    rules: agent.rules,
    
    // Limity
    maxSteps: agent.maxSteps ?? 20,
    
    // GitHub Copilot přes token
    providers: {
      "github-copilot": {
        apiKey: context.secrets.GITHUB_TOKEN
      }
    }
  };
}
```

### Model mapping přes GitHub Copilot

```typescript
const MODEL_ROUTING = {
  trivial:  "github-copilot/gpt-4o",              // free
  simple:   "github-copilot/claude-haiku-4-5",    // 0.33x
  standard: "github-copilot/claude-sonnet-4-6",   // 1x
  complex:  "github-copilot/claude-opus-4-6",     // 3x
  expert:   "github-copilot/claude-opus-4-7",     // 15x — vzácně
};
```

---

## 5. Kvalita Frontend Outputu — Strategie

**Problém:** AI agenti obecně generují špatný frontend kód — nekonzistentní design, hardcoded hodnoty, žádný design systém, generický vzhled.

**Řešení:** Čtyřvrstvá ochrana.

### Vrstva 1: Design Agent jede VŽDY první

Před jakýmkoliv frontend kódem musí Design Agent vygenerovat:

```
/design-system/
├── tokens.css          ← CSS custom properties (barvy, typografie, spacing)
├── tailwind.config.js  ← Tailwind extends s tokeny
├── typography.md       ← Font pair, scale, line-height pravidla
├── components.md       ← Spec každé komponenty (co, jak, proč)
└── patterns.md         ← Layout patterns, grid system, breakpoints
```

Design Agent má v system promptu:
- Zakázáno používat generické palety (no purple gradients, no generic blues)
- Musí navrhnout originální typografický pár
- Musí specifikovat konkrétní font (Google Fonts nebo system font stack)
- Každá komponenta musí mít popsané stavy (default, hover, focus, disabled, error)

### Vrstva 2: Frontend Agent má striktní RULES soubor

OpenCode rules soubor (`.opencode/frontend-rules.md`) vygenerovaný z Design System:

```markdown
# Frontend Rules — [Project Name]

## Design System
- ALWAYS import tokens from `/design-system/tokens.css`
- NEVER hardcode colors, use CSS variables: `var(--color-primary)`
- NEVER hardcode font sizes, use scale: `var(--text-lg)`
- Typography: [Font name] for headings, [Font name] for body

## Component Library
- UI components: use Shadcn/Vue (shadcn-vue) — NEVER build from scratch
- Icons: use Lucide Vue — NEVER use emoji or other icon sets
- ALWAYS handle loading, error, and empty states

## Code Quality
- ALWAYS use TypeScript
- ALWAYS use `<script setup lang="ts">`
- Props MUST have explicit types
- NEVER use inline styles
- NEVER use `!important`

## Accessibility
- All images MUST have alt text
- Interactive elements MUST have focus styles
- Color contrast MUST meet WCAG AA

## Performance  
- Images: use `<NuxtImg>` with lazy loading
- NEVER import entire libraries (tree-shake)
- Bundle: zero unused CSS via Tailwind purge
```

### Vrstva 3: Visual QA Agent

Po dokončení frontend implementace spustí Visual QA Agent:

1. Playwright screenshot každé stránky/komponenty
2. Screenshot pošle vision modelu (claude-sonnet — má dobré vision)
3. Model ohodnotí: konzistence s design systemem, responsivita, accessibility, "looks professional?"
4. Výstup: checklist s pass/fail a konkrétními problémy

```typescript
// Visual QA prompt
`You are a senior UI/UX reviewer. Analyze this screenshot and rate:
1. Does it match the design system tokens? (colors, typography)
2. Is the layout professional and consistent?
3. Are there visual inconsistencies?
4. Does it look like a real production app, not an AI prototype?
Respond with: PASS/FAIL per category + specific issues.`
```

### Vrstva 4: Curated Tech Stack (povinný pro všechny projekty)

Frontend agenti VŽDY pracují s:
- **Nuxt 3** (Vue) nebo **Next.js** (React) — ne custom setups
- **Tailwind CSS** — utility first, design system přes `extend`
- **shadcn-vue** nebo **Nuxt UI** — battle-tested komponenty
- **Lucide** — ikony
- **VueUse** — composables
- **Pinia** — state management

Tyto volby jsou hardcoded v context config — agent se nemůže rozhodnout jinak.

---

## 6. Agent Configuration System

### Datový model agenta

```typescript
interface AgentDefinition {
  id: string;
  name: string;                    // "SEO Agent"
  description: string;
  icon: string;                    // emoji nebo icon name
  
  // Model routing
  defaultComplexity: TaskComplexity;
  canEscalateTo: TaskComplexity;
  
  // Persona — jádro agenta
  systemPrompt: string;           // Editovatelné přes UI
  rules: string[];                // .opencode/rules — editovatelné
  
  // Skills — pluggable znalostní moduly
  skills: AgentSkill[];
  
  // Nástroje
  allowedMcpServers: string[];    // Vybírá se z katalogu MCP serverů
  allowedTools: string[];
  
  // Limity
  maxSteps: number;               // Default: 20
  timeoutMinutes: number;         // Default: 10
  
  // Kdy se tento agent spouští
  triggers: {
    taskTypes: string[];          // ["frontend", "component", "ui"]
    contextTypes: string[];       // ["personal", "cez", "both"]
  };
  
  // Metadata
  isBuiltIn: boolean;             // Zabudovaný nebo custom
  isActive: boolean;
  createdBy: string;
}
```

### Agent Skills — pluggable znalostní moduly

Skill je strukturovaný blok znalostí vložený do system promptu agenta. Uživatel je zapíná/vypíná v UI.

```typescript
interface AgentSkill {
  id: string;
  name: string;              // "SEO Expert"
  description: string;
  
  // Co se přidá do system promptu
  knowledgeBlock: string;    // Detailní SEO znalosti, best practices, atd.
  
  // Extra MCP servery které tento skill potřebuje
  requiredMcpServers: string[];  // ["google-search-console", "semrush"]
  
  // Extra rules
  rules: string[];
}
```

**Příklad: SEO Agent**

```typescript
const SEO_AGENT: AgentDefinition = {
  name: "SEO Agent",
  defaultComplexity: "standard",
  systemPrompt: `You are an expert SEO engineer with 10+ years of experience.
You focus on technical SEO, Core Web Vitals, structured data, and content optimization.
You always verify changes against actual search performance data.`,
  
  skills: [
    {
      name: "Technical SEO",
      knowledgeBlock: `
## Technical SEO Knowledge
- Core Web Vitals: LCP < 2.5s, INP < 200ms, CLS < 0.1
- Structured data: JSON-LD for Article, Product, BreadcrumbList, FAQPage
- Canonical tags: always set, avoid duplicate content
- robots.txt: disallow /api/, /admin/, pagination params
- Sitemap: XML, max 50k URLs, submit to GSC
- Hreflang for multilingual sites
- OpenGraph + Twitter Card meta tags
- Internal linking: 3-5 contextual links per page
[... deep SEO knowledge ...]`,
      requiredMcpServers: ["google-search-console"],
    },
    {
      name: "Google Search Console",
      knowledgeBlock: `You have access to Google Search Console data via MCP.
Always check: top queries, click-through rates, index coverage, Core Web Vitals report.
Base recommendations on real data, not assumptions.`,
      requiredMcpServers: ["google-search-console"],
    }
  ],
  
  allowedMcpServers: ["filesystem", "git", "google-search-console"],
  triggers: { taskTypes: ["seo", "performance", "meta"], contextTypes: ["both"] }
};
```

### Agent Configuration UI (Vue)

Dashboard má sekci **Agent Studio**:

```
┌─ Agent Studio ──────────────────────────────────────────────────┐
│ [+ New Agent]  [Import Template]                                 │
├─────────────────────────────────────────────────────────────────┤
│ ● Architect     complex   filesystem, git          [Edit] [···] │
│ ● Backend       standard  filesystem, git, postgres [Edit] [···] │
│ ● Frontend      simple    filesystem, git, browser [Edit] [···] │
│ ● Design        simple    filesystem               [Edit] [···] │
│ ● SEO           standard  filesystem, gsc, git     [Edit] [···] │
│ ○ Infra         standard  filesystem, shell, git   [Edit] [···] │
└─────────────────────────────────────────────────────────────────┘
```

Agent Editor (modal/slide-over):
- **Identity**: jméno, popis, ikona
- **Model**: výběr default complexity + override na konkrétní model
- **System Prompt**: Monaco editor s syntax highlighting
- **Rules**: seznam pravidel (add/remove/reorder)
- **Skills**: zapínání/vypínání skill modulů
- **MCP Servers**: multi-select z katalogu dostupných serverů
- **Triggers**: typy tasků kde se agent automaticky zapíná
- **Limits**: max steps, timeout, cost cap per task

---

## 7. MCP Server Katalog

Centrální registr dostupných MCP serverů — uživatel si přidává do agentů podle potřeby:

| ID | Název | Popis | Kontext |
|----|-------|-------|---------|
| `filesystem` | Filesystem | Čtení/zápis souborů | Oba |
| `shell` | Shell | Příkazy v sandbox kontejneru | Oba |
| `git` | Git | Git operace | Oba |
| `browser` | Browser (Playwright) | Headless prohlížeč, screenshoty | Oba |
| `postgres` | PostgreSQL | DB dotazy | Oba |
| `github` | GitHub API | Issues, PRs, repos | Personal |
| `gitlab` | GitLab API | Issues, PRs, CI/CD | CEZ |
| `google-search-console` | Google Search Console | Search data, indexing, CWV | Personal |
| `google-analytics` | Google Analytics 4 | Traffic, conversions | Personal |
| `vercel` | Vercel | Deploy, env vars, analytics | Personal |
| `hetzner` | Hetzner Cloud | VPS management | Personal |
| `vault` | HashiCorp Vault | Secrets management | CEZ |
| `openshift` | OpenShift | OC CLI wrapper | CEZ |
| `slack` | Slack | Zprávy, channels | Oba |
| `jira` | Jira | Ticket management | CEZ |
| `obsidian` | Obsidian | Read/write vault notes | Oba |

Každý MCP server má vlastní Docker kontejner (nebo je spuštěn jako sidecar).  
Přidání nového MCP serveru = přidat do katalogu + Docker Compose service.

---

## 8. Agent Monitor Dashboard (Vue)

### Hlavní pohled — živý build

```
┌─────────────────────────────────────────────────────────────────┐
│ ◆ SocialMat v2  │ ⬡ Personal  │  Session #47  │ $0.23 / $5 cap │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ORCHESTRATOR                                    ● PLANNING      │
│  claude-sonnet-4-6 via github-copilot            12k ctx tokens  │
│  "Delegating DB schema to Architect, design to Design Agent..." │
│                                                                  │
├────────────────────┬────────────────────────────────────────────┤
│  ARCHITECT         │  DESIGN AGENT                              │
│  ● RUNNING         │  ● RUNNING                                 │
│  claude-opus-4-6   │  claude-haiku-4-5          ← paralelně     │
│                    │                                            │
│  Ctx: ██████░░ 61k │  Ctx: ██░░░░░░ 18k tokens                 │
│  Cost: $0.08       │  Cost: $0.003                              │
│  Steps: 6/20       │  Steps: 3/20                               │
│                    │                                            │
│  ▶ write_file      │  ▶ write_file                              │
│    schema.sql      │    tokens.css                              │
│                    │                                            │
│  [⏸ Pause] [⏹ Stop]│  [⏸ Pause] [⏹ Stop]                       │
├────────────────────┴────────────────────────────────────────────┤
│  BACKEND  ⏳ waiting: Architect     FRONTEND  ⏳ waiting: Design  │
│  QA       ⏳ waiting: Backend                                    │
└─────────────────────────────────────────────────────────────────┘
```

### Context Inspector — kliknutím na agenta

Slide-over panel zobrazuje:

```
┌─ Architect Agent — Context Inspector ───────────────────────────┐
│                                                                  │
│  MODEL          claude-opus-4-6 via github-copilot              │
│  COMPLEXITY     complex (auto-classified)                        │
│  CONTEXT SIZE   61,240 / 200,000 tokens    ██████░░░░  31%      │
│                                                                  │
│  BREAKDOWN                                                       │
│  ├── System prompt          2,840 tokens                        │
│  ├── Project conventions      520 tokens                        │
│  ├── Task description         180 tokens                        │
│  ├── RAG results            4,200 tokens   (8 chunks)           │
│  ├── Conversation history  51,000 tokens                        │
│  └── Tool results           2,500 tokens                        │
│                                                                  │
│  COST BREAKDOWN                                                  │
│  Input:  58k tokens × $0.000015 =  $0.087                      │
│  Output:  3k tokens × $0.000075 =  $0.023                      │
│  Total this task:                  $0.110                       │
│                                                                  │
│  CURRENT TOOL CALL                                               │
│  write_file → /workspaces/socialmat/schema.sql                  │
│  [Preview diff]                                                  │
│                                                                  │
│  [Inject message]  [Force stop]  [View full context]            │
└─────────────────────────────────────────────────────────────────┘
```

### Cost Dashboard (separátní tab)

```
┌─ Costs ─────────────────────────────────────────────────────────┐
│ Today: $0.23   This week: $1.84   This month: $12.40            │
│ Budget cap: $5/session  $50/month   [Configure]                  │
├─────────────────────────────────────────────────────────────────┤
│ BY MODEL                        BY AGENT                         │
│ claude-opus-4-6    $8.20 ████   Architect    $6.10 ████         │
│ claude-sonnet-4-6  $3.10 ██     Backend      $3.20 ██           │
│ claude-haiku-4-5   $0.80 █      Frontend     $1.90 █            │
│ gpt-4o (free)      $0.00        Design       $0.20              │
│                               QA           $0.80               │
├─────────────────────────────────────────────────────────────────┤
│ SAVINGS VIA MODEL ROUTING                                        │
│ Estimated if all on Sonnet: $28.50                              │
│ Actual cost:                $12.40                              │
│ Saved:                      $16.10  (-57%)                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. Kontext & Secrets Management

### Per-kontext secrets (bezpečně)

Secrets nejsou nikdy v kódu ani DB — jsou v prostředí orchestrátoru:

```
CEZ kontext:
  VAULT_ADDR, VAULT_ROLE_ID, VAULT_SECRET_ID → Vault AppRole
  GITLAB_TOKEN → GitLab API
  OPENSHIFT_TOKEN → OC CLI
  
Personal kontext:
  GITHUB_TOKEN → GitHub API + GitHub Copilot (modely)
  VERCEL_TOKEN → Vercel deploy
  HETZNER_API_KEY → Hetzner VPS
  GOOGLE_SERVICE_ACCOUNT → GSC + GA4
```

Při spouštění OpenCode procesu se relevantní secrets injektují jako env variables — agent je vidí jen po dobu svého běhu.

---

## 10. Obsidian Integrace

Agenti **aktivně píší** do Obsidian vaultu v rámci projektu:

```
/workspaces/{project-id}/.obsidian-vault/
├── Architecture/
│   ├── ADR-001-database-choice.md
│   ├── ADR-002-auth-strategy.md
│   └── system-overview.md
├── Decisions/
│   └── 2026-05-why-we-chose-x.md
├── Components/
│   └── component-registry.md   ← automaticky udržuje Backend/Frontend agent
└── Daily/
    └── 2026-05-05.md           ← co bylo dnes postaveno
```

Orchestrátor po dokončení každého tasku zavolá jednoduchý `DocumentAgent` (Haiku — levný) který zapíše shrnutí do vaultu.

Uživatel si vault otevře v Obsidian desktop aplikaci s projektem namapovaným přes SFTP/sync, nebo přes web Obsidian.

---

## 11. Tech Stack (finální)

| Vrstva | Technologie | Poznámka |
|--------|------------|---------|
| **Dashboard** | Nuxt 3 + Vue 3 | Composition API, `<script setup>` |
| **UI** | Nuxt UI + Tailwind | Konzistentní komponenty |
| **Real-time** | WebSocket (ws) | Server-sent events jako fallback |
| **Orchestrátor** | Fastify + Node.js | TypeScript, ESM |
| **Task queue** | BullMQ + Redis | Retry, priority, delayed jobs |
| **Agent runtime** | OpenCode | Via GitHub Copilot pro všechny modely |
| **AI models** | GitHub Copilot API | Claude, GPT-5.x, Gemini, Grok, free modely |
| **Databáze** | PostgreSQL + pgvector | Projekty, logy, embeddings |
| **Cache** | Redis | Queue, pubsub, session cache |
| **Workspace** | Docker volumes | Sdílené mezi OpenCode procesem a code-server |
| **VS Code** | code-server | Browser IDE pro debugging |
| **Knowledge** | Obsidian vault | ADRs, docs, rozhodnutí |
| **Secrets** | Env injection | Pro CEZ: HashiCorp Vault |
| **Deploy** | Docker Compose + Nginx | Hetzner VPS |
| **CI/CD** | GitHub Actions | Auto-deploy na main |

---

## 12. Fáze vývoje (update)

### Fáze 1 — MVP (4–6 týdnů)
- [ ] Orchestrátor API (Fastify + BullMQ)
- [ ] OpenCode process management (spawn, parse JSON, stream events)
- [ ] Model Router + GitHub Copilot konfigurace
- [ ] Základní agenti: Orchestrator, Architect, Backend, Frontend, Design
- [ ] Vue/Nuxt dashboard: chat + live agent monitor
- [ ] Context Inspector (kontext velikost, cost breakdown)
- [ ] Přepínání kontextů (CEZ / Personal)
- [ ] code-server integrace
- [ ] Frontend quality rules system (design tokens + rules soubor)

### Fáze 2 — Full Suite (3–4 týdny)
- [ ] Agent Configuration UI (Agent Studio)
- [ ] Skill system (pluggable znalostní moduly)
- [ ] MCP server katalog + per-agent přiřazení
- [ ] Visual QA Agent (Playwright + vision model)
- [ ] RAG (pgvector) + Function registry
- [ ] Dependency DAG + paralelní execution
- [ ] Cost dashboard + budget alerts
- [ ] Approval flow pro destruktivní operace
- [ ] Obsidian vault integrace

### Fáze 3 — Power Features (ongoing)
- [ ] Vault integrace (CEZ)
- [ ] Google Search Console MCP server
- [ ] SEO Agent template
- [ ] OpenShift MCP server
- [ ] Eskalační logika (agent request model upgrade)
- [ ] Context Inject (přidání instrukce do běžícího agenta)
- [ ] Session replay (přehrání co agenti dělali)
- [ ] Multi-user (sdílení session s Matyášem)

---

## 13. Zbývající otevřené otázky

1. **RAG embeddings** — pgvector + embedding model potřebuje API key pro generování embeddings. Nejjednodušší: OpenAI `text-embedding-3-small` přes GitHub Copilot API (podporuje to?), nebo lokálně `nomic-embed-text` přes Ollama na VPS (zdarma, ~4GB VRAM). Doporučuji rozhodnout před Fází 2.

2. **OpenCode verze** — OpenCode se rychle vyvíjí (153k stars, aktivní vývoj). Pinovat konkrétní verzi v Dockerfile a mít upgrade proces.

3. **Copilot rate limits** — GitHub Copilot API má rate limity. Potřeba sledovat a případně přidat direct Anthropic API jako doplněk pro burst situace.

---

*Specifikace je živý dokument. Poslední update: Květen 2026, v0.3*
