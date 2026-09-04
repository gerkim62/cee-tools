import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { query } from '../db.js';
import { chatCompletion } from '../services/openrouter.js';

export const conversationsRouter: Router = Router();

export interface ConversationSummary {
  id: string;
  clientId: string;
  title: string;
  isCompacted?: boolean;
  summary?: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  snippetMatch?: string | null;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  parentId?: string | null;
  role: 'user' | 'assistant';
  content: string;
  citations?: any[];
  executionSteps?: Array<{ label: string; detail: string }>;
  clarifyingQuestion?: any;
  suggestedFollowUps?: string[];
  createdAt: string;
}

function formatSnippet(content: string, queryText: string): string {
  const clean = content.replace(/[#*`_~]/g, ' ').replace(/\s+/g, ' ');
  const idx = clean.toLowerCase().indexOf(queryText.toLowerCase());
  if (idx === -1) return clean.slice(0, 100) + '...';
  const start = Math.max(0, idx - 40);
  const end = Math.min(clean.length, idx + queryText.length + 60);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < clean.length ? '...' : '';
  return `${prefix}${clean.slice(start, end).trim()}${suffix}`;
}

/**
 * GET /conversations?clientId=...
 * Lists all conversations belonging to a specific anonymous client installation.
 */
conversationsRouter.get('/conversations', async (req: Request, res: Response): Promise<void> => {
  try {
    const clientId = req.query.clientId as string;
    if (!clientId) {
      res.status(400).json({ error: 'clientId query parameter is required' });
      return;
    }

    const result = await query(
      `SELECT c.id, c.client_id, c.title, c.is_compacted, c.summary, c.created_at, c.updated_at,
              COUNT(m.id)::int AS message_count
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.client_id = $1
       GROUP BY c.id
       ORDER BY c.updated_at DESC
       LIMIT 50`,
      [clientId]
    );

    const conversations: ConversationSummary[] = result.rows.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      title: row.title,
      isCompacted: Boolean(row.is_compacted),
      summary: row.summary || null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      messageCount: row.message_count,
    }));

    res.json({ conversations });
  } catch (error: any) {
    console.error('[Conversations Router] Failed to list conversations:', error);
    res.status(500).json({ error: 'Failed to retrieve conversations', message: error.message });
  }
});

/**
 * GET /conversations/search?clientId=...&q=...&limit=30&offset=0
 * Performs zero-AI-credit hybrid SQL search across conversation titles and message content.
 */
conversationsRouter.get('/conversations/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const clientId = req.query.clientId as string;
    const q = req.query.q as string;
    const limit = Math.min(parseInt(req.query.limit as string || '30', 10), 100);
    const offset = parseInt(req.query.offset as string || '0', 10);

    if (!clientId) {
      res.status(400).json({ error: 'clientId query parameter is required' });
      return;
    }

    if (!q || !q.trim()) {
      res.status(400).json({ error: 'q query parameter is required' });
      return;
    }

    const searchTerm = `%${q.trim()}%`;

    const result = await query(
      `SELECT c.id, c.client_id, c.title, c.is_compacted, c.summary, c.created_at, c.updated_at,
              COUNT(DISTINCT m.id)::int AS message_count,
              (
                SELECT m2.content
                FROM messages m2
                WHERE m2.conversation_id = c.id
                  AND m2.content ILIKE $2
                ORDER BY m2.created_at ASC
                LIMIT 1
              ) AS snippet_match
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.client_id = $1
         AND (
           c.title ILIKE $2
           OR EXISTS (
             SELECT 1 FROM messages m3
             WHERE m3.conversation_id = c.id AND m3.content ILIKE $2
           )
         )
       GROUP BY c.id
       ORDER BY c.updated_at DESC
       LIMIT $3 OFFSET $4`,
      [clientId, searchTerm, limit, offset]
    );

    const conversations: ConversationSummary[] = result.rows.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      title: row.title,
      isCompacted: Boolean(row.is_compacted),
      summary: row.summary || null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      messageCount: row.message_count,
      snippetMatch: row.snippet_match ? formatSnippet(row.snippet_match, q.trim()) : null,
    }));

    res.json({ conversations });
  } catch (error: any) {
    console.error('[Conversations Search] Failed searching conversations:', error);
    res.status(500).json({ error: 'Failed searching conversations', message: error.message });
  }
});

/**
 * GET /conversations/:id
 * Retrieves a single conversation thread along with its full messages.
 */
conversationsRouter.get('/conversations/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const convResult = await query(
      `SELECT id, client_id, title, is_compacted, summary, created_at, updated_at FROM conversations WHERE id = $1`,
      [id]
    );

    if (convResult.rows.length === 0) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const conv = convResult.rows[0];

    const messagesResult = await query(
      `SELECT id, conversation_id, parent_id, role, content, citations, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    const messages: ConversationMessage[] = messagesResult.rows.map((row) => {
      let citations: any[] | undefined = undefined;
      let executionSteps: Array<{ label: string; detail: string }> | undefined = undefined;
      let clarifyingQuestion: any = undefined;
      let suggestedFollowUps: string[] | undefined = undefined;

      if (Array.isArray(row.citations)) {
        citations = row.citations;
      } else if (row.citations && typeof row.citations === 'object') {
        citations = row.citations.citations || undefined;
        executionSteps = row.citations.executionSteps || undefined;
        clarifyingQuestion = row.citations.clarifyingQuestion || undefined;
        suggestedFollowUps = row.citations.suggestedFollowUps || undefined;
      }

      return {
        id: row.id,
        conversationId: row.conversation_id,
        parentId: row.parent_id || null,
        role: row.role,
        content: row.content,
        citations,
        executionSteps,
        clarifyingQuestion,
        suggestedFollowUps,
        createdAt: new Date(row.created_at).toISOString(),
      };
    });

    res.json({
      conversation: {
        id: conv.id,
        clientId: conv.client_id,
        title: conv.title,
        isCompacted: Boolean(conv.is_compacted),
        summary: conv.summary || null,
        createdAt: new Date(conv.created_at).toISOString(),
        updatedAt: new Date(conv.updated_at).toISOString(),
      },
      messages,
    });
  } catch (error: any) {
    console.error('[Conversations Router] Failed to fetch conversation:', error);
    res.status(500).json({ error: 'Failed to retrieve conversation', message: error.message });
  }
});

/**
 * POST /conversations
 * Explicitly initializes a new conversation thread.
 */
conversationsRouter.post('/conversations', async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientId, title } = req.body;
    if (!clientId) {
      res.status(400).json({ error: 'clientId is required' });
      return;
    }

    const id = crypto.randomUUID();
    const convTitle = (typeof title === 'string' && title.trim().length > 0) ? title.trim().slice(0, 80) : 'New Conversation';

    const result = await query(
      `INSERT INTO conversations (id, client_id, title, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING id, client_id, title, is_compacted, summary, created_at, updated_at`,
      [id, clientId, convTitle]
    );

    const row = result.rows[0];
    res.json({
      conversation: {
        id: row.id,
        clientId: row.client_id,
        title: row.title,
        isCompacted: Boolean(row.is_compacted),
        summary: row.summary || null,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      },
    });
  } catch (error: any) {
    console.error('[Conversations Router] Failed to create conversation:', error);
    res.status(500).json({ error: 'Failed to create conversation', message: error.message });
  }
});

/**
 * POST /conversations/:id/compact
 * Compacts an existing conversation thread:
 * 1. Generates structured operational summary (Issue, Actions Taken, Current Status/Next Steps).
 * 2. Locks existing conversation (is_compacted = true).
 * 3. Creates a new conversation seeded with the compacted summary.
 */
conversationsRouter.post('/conversations/:id/compact', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const convRes = await query(
      `SELECT id, client_id, title, is_compacted FROM conversations WHERE id = $1`,
      [id]
    );
    if (convRes.rows.length === 0) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    const oldConv = convRes.rows[0];

    const msgsRes = await query(
      `SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [id]
    );

    if (msgsRes.rows.length === 0) {
      res.status(400).json({ error: 'Cannot compact an empty conversation' });
      return;
    }

    const transcript = msgsRes.rows
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    const summaryPrompt = `You are a Safaricom CEE Quality & Operations specialist.
Summarize the following customer support conversation into a clear, factual handover briefing for another agent:

Strict Format:
- **Customer Issue / Request:** <Brief summary of what the customer needed>
- **Verified Rules & Actions Taken:** <Key policy findings, steps executed, or eligibility checked from SakaHub>
- **Current Status & Pending Actions:** <What was resolved vs what still needs to happen (e.g. SR logged on G3/Siebel, partner consent pending, retail escalation)>

Note: Rely strictly on the verified facts and actions documented in this conversation transcript. Do not assume or inject generic external policies, hypothetical SLAs, or stale examples.`;

    const summaryText = await chatCompletion([
      { role: 'system', content: summaryPrompt },
      { role: 'user', content: transcript },
    ], {
      temperature: 0.2,
    });

    const cleanSummary = summaryText.trim();

    // Lock existing conversation
    await query(
      `UPDATE conversations SET is_compacted = TRUE, summary = $1, updated_at = NOW() WHERE id = $2`,
      [cleanSummary, id]
    );

    // Create new seeded conversation
    const newConvId = crypto.randomUUID();
    const newTitle = oldConv.title.startsWith('Continued:') ? oldConv.title : `Continued: ${oldConv.title}`;

    await query(
      `INSERT INTO conversations (id, client_id, title, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [newConvId, oldConv.client_id, newTitle]
    );

    const seedMessage = `📌 **Compacted History Context from Previous Conversation:**\n\n${cleanSummary}\n\n*This conversation continues from the compacted handover above.*`;
    await query(
      `INSERT INTO messages (id, conversation_id, role, content, citations, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [crypto.randomUUID(), newConvId, 'assistant', seedMessage, JSON.stringify({ citations: [] })]
    );

    res.json({
      success: true,
      summary: cleanSummary,
      oldConversationId: id,
      newConversation: {
        id: newConvId,
        clientId: oldConv.client_id,
        title: newTitle,
        isCompacted: false,
        summary: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('[Conversations Compact] Failed compacting conversation:', error);
    res.status(500).json({ error: 'Failed compacting conversation', message: error.message });
  }
});

/**
 * DELETE /conversations/:id
 * Deletes a conversation and all its messages.
 */
conversationsRouter.delete('/conversations/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await query(`DELETE FROM conversations WHERE id = $1`, [id]);
    res.json({ success: true, message: 'Conversation deleted' });
  } catch (error: any) {
    console.error('[Conversations Router] Failed to delete conversation:', error);
    res.status(500).json({ error: 'Failed to delete conversation', message: error.message });
  }
});
