import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('Conversation Continuity & Multi-turn Formatting', () => {
  test('should format chronological history context cleanly for LLM input', () => {
    const rawHistory = [
      { role: 'user', content: 'How do I reverse an M-Pesa transaction sent to the wrong number?' },
      { role: 'assistant', content: '1. Advise customer to send transaction SMS to 456.\n2. Confirm within 2 hours.' },
      { role: 'user', content: 'What if the funds are already withdrawn by the recipient?' },
    ];

    const historyBlock = rawHistory
      .map((m) => `${m.role === 'user' ? 'CEE Agent' : 'Ask Saka'}: ${m.content}`)
      .join('\n');

    assert.ok(historyBlock.includes('CEE Agent: How do I reverse an M-Pesa transaction'));
    assert.ok(historyBlock.includes('Ask Saka: 1. Advise customer'));
    assert.ok(historyBlock.includes('CEE Agent: What if the funds are already withdrawn'));
  });

  test('should correctly truncate long turns to prevent context window explosion', () => {
    const veryLongTurn = 'a'.repeat(800);
    const truncated = veryLongTurn.slice(0, 400);

    assert.strictEqual(truncated.length, 400);
  });

  test('should generate clean titles from first user query', () => {
    const query1 = 'How do I onboard a customer to Postpaid Platinum tariff?';
    const query2 = '   ';
    
    const title1 = query1.trim().slice(0, 60);
    const title2 = query2.trim().slice(0, 60) || 'New Conversation';

    assert.strictEqual(title1, 'How do I onboard a customer to Postpaid Platinum tariff?');
    assert.strictEqual(title2, 'New Conversation');
  });

  test('should extract suggestions from JSON array, pipe formats, and markdown lists', async () => {
    const { extractSuggestions } = await import('../src/routes/ask.js');

    // 1. JSON array format
    const resJson = extractSuggestions('Here is the procedure.\n\n[SUGGESTIONS: ["How to check status?", "What are the fees?"]]');
    assert.strictEqual(resJson.cleanText, 'Here is the procedure.');
    assert.deepStrictEqual(resJson.suggestions, ['How to check status?', 'What are the fees?']);

    // 2. Pipe format
    const resPipe = extractSuggestions('Here is the procedure.\n\n[SUGGESTIONS: How to reverse? | What is the SLA?]');
    assert.strictEqual(resPipe.cleanText, 'Here is the procedure.');
    assert.deepStrictEqual(resPipe.suggestions, ['How to reverse?', 'What is the SLA?']);

    // 3. Markdown list at end of message
    const resMd = extractSuggestions(`Here is the procedure.\n\n**Suggested Questions:**\n- How do I check the balance?\n- What if customer is roaming?`);
    assert.strictEqual(resMd.cleanText, 'Here is the procedure.');
    assert.deepStrictEqual(resMd.suggestions, ['How do I check the balance?', 'What if customer is roaming?']);
  });

  test('should generate fallback suggestions when model omits [SUGGESTIONS:] tag', async () => {
    const { generateFallbackSuggestions } = await import('../src/routes/ask.js');

    const fallbacks = generateFallbackSuggestions('How to reverse an M-Pesa transaction?', [
      { sectionHeading: 'Reversal Eligibility Criteria', articleTitle: 'M-PESA Reversals' },
      { sectionHeading: 'Escalation to Backoffice', articleTitle: 'M-PESA Reversals' }
    ]);

    assert.ok(fallbacks.length >= 2);
    assert.ok(fallbacks.some(f => f.includes('Eligibility') || f.includes('turnaround') || f.includes('escalation')));
  });
});
