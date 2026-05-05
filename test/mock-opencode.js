#!/usr/bin/env node
/**
 * mock-opencode.js
 *
 * Simulates `opencode run <prompt> --format json --agent TYPE` output.
 * Also handles legacy `-p <prompt> -f json` format for backwards compat.
 * Emits realistic NDJSON events to stdout with realistic timing.
 *
 * Usage (new format):
 *   MOCK_OPENCODE_AGENT_TYPE=architect node mock-opencode.js run "design schema" --format json --agent architect
 *
 * Usage (legacy):
 *   MOCK_OPENCODE_AGENT_TYPE=architect node mock-opencode.js -p "design schema" -f json
 *
 * The MOCK_OPENCODE_AGENT_TYPE env var controls which event sequence to emit.
 * If not set, defaults to a generic backend sequence.
 */

import { createWriteStream } from 'node:fs';

const agentType = process.env.MOCK_OPENCODE_AGENT_TYPE ?? 'backend';
const model = process.env.MOCK_OPENCODE_MODEL ?? 'github-copilot/claude-sonnet-4-6';

// Parse args — support both new `run "PROMPT"` and legacy `-p "PROMPT"` formats
let prompt;
const runIdx = process.argv.indexOf('run');
if (runIdx >= 0 && process.argv[runIdx + 1] && !process.argv[runIdx + 1].startsWith('-')) {
  // New format: opencode run "prompt" --format json --agent TYPE
  prompt = process.argv[runIdx + 1];
} else {
  // Legacy format: opencode -p "prompt" -f json -q --config ...
  const promptIdx = process.argv.indexOf('-p');
  prompt = promptIdx >= 0 ? process.argv[promptIdx + 1] : 'Build something';
}

function emit(event) {
  process.stdout.write(JSON.stringify(event) + '\n');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Event sequences per agent type
const sequences = {
  orchestrator: async () => {
    await sleep(200);
    emit({ type: 'message', role: 'assistant', content: `Analyzing request: "${prompt}"` });
    await sleep(300);
    emit({ type: 'usage', input_tokens: 1200, output_tokens: 150, model });
    await sleep(200);
    emit({
      type: 'message',
      role: 'assistant',
      content: JSON.stringify({
        analysis: `Breaking down: ${prompt}`,
        tasks: [
          { id: 'task-arch', agentType: 'architect', prompt: 'Design system architecture', complexity: 'complex', dependsOn: [] },
          { id: 'task-backend', agentType: 'backend', prompt: 'Implement API', complexity: 'standard', dependsOn: ['task-arch'] },
        ]
      })
    });
    await sleep(100);
    emit({ type: 'usage', input_tokens: 800, output_tokens: 400, model });
    emit({ type: 'complete', summary: 'Orchestration plan created with 2 subtasks' });
  },

  // Variant: orchestrator asks clarifying questions before planning
  // Triggered by setting MOCK_OPENCODE_CLARIFY=1 in env
  'orchestrator-clarify': async () => {
    await sleep(200);
    emit({ type: 'message', role: 'assistant', content: `Analyzing request: "${prompt}"` });
    await sleep(400);
    emit({ type: 'usage', input_tokens: 900, output_tokens: 80, model });
    await sleep(200);
    emit({
      type: 'message',
      role: 'assistant',
      content: JSON.stringify({
        clarification_needed: true,
        questions: [
          'What backend framework should be used? (e.g. Fastify, Express, NestJS)',
          'Should the app include user authentication (JWT / OAuth)?',
          'What is the target deployment environment? (Docker, Kubernetes, bare-metal)',
        ],
      }),
    });
    await sleep(100);
    emit({ type: 'usage', input_tokens: 600, output_tokens: 120, model });
    emit({ type: 'complete', summary: JSON.stringify({
      clarification_needed: true,
      questions: [
        'What backend framework should be used? (e.g. Fastify, Express, NestJS)',
        'Should the app include user authentication (JWT / OAuth)?',
        'What is the target deployment environment? (Docker, Kubernetes, bare-metal)',
      ],
    })});
  },

  architect: async () => {
    await sleep(300);
    emit({ type: 'message', role: 'assistant', content: 'Analyzing requirements and designing system architecture...' });
    await sleep(400);
    emit({ type: 'tool_use', name: 'read_file', input: { path: 'package.json' } });
    emit({ type: 'tool_result', name: 'read_file', output: '{"name":"test-project"}' });
    await sleep(500);
    emit({ type: 'usage', input_tokens: 3200, output_tokens: 800, model });
    await sleep(300);
    emit({ type: 'tool_use', name: 'write_file', input: { path: 'architecture/schema.sql', content: '-- DB Schema' } });
    emit({ type: 'tool_result', name: 'write_file', output: 'File written successfully' });
    await sleep(400);
    emit({ type: 'tool_use', name: 'write_file', input: { path: '.obsidian-vault/Architecture/ADR-001-database.md', content: '# ADR-001' } });
    emit({ type: 'tool_result', name: 'write_file', output: 'File written successfully' });
    await sleep(300);
    emit({ type: 'usage', input_tokens: 5100, output_tokens: 2200, model: 'github-copilot/claude-opus-4-6' });
    emit({ type: 'complete', summary: 'Architecture designed: PostgreSQL schema + ADR written' });
  },

  backend: async () => {
    await sleep(200);
    emit({ type: 'message', role: 'assistant', content: 'Implementing backend API based on architecture spec...' });
    await sleep(350);
    emit({ type: 'tool_use', name: 'read_file', input: { path: 'architecture/schema.sql' } });
    emit({ type: 'tool_result', name: 'read_file', output: '-- DB Schema\nCREATE TABLE users (id UUID PRIMARY KEY);' });
    await sleep(400);
    emit({ type: 'usage', input_tokens: 4100, output_tokens: 600, model });
    await sleep(300);
    emit({ type: 'tool_use', name: 'write_file', input: { path: 'src/routes/users.ts', content: 'export async function userRoutes...' } });
    emit({ type: 'tool_result', name: 'write_file', output: 'File written' });
    await sleep(250);
    emit({ type: 'tool_use', name: 'bash', input: { command: 'npm run type-check' } });
    emit({ type: 'tool_result', name: 'bash', output: '✓ No type errors' });
    await sleep(300);
    emit({ type: 'tool_use', name: 'write_file', input: { path: 'src/routes/users.test.ts', content: 'describe("users"...' } });
    emit({ type: 'tool_result', name: 'write_file', output: 'File written' });
    await sleep(200);
    emit({ type: 'usage', input_tokens: 6800, output_tokens: 3100, model });
    emit({ type: 'complete', summary: 'Backend API implemented: users route + tests' });
  },

  frontend: async () => {
    await sleep(250);
    emit({ type: 'message', role: 'assistant', content: 'Building UI components using design system...' });
    await sleep(300);
    emit({ type: 'tool_use', name: 'read_file', input: { path: 'design-system/tokens.css' } });
    emit({ type: 'tool_result', name: 'read_file', output: ':root { --color-primary: #2563eb; }' });
    await sleep(400);
    emit({ type: 'usage', input_tokens: 2800, output_tokens: 500, model: 'github-copilot/claude-haiku-4-5' });
    await sleep(300);
    emit({ type: 'tool_use', name: 'write_file', input: { path: 'components/UserCard.vue', content: '<template>...' } });
    emit({ type: 'tool_result', name: 'write_file', output: 'File written' });
    await sleep(200);
    emit({ type: 'usage', input_tokens: 4200, output_tokens: 1800, model: 'github-copilot/claude-haiku-4-5' });
    emit({ type: 'complete', summary: 'Frontend component UserCard implemented using design tokens' });
  },

  qa: async () => {
    await sleep(300);
    emit({ type: 'message', role: 'assistant', content: 'Starting Visual QA checks with Playwright...' });
    await sleep(400);
    emit({ type: 'tool_use', name: 'bash', input: { command: 'npx playwright install --with-deps chromium 2>/dev/null || true' } });
    emit({ type: 'tool_result', name: 'bash', output: 'Chromium ready' });
    await sleep(300);
    emit({ type: 'tool_use', name: 'bash', input: { command: 'npx playwright screenshot --viewport 1440x900 http://localhost:3000 screenshots/desktop.png' } });
    emit({ type: 'tool_result', name: 'bash', output: 'Screenshot saved: screenshots/desktop.png' });
    await sleep(250);
    emit({ type: 'tool_use', name: 'bash', input: { command: 'npx playwright screenshot --viewport 375x812 http://localhost:3000 screenshots/mobile.png' } });
    emit({ type: 'tool_result', name: 'bash', output: 'Screenshot saved: screenshots/mobile.png' });
    await sleep(350);
    emit({ type: 'usage', input_tokens: 3200, output_tokens: 600, model: 'github-copilot/claude-sonnet-4-6' });
    await sleep(200);
    const today = new Date().toISOString().slice(0, 10);
    emit({ type: 'tool_use', name: 'write_file', input: { path: `.obsidian-vault/QA/report-${today}.md`, content: `# QA Report ${today}\n\n## Viewport Tests\n- ✅ Desktop (1440px): Layout correct\n- ✅ Mobile (375px): Responsive OK\n\n## Accessibility\n- ✅ No critical violations\n\n## Screenshots\n- screenshots/desktop.png\n- screenshots/mobile.png` } });
    emit({ type: 'tool_result', name: 'write_file', output: 'QA report written' });
    await sleep(200);
    emit({ type: 'usage', input_tokens: 5100, output_tokens: 1800, model: 'github-copilot/claude-sonnet-4-6' });
    emit({ type: 'complete', summary: 'Visual QA passed: desktop + mobile screenshots captured, no accessibility violations' });
  },

  document: async () => {
    await sleep(150);
    emit({ type: 'message', role: 'assistant', content: 'Writing documentation to Obsidian vault...' });
    await sleep(200);
    const today = new Date().toISOString().slice(0, 10);
    emit({ type: 'tool_use', name: 'write_file', input: { path: `.obsidian-vault/Daily/${today}.md`, content: `## Agent Task Completed\n- ${prompt.slice(0, 200)}` } });
    emit({ type: 'tool_result', name: 'write_file', output: 'File written' });
    await sleep(150);
    emit({ type: 'usage', input_tokens: 800, output_tokens: 300, model: 'github-copilot/claude-haiku-4-5' });
    emit({ type: 'complete', summary: `Documentation written to .obsidian-vault/Daily/${today}.md` });
  },

  design: async () => {
    await sleep(200);
    emit({ type: 'message', role: 'assistant', content: 'Creating design system: tokens, typography, component specs...' });
    await sleep(350);
    emit({ type: 'tool_use', name: 'write_file', input: { path: 'design-system/tokens.css', content: ':root {...}' } });
    emit({ type: 'tool_result', name: 'write_file', output: 'File written' });
    await sleep(200);
    emit({ type: 'tool_use', name: 'write_file', input: { path: 'design-system/tailwind.config.js', content: 'module.exports = {...}' } });
    emit({ type: 'tool_result', name: 'write_file', output: 'File written' });
    await sleep(300);
    emit({ type: 'usage', input_tokens: 1900, output_tokens: 1200, model: 'github-copilot/claude-haiku-4-5' });
    emit({ type: 'tool_use', name: 'write_file', input: { path: 'design-system/components.md', content: '# Components...' } });
    emit({ type: 'tool_result', name: 'write_file', output: 'File written' });
    await sleep(200);
    emit({ type: 'usage', input_tokens: 2800, output_tokens: 2100, model: 'github-copilot/claude-haiku-4-5' });
    emit({ type: 'complete', summary: 'Design system created: tokens.css, tailwind config, component specs' });
  },
};

// Run the sequence for this agent type
// For orchestrator, MOCK_OPENCODE_CLARIFY=1 triggers the clarification variant
const effectiveAgentType =
  agentType === 'orchestrator' && process.env.MOCK_OPENCODE_CLARIFY === '1'
    ? 'orchestrator-clarify'
    : agentType;
const sequence = sequences[effectiveAgentType] ?? sequences.backend;

try {
  await sequence();
  process.exit(0);
} catch (err) {
  emit({ type: 'error', message: err.message });
  process.exit(1);
}
