import { test, describe } from 'node:test';
import assert from 'node:assert';

interface ArticleSummary {
  id: string;
  lastUpdated: string;
}

function computeDiff(
  sakahubArticles: ArticleSummary[],
  backendVersions: Record<string, string>
) {
  const sakahubMap = new Map(sakahubArticles.map(a => [a.id, a.lastUpdated]));
  const backendIds = new Set(Object.keys(backendVersions));

  const added: ArticleSummary[] = [];
  const updated: ArticleSummary[] = [];
  const deletedIds: string[] = [];

  for (const [id, lastUpdated] of sakahubMap.entries()) {
    if (!backendIds.has(id)) {
      added.push({ id, lastUpdated });
    } else {
      const backendDate = new Date(backendVersions[id]).getTime();
      const sakaDate = new Date(lastUpdated).getTime();
      if (sakaDate !== backendDate) {
        updated.push({ id, lastUpdated });
      }
    }
  }

  for (const backendId of backendIds) {
    if (!sakahubMap.has(backendId)) {
      deletedIds.push(backendId);
    }
  }

  return { added, updated, deletedIds };
}

describe('Sync Set Diffing Logic', () => {
  test('should detect added, updated, and deleted articles correctly without count confusion', () => {
    // 1 added (art-3), 1 updated (art-2), 1 deleted (art-4)
    // Notice: backend has 3 items, saka has 3 items. Net count change is 0!
    // Set diffing must detect all 3 changes correctly.
    const sakahubArticles: ArticleSummary[] = [
      { id: 'art-1', lastUpdated: '2026-09-01T10:00:00Z' }, // Unchanged
      { id: 'art-2', lastUpdated: '2026-09-02T12:00:00Z' }, // Updated
      { id: 'art-3', lastUpdated: '2026-09-02T15:00:00Z' }, // Added
    ];

    const backendVersions: Record<string, string> = {
      'art-1': '2026-09-01T10:00:00Z',
      'art-2': '2026-09-01T10:00:00Z', // Old date
      'art-4': '2026-09-01T08:00:00Z', // Deleted from SakaHub
    };

    const diff = computeDiff(sakahubArticles, backendVersions);

    assert.strictEqual(diff.added.length, 1);
    assert.strictEqual(diff.added[0].id, 'art-3');

    assert.strictEqual(diff.updated.length, 1);
    assert.strictEqual(diff.updated[0].id, 'art-2');

    assert.strictEqual(diff.deletedIds.length, 1);
    assert.strictEqual(diff.deletedIds[0], 'art-4');
  });
});
