import { test, describe } from 'node:test';
import assert from 'node:assert';
import { generateTextFragment, encodeTextFragment } from '../src/services/chunker.js';

describe('Text Fragment Generation', () => {
  test('should encode special characters per W3C specification', () => {
    assert.strictEqual(encodeTextFragment('hello world'), 'hello%20world');
    assert.strictEqual(encodeTextFragment('fee-paying'), 'fee%2Dpaying');
    assert.strictEqual(encodeTextFragment('terms, conditions'), 'terms%2C%20conditions');
    assert.strictEqual(encodeTextFragment('M&M'), 'M%26M');
  });

  test('should generate single textStart format for short quotes (<10 words) preserving USSD codes', () => {
    const shortQuote = 'Dial *334# and select Option 7';
    const fragment = generateTextFragment(shortQuote);
    assert.strictEqual(fragment, '#:~:text=Dial%20*334%23%20and%20select%20Option%207');
  });

  test('should generate Range format (textStart,textEnd) for moderate/long quotes (>=10 words)', () => {
    const longQuote = 'To reverse an M-Pesa transaction that was sent to the wrong number dial *334# immediately within two hours.';
    const fragment = generateTextFragment(longQuote);

    // Range format: #:~:text=startWords,endWords
    // startWords: "To reverse an M-Pesa" -> M-Pesa has dash encoded as %2D
    // endWords: "immediately within two hours."
    assert.ok(fragment.startsWith('#:~:text='));
    assert.ok(fragment.includes(',')); // Comma separating start and end range
    assert.ok(fragment.includes('To%20reverse%20an%20M%2DPesa'));
    assert.ok(fragment.includes('immediately%20within%20two%20hours.'));
  });

  test('should construct canonical SakaHub citation URL with /app/article/ prefix and text fragment', () => {
    const articleId = '9d0967c3-104c-4dc7-b7e1-0938bbf37fb1';
    const quote = 'Dial *334# and select Option 7';
    const fragment = generateTextFragment(quote);
    const fullUrl = `https://sakahub.safaricom.co.ke/app/article/${articleId}${fragment}`;
    assert.strictEqual(
      fullUrl,
      'https://sakahub.safaricom.co.ke/app/article/9d0967c3-104c-4dc7-b7e1-0938bbf37fb1#:~:text=Dial%20*334%23%20and%20select%20Option%207'
    );
  });

  test('should strip leading Word middle dots and bullets without breaking text matching', () => {
    const wordBulletQuote = '· Query the customer number on M-PESA G2 and confirm ownership of the line using the Customer Names as per M-PESA system.';
    const fragment = generateTextFragment(wordBulletQuote);
    assert.ok(!fragment.includes('%C2%B7'), 'Should not contain encoded middle dot (%C2%B7)');
    assert.ok(fragment.includes('Query%20the%20customer'), 'Should start directly with clean words');
  });

  test('should strip leading unicode bullet and dash list markers', () => {
    const bulletQuote = '• Search the number seeking assistance on CRM.';
    const fragment = generateTextFragment(bulletQuote);
    assert.ok(!fragment.includes('%E2%80%A2'), 'Should not contain encoded bullet');
    assert.ok(fragment.includes('Search%20the%20number'), 'Should start directly with clean text');

    const dashQuote = '- Initiate the reversal and advise on the 12 working hours SLA.';
    const dashFragment = generateTextFragment(dashQuote);
    assert.ok(dashFragment.includes('Initiate%20the%20reversal'));
  });
});

