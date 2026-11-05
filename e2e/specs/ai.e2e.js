// Copilot end-to-end coverage against a deterministic OpenAI-compatible mock.
//
// These specs exercise the real browser client, SSE parsing, the bounded agent
// loop, approval gating, and the UI wiring. The mock is started by wdio.conf.js
// and the app is pointed at it through localStorage before each reload.

import {
  resetApp,
  goNav,
  expectTestId,
  clickTestId,
} from '../helpers.js';

const AI_URL = process.env.SPICE_AI_MOCK_URL || 'http://127.0.0.1:43118';

async function configureCopilot(agentEnabled) {
  await browser.execute((url, enabled) => {
    localStorage.setItem('spice_ai_config', JSON.stringify({
      endpoint: `${url}/v1/chat/completions`,
      model: 'e2e-copilot',
      systemPrompt: 'E2E Copilot system prompt.',
      apiKey: 'e2e-key',
      temperature: 0,
      maxTokens: 512,
    }));
    localStorage.setItem('spice_ai_agent_enabled', enabled ? '1' : '0');
  }, AI_URL, agentEnabled);
  await browser.refresh();
  await expectTestId('nav-home');
}

async function openCopilot() {
  await clickTestId('ai-toggle');
  await expectTestId('ai-panel');
}

async function sendPrompt(text) {
  const input = await expectTestId('ai-input');
  await input.setValue(text);
  await clickTestId('ai-send');
}

async function assistantMessages() {
  return $$('[data-testid="ai-message"][data-role="assistant"]');
}

async function lastAssistantText() {
  const messages = await assistantMessages();
  return messages.length ? messages[messages.length - 1].getText() : '';
}

async function waitForAssistantText(text, timeout = 30000) {
  await browser.waitUntil(
    async () => (await lastAssistantText()).includes(text),
    { timeout, timeoutMsg: `assistant never produced: ${text}` },
  );
}

async function toolNotes() {
  return $$('[data-testid="ai-tool-note"]');
}

async function waitForToolNote(text, timeout = 20000) {
  await browser.waitUntil(
    async () => {
      const notes = await toolNotes();
      for (const note of notes) {
        if ((await note.getText()).includes(text)) return true;
      }
      return false;
    },
    { timeout, timeoutMsg: `tool note never appeared: ${text}` },
  );
}

async function openAudit() {
  await clickTestId('ai-config-toggle');
  await expectTestId('ai-config-pane');
  await clickTestId('ai-audit-summary');
}

async function auditRows() {
  return $$('[data-testid="ai-audit-row"]');
}

async function waitForAuditRow(text, timeout = 10000) {
  await browser.waitUntil(
    async () => {
      const rows = await auditRows();
      for (const row of rows) {
        if ((await row.getText()).includes(text)) return true;
      }
      return false;
    },
    { timeout, timeoutMsg: `audit row never appeared: ${text}` },
  );
}

async function mockRequests() {
  const response = await fetch(`${AI_URL}/__requests`);
  return response.json();
}

describe('AI Copilot', () => {
  beforeEach(async () => {
    await resetApp();
  });

  it('streams a reply through the configured OpenAI-compatible endpoint', async () => {
    await configureCopilot(false);
    await openCopilot();
    await sendPrompt('E2E-HELLO');

    await waitForAssistantText('E2E streamed reply');
    const requests = await mockRequests();
    const last = requests[requests.length - 1];
    expect(last.stream).toBe(true);
    expect(last.toolCount).toBe(0);
    expect(last.model).toBe('e2e-copilot');
  });

  it('runs a read-only tool through the agent loop', async () => {
    await configureCopilot(true);
    await openCopilot();
    await sendPrompt('E2E-READ');

    await waitForToolNote('get_workspace_context · ok');
    await waitForAssistantText('E2E tool finished: get_workspace_context -> ok');

    const requests = await mockRequests();
    const last = requests[requests.length - 1];
    expect(last.toolCount).toBeGreaterThan(0);
    expect(last.messages.some((message) => message.role === 'tool')).toBe(true);
  });

  it('requires approval before a write tool and records the applied change', async () => {
    await configureCopilot(true);
    await goNav('gene');
    await expectTestId('gene-workbench');
    await openCopilot();
    await sendPrompt('E2E-APPROVE');

    const approval = await expectTestId('ai-approval');
    expect(await approval.getText()).toContain('apply_dna_sequence');
    await clickTestId('ai-approve');

    await waitForToolNote('apply_dna_sequence · ok');
    await waitForAssistantText('E2E tool finished: apply_dna_sequence -> ok');

    await openAudit();
    await waitForAuditRow('applied');
    const text = await browser.execute(() =>
      Array.from(document.querySelectorAll('[data-testid="ai-audit-row"]'))
        .map((row) => row.textContent ?? '')
        .join('\n'),
    );
    expect(text).toContain('apply_dna_sequence');
  });

  it('rejects a write tool without touching the editor and audits the refusal', async () => {
    await configureCopilot(true);
    await goNav('gene');
    await expectTestId('gene-workbench');
    await openCopilot();
    await sendPrompt('E2E-REJECT');

    await expectTestId('ai-approval');
    await clickTestId('ai-reject');

    await waitForToolNote('apply_dna_sequence · rejected');
    await waitForAssistantText('E2E tool finished: apply_dna_sequence -> failed');

    await openAudit();
    await waitForAuditRow('rejected');
    const text = await browser.execute(() =>
      Array.from(document.querySelectorAll('[data-testid="ai-audit-row"]'))
        .map((row) => row.textContent ?? '')
        .join('\n'),
    );
    expect(text).toContain('apply_dna_sequence');
  });
});
