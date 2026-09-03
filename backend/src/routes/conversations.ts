import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { query } from '../db.js';

export const conversationsRouter: Router = Router();

export interface ConversationSummary {
  id: string;
  clientId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: any[];
  createdAt: string;
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
      `SELECT c.id, c.client_id, c.title, c.created_at, c.updated_at,
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
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      messageCount: row.message_count,
    }));

    res.json({ conversations });
  } catch (error) {
    console.error('[Conversations Router] Failed to list conversations:', error);
    res.status(500).json({ error: 'Failed to retrieve conversations', message: error.message });
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
      `SELECT id, client_id, title, created_at, updated_at FROM conversations WHERE id = $1`,
      [id]
    );

    if (convResult.rows.length === 0) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const conv = convResult.rows[0];

    const messagesResult = await query(
      `SELECT id, conversation_id, role, content, citations, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    const messages: ConversationMessage[] = messagesResult.rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      citations: row.citations || undefined,
      createdAt: new Date(row.created_at).toISOString(),
    }));

    res.json({
      conversation: {
        id: conv.id,
        clientId: conv.client_id,
        title: conv.title,
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
       RETURNING id, client_id, title, created_at, updated_at`,
      [id, clientId, convTitle]
    );

    const row = result.rows[0];
    res.json({
      conversation: {
        id: row.id,
        clientId: row.client_id,
        title: row.title,
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
