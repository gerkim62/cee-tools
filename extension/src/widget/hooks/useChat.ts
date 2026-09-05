import { useState, useCallback, useRef, useMemo } from 'react';
import { ChatMessage, AskStreamServerMessage } from '../../types.js';
import { getBackendUrl, getClientId } from '../../scripts/syncer.js';
import { bgFetch } from '../../scripts/bg-fetch.js';

export interface BranchInfo {
  current: number;
  total: number;
  canPrev: boolean;
  canNext: boolean;
}

/**
 * Traces up from leafId to root to construct the active conversation thread
 */
function getPathToLeaf(leafId: string | null, msgs: ChatMessage[]): ChatMessage[] {
  if (!leafId || msgs.length === 0) return [];
  const msgMap = new Map(msgs.map((m) => [m.id, m]));
  const path: ChatMessage[] = [];
  let curr: ChatMessage | undefined = msgMap.get(leafId);
  const visited = new Set<string>();

  while (curr && !visited.has(curr.id)) {
    visited.add(curr.id);
    path.unshift(curr);
    if (!curr.parentId) break;
    curr = msgMap.get(curr.parentId);
  }

  // If leafId was an orphaned node or not found, fall back to linear chronological list
  if (path.length === 0) {
    return msgs;
  }
  return path;
}

/**
 * Given a node, finds its latest/deepest descendant leaf node by following the newest children
 */
function findLatestDescendant(nodeId: string, msgs: ChatMessage[]): string {
  let currentId = nodeId;
  const visited = new Set<string>();

  while (!visited.has(currentId)) {
    visited.add(currentId);
    const children = msgs
      .filter((m) => m.parentId === currentId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    if (children.length === 0) break;
    // Pick latest child
    currentId = children[children.length - 1].id;
  }

  return currentId;
}

/**
 * Mask raw stream tags while tokens arrive so <suggest> / <clarify> tags do not flash raw in markdown
 */
function maskStreamTags(text: string): string {
  return text
    .replace(/<(?:suggest|clarify)[\s\S]*$/i, '')
    .replace(/\[(?:SUGGESTIONS|FOLLOWUP|FOLLOWUPS):[\s\S]*$/i, '')
    .replace(/\[CLARIFICATION:[\s\S]*$/i, '')
    .trimEnd();
}

export function useChat() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string | null>(null);
  const [isCompacted, setIsCompacted] = useState(false);
  const [conversationSummary, setConversationSummary] = useState<string | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);

  // All messages in the conversation tree
  const [allMessages, setAllMessages] = useState<ChatMessage[]>([]);
  // Active leaf node ID defining the currently displayed branch path
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);

  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  // Derive the active branch path from root to active leaf
  const messages = useMemo(() => {
    return getPathToLeaf(activeLeafId, allMessages);
  }, [activeLeafId, allMessages]);

  const startNewChat = useCallback(() => {
    if (portRef.current) {
      try {
        portRef.current.disconnect();
      } catch {}
      portRef.current = null;
    }
    setConversationId(null);
    setConversationTitle(null);
    setIsCompacted(false);
    setConversationSummary(null);
    setAllMessages([]);
    setActiveLeafId(null);
    setStatusLog([]);
    setIsStreaming(false);
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    try {
      const backendUrl = await getBackendUrl();
      const res = await bgFetch(`${backendUrl}/conversations/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = res.data;

      setConversationId(data.conversation.id);
      setConversationTitle(data.conversation.title || null);
      setIsCompacted(Boolean(data.conversation.isCompacted));
      setConversationSummary(data.conversation.summary || null);

      const rawMsgs = data.messages || [];
      const formattedMessages: ChatMessage[] = rawMsgs.map((m: any, idx: number) => ({
        id: m.id,
        // For legacy records without parentId, infer linear chain
        parentId: m.parentId !== undefined ? m.parentId : idx > 0 ? rawMsgs[idx - 1].id : null,
        role: m.role,
        content: m.content,
        citations: m.citations || undefined,
        executionSteps: m.executionSteps || undefined,
        clarifyingQuestion: m.clarifyingQuestion || undefined,
        suggestedFollowUps: m.suggestedFollowUps || undefined,
        createdAt: m.createdAt,
      }));

      setAllMessages(formattedMessages);
      // Automatically select the latest message as the active leaf
      if (formattedMessages.length > 0) {
        const latestMsg = formattedMessages[formattedMessages.length - 1];
        setActiveLeafId(latestMsg.id);
      } else {
        setActiveLeafId(null);
      }

      setStatusLog([]);
      setIsStreaming(false);
    } catch (err) {
      console.error('[useChat] Failed loading conversation via background:', err);
    }
  }, []);

  const compactCurrentConversation = useCallback(async () => {
    if (!conversationId || isCompacting || isStreaming) return;
    setIsCompacting(true);
    try {
      const backendUrl = await getBackendUrl();
      const res = await bgFetch(`${backendUrl}/conversations/${conversationId}/compact`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.data?.error || 'Compaction failed'}`);
      const data = res.data;
      if (data?.newConversation?.id) {
        await loadConversation(data.newConversation.id);
      }
    } catch (err) {
      console.error('[useChat] Compaction failed:', err);
    } finally {
      setIsCompacting(false);
    }
  }, [conversationId, isCompacting, isStreaming, loadConversation]);

  /**
   * Calculates branch info for a given message
   */
  const getBranchInfo = useCallback(
    (messageId: string): BranchInfo => {
      const target = allMessages.find((m) => m.id === messageId);
      if (!target) {
        return { current: 1, total: 1, canPrev: false, canNext: false };
      }

      const parentKey = target.parentId || null;
      const siblings = allMessages
        .filter((m) => (m.parentId || null) === parentKey && m.role === target.role)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      const index = siblings.findIndex((s) => s.id === messageId);
      const total = Math.max(siblings.length, 1);
      const current = index >= 0 ? index + 1 : 1;

      return {
        current,
        total,
        canPrev: index > 0,
        canNext: index >= 0 && index < siblings.length - 1,
      };
    },
    [allMessages]
  );

  /**
   * Switches branch at a given message node
   */
  const switchBranch = useCallback(
    (messageId: string, direction: 'prev' | 'next') => {
      const target = allMessages.find((m) => m.id === messageId);
      if (!target) return;

      const parentKey = target.parentId || null;
      const siblings = allMessages
        .filter((m) => (m.parentId || null) === parentKey && m.role === target.role)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      const index = siblings.findIndex((s) => s.id === messageId);
      if (index === -1) return;

      let targetSibling: ChatMessage | undefined;
      if (direction === 'prev' && index > 0) {
        targetSibling = siblings[index - 1];
      } else if (direction === 'next' && index < siblings.length - 1) {
        targetSibling = siblings[index + 1];
      }

      if (targetSibling) {
        // Find deepest descendant from this target sibling
        const newLeaf = findLatestDescendant(targetSibling.id, allMessages);
        setActiveLeafId(newLeaf);
      }
    },
    [allMessages]
  );

  /**
   * Core send message handler (handles normal questions, assistant retries, and edited prompts)
   */
  const sendMessage = useCallback(
    async (
      rawQuestion: string,
      options?: { parentId?: string | null; retryUserMessageId?: string | null }
    ) => {
      const trimmed = rawQuestion.trim();
      if (!trimmed || isStreaming) return;

      const isRetry = Boolean(options?.retryUserMessageId);
      const userMsgId = options?.retryUserMessageId || `user_${Date.now()}`;
      const assistantMsgId = `asst_${Date.now()}`;

      // Determine parent for the user message (if not a retry)
      const effectiveParentId =
        options?.parentId !== undefined
          ? options.parentId
          : activeLeafId || null;

      const newMessagesToAdd: ChatMessage[] = [];

      // If NOT an assistant retry, insert new user message
      if (!isRetry) {
        const userMsg: ChatMessage = {
          id: userMsgId,
          parentId: effectiveParentId,
          role: 'user',
          content: trimmed,
          createdAt: new Date().toISOString(),
        };
        newMessagesToAdd.push(userMsg);
      }

      // Placeholder assistant message
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        parentId: userMsgId,
        role: 'assistant',
        content: '',
        citations: [],
        createdAt: new Date().toISOString(),
        isStreaming: true,
      };
      newMessagesToAdd.push(assistantMsg);

      setAllMessages((prev) => [...prev, ...newMessagesToAdd]);
      setActiveLeafId(assistantMsgId);
      setIsStreaming(true);
      setStatusLog(['> Understanding request...']);

      let hasReceivedDone = false;

      try {
        const clientId = await getClientId();

        const port = chrome.runtime.connect({ name: 'ASK_STREAM' });
        portRef.current = port;

        const formatFriendlyError = (rawErr: string) => {
          return `⚠️ **Ask Saka Service Unavailable**\n\nWe were unable to connect to the knowledge service to answer your question right now. Please try again in a few moments.\n\n<details><summary style="cursor:pointer;color:#94a3b8;font-size:11.5px;margin-top:6px;">Technical details</summary><pre style="font-size:11px;color:#cbd5e1;background:rgba(0,0,0,0.3);padding:6px;border-radius:4px;margin-top:4px;overflow-x:auto;">${rawErr}</pre></details>`;
        };

        port.onMessage.addListener((msg: AskStreamServerMessage) => {
          if (msg.type === 'status') {
            setStatusLog((prev) => {
              const line = `> ${msg.message}`;
              if (prev[prev.length - 1] === line) return prev;
              return [...prev, line];
            });

            if (msg.label && msg.detail) {
              setAllMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantMsgId) return m;
                  const existing = m.executionSteps || [];
                  const filtered = existing.filter((s) => s.label !== msg.label);
                  return {
                    ...m,
                    executionSteps: [...filtered, { label: msg.label!, detail: msg.detail! }],
                  };
                })
              );
            }
          } else if (msg.type === 'token') {
            setAllMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMsgId) return m;
                const newRaw = m.content + msg.delta;
                return { ...m, content: maskStreamTags(newRaw) };
              })
            );
          } else if (msg.type === 'citations') {
            setAllMessages((prev) =>
              prev.map((m) => (m.id === assistantMsgId ? { ...m, citations: msg.citations } : m))
            );
          } else if (msg.type === 'done') {
            hasReceivedDone = true;
            if (msg.conversationId) {
              setConversationId(msg.conversationId);
            }
            if (msg.conversationTitle) {
              setConversationTitle(msg.conversationTitle);
            }

            const realAssistantId = msg.messageId || assistantMsgId;
            const realUserId = msg.userMessageId || userMsgId;

            setAllMessages((prev) =>
              prev.map((m) => {
                if (m.id === userMsgId && msg.userMessageId) {
                  return { ...m, id: realUserId };
                }
                if (m.id === assistantMsgId) {
                  return {
                    ...m,
                    id: realAssistantId,
                    parentId: realUserId,
                    content: msg.answer || m.content,
                    citations: msg.citations || m.citations,
                    executionSteps: msg.executionSteps || m.executionSteps,
                    clarifyingQuestion: msg.clarifyingQuestion,
                    suggestedFollowUps: msg.suggestedFollowUps,
                    isStreaming: false,
                  };
                }
                return m;
              })
            );

            setActiveLeafId(realAssistantId);
            setIsStreaming(false);
            try {
              port.disconnect();
            } catch {}
            portRef.current = null;
          } else if (msg.type === 'error') {
            hasReceivedDone = true;
            const friendly = formatFriendlyError(msg.message);
            setAllMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: friendly,
                      isStreaming: false,
                    }
                  : m
              )
            );
            setIsStreaming(false);
            try {
              port.disconnect();
            } catch {}
            portRef.current = null;
          }
        });

        port.onDisconnect.addListener(() => {
          if (!hasReceivedDone) {
            const rawMsg = chrome.runtime.lastError?.message || 'Connection lost';
            setAllMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: m.content
                        ? `${m.content}\n\n⚠️ *(Response was interrupted due to a temporary connection issue. Click Retry below to regenerate.)*`
                        : `⚠️ **Connection Interrupted**\n\nThe connection was closed before completing your response. Click Retry below to resubmit.\n\n<details><summary style="cursor:pointer;color:#94a3b8;font-size:11.5px;margin-top:6px;">Technical details</summary><pre style="font-size:11px;color:#cbd5e1;background:rgba(0,0,0,0.3);padding:6px;border-radius:4px;margin-top:4px;overflow-x:auto;">${rawMsg}</pre></details>`,
                      isStreaming: false,
                    }
                  : m
              )
            );
          }
          setIsStreaming(false);
          portRef.current = null;
        });

        port.postMessage({
          type: 'START_ASK',
          question: trimmed,
          conversationId: conversationId || undefined,
          clientId,
          parentId: !isRetry ? effectiveParentId : undefined,
          retryUserMessageId: isRetry ? userMsgId : undefined,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setAllMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: `❌ **Connection error**: ${msg}`,
                  isStreaming: false,
                }
              : m
          )
        );
        setIsStreaming(false);
      }
    },
    [conversationId, isStreaming, activeLeafId]
  );

  /**
   * Retries an assistant response by re-running the question of its parent user message
   */
  const retryResponse = useCallback(
    (assistantMessageId: string) => {
      if (isStreaming) return;
      const assistantMsg = allMessages.find((m) => m.id === assistantMessageId);
      if (!assistantMsg || !assistantMsg.parentId) return;

      const userMsg = allMessages.find((m) => m.id === assistantMsg.parentId);
      if (!userMsg) return;

      sendMessage(userMsg.content, { retryUserMessageId: userMsg.id });
    },
    [allMessages, isStreaming, sendMessage]
  );

  /**
   * Edits a previous user message, branching the conversation from that turn
   */
  const editUserMessage = useCallback(
    (userMessageId: string, newQuestion: string) => {
      if (isStreaming) return;
      const userMsg = allMessages.find((m) => m.id === userMessageId);
      if (!userMsg) return;

      // The new user message will branch from the same parent as the original
      sendMessage(newQuestion, { parentId: userMsg.parentId || null });
    },
    [allMessages, isStreaming, sendMessage]
  );

  return {
    conversationId,
    conversationTitle,
    isCompacted,
    conversationSummary,
    isCompacting,
    compactCurrentConversation,
    messages,
    statusLog,
    isStreaming,
    sendMessage,
    startNewChat,
    loadConversation,
    switchBranch,
    getBranchInfo,
    retryResponse,
    editUserMessage,
  };
}
