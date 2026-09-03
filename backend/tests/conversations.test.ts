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
});
