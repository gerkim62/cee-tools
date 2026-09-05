import { useState, useCallback, useRef, useMemo } from 'react';
import { ChatMessage, AskStreamServerMessage, ConversationSummary } from '../../types.js';
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
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [conversationLoadError, setConversationLoadError] = useState<string | null>(null);
  const [focusTrigger, setFocusTrigger] = useState(0);
  const [isDeleted, setIsDeleted] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [historyRefreshTrigger, setHistoryRefreshTrigger] = useState(0);

  // All messages in the conversation tree
  const [allMessages, setAllMessages] = useState<ChatMessage[]>([]);
  // Active leaf node ID defining the currently displayed branch path
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);

  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  // Derive the active branch path from root to active leaf
  const messages = useMemo(() => {
    return getPathToLeaf(activeLeafId, allMessages);
  }, [activeLeafId, allMessages]);

  const startNewChat = useCallback(() => {
    if (portRef.current) {
      try {
        portRef.current.disconnect();
      } catch { }
      portRef.current = null;
    }
    setConversationId(null);
    setConversationTitle(null);
    setIsCompacted(false);
    setConversationSummary(null);
    setIsDeleted(false);
    setConversationLoadError(null);
    setAllMessages([]);
    setActiveLeafId(null);
    setStatusLog([]);
    setIsStreaming(false);
    setFocusTrigger((prev) => prev + 1);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove(['saka_active_conversation_id']).catch(() => {});
    }
  }, []);

  const markConversationDeleted = useCallback((targetId?: string) => {
    if (!targetId || targetId === conversationId) {
      setIsDeleted(true);
    }
    setHistoryRefreshTrigger((prev) => prev + 1);
  }, [conversationId]);

  const restoreConversation = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!conversationId) return { success: false, error: 'No active conversation' };
    setIsRestoring(true);
    try {
      const backendUrl = await getBackendUrl();
      const res = await bgFetch(`${backendUrl}/conversations/${conversationId}/restore`, { method: 'POST' });
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
      setIsDeleted(false);
      setHistoryRefreshTrigger((prev) => prev + 1);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[useChat] Failed to restore conversation:', err);
      return { success: false, error: msg };
    } finally {
      setIsRestoring(false);
    }
  }, [conversationId]);

  const loadConversation = useCallback(async (id: string) => {
    if (portRef.current) {
      try {
        portRef.current.disconnect();
      } catch {}
      portRef.current = null;
      setIsStreaming(false);
    }
    setIsDeleted(false);
    setIsLoadingConversation(true);
    setConversationLoadError(null);
    try {
      const backendUrl = await getBackendUrl();
      const res = await bgFetch<{ conversation: ConversationSummary; messages: ChatMessage[] }>(
        `${backendUrl}/conversations/${id}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = res.data;

      setConversationId(data.conversation.id);
      setConversationTitle(data.conversation.title || null);
      setIsCompacted(Boolean(data.conversation.isCompacted));
      setConversationSummary(data.conversation.summary || null);

      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['saka_remember_conversation_across_tabs'], (stored) => {
          if (stored.saka_remember_conversation_across_tabs) {
            chrome.storage.local.set({ saka_active_conversation_id: data.conversation.id }).catch(() => {});
          }
        });
      }

      const rawMsgs = Array.isArray(data.messages) ? data.messages : [];
      const formattedMessages: ChatMessage[] = rawMsgs.map((m: ChatMessage, idx: number) => ({
        id: m.id,
        // For legacy records without parentId, infer linear chain
        parentId: m.parentId !== undefined ? m.parentId : idx > 0 ? rawMsgs[idx - 1].id : null,
        role: m.role,
        content: m.content,
        status: m.status || 'completed',
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

      setConversationLoadError(null);
      setStatusLog([]);
      setIsStreaming(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[useChat] Failed loading conversation via background:', err);
      setConversationLoadError(msg || 'Unable to connect to conversation service');
    } finally {
      setIsLoadingConversation(false);
    }
  }, []);

  const compactCurrentConversation = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!conversationId || isCompacting || isStreaming) {
      return { success: false, error: 'Cannot summarize at this time' };
    }
    setIsCompacting(true);
    try {
      const backendUrl = await getBackendUrl();
      const res = await bgFetch<{ newConversation?: { id: string }; error?: string }>(
        `${backendUrl}/conversations/${conversationId}/compact`,
        {
          method: 'POST',
        }
      );
      const data = res.data;
      if (!res.ok) {
        const errMsg = data?.error || 'Compaction failed';
        throw new Error(`HTTP ${res.status}: ${errMsg}`);
      }
      if (data?.newConversation?.id) {
        await loadConversation(data.newConversation.id);
      }
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[useChat] Compaction failed:', err);
      return { success: false, error: msg };
    } finally {
      setIsCompacting(false);
    }
  }, [conversationId, isCompacting, isStreaming, loadConversation]);

  const stopGeneration = useCallback(() => {
    setIsStopping(true);
    if (portRef.current) {
      try {
        portRef.current.disconnect();
      } catch {}
      portRef.current = null;
    }

    setAllMessages((prev) =>
      prev.map((m) => {
        if (m.isStreaming) {
          return {
            ...m,
            status: 'stopped',
            isStreaming: false,
          };
        }
        return m;
      })
    );

    setIsStreaming(false);
    setStatusLog([]);

    setTimeout(() => {
      setIsStopping(false);
    }, 1500);
  }, []);

  const resumeGeneration = useCallback(
    async (messageId: string) => {
      if (isStreaming || isStopping) return;

      const targetMsg = allMessages.find((m) => m.id === messageId);
      if (!targetMsg || targetMsg.role !== 'assistant') return;

      setIsStreaming(true);
      setStatusLog(['> Resuming answer generation...']);

      setAllMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                status: 'streaming',
                isStreaming: true,
              }
            : m
        )
      );

      try {
        const clientId = await getClientId();
        const storedChannel = await new Promise<'care_center' | 'retail'>((resolve) => {
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(['saka_agent_channel'], (res) => {
              resolve(res?.saka_agent_channel || 'care_center');
            });
          } else {
            resolve('care_center');
          }
        });
        const port = chrome.runtime.connect({ name: 'ASK_STREAM' });
        portRef.current = port;

        port.onMessage.addListener((msg: AskStreamServerMessage) => {
          if (msg.type === 'status') {
            setStatusLog((prev) => {
              const line = `> ${msg.message}`;
              if (prev[prev.length - 1] === line) return prev;
              return [...prev, line];
            });
          } else if (msg.type === 'token') {
            setAllMessages((prev) =>
              prev.map((m) => {
                if (m.id !== messageId) return m;
                const delta = msg.delta || msg.token || '';
                const newRaw = m.content + delta;
                return { ...m, content: maskStreamTags(newRaw) };
              })
            );
          } else if (msg.type === 'citations') {
            setAllMessages((prev) =>
              prev.map((m) => (m.id === messageId ? { ...m, citations: msg.citations } : m))
            );
          } else if (msg.type === 'done') {
            setAllMessages((prev) =>
              prev.map((m) => {
                if (m.id === messageId) {
                  return {
                    ...m,
                    content: msg.answer || m.content,
                    citations: msg.citations || m.citations,
                    executionSteps: msg.executionSteps || m.executionSteps,
                    clarifyingQuestion: msg.clarifyingQuestion,
                    suggestedFollowUps: msg.suggestedFollowUps,
                    status: 'completed',
                    isStreaming: false,
                  };
                }
                return m;
              })
            );
            setIsStreaming(false);
            try {
              port.disconnect();
            } catch {}
            portRef.current = null;
          } else if (msg.type === 'error') {
            setAllMessages((prev) =>
              prev.map((m) =>
                m.id === messageId
                  ? {
                      ...m,
                      status: 'stopped',
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

        port.postMessage({
          type: 'START_ASK',
          clientId,
          conversationId: conversationId || undefined,
          resumeMessageId: messageId,
          channel: storedChannel,
        });
      } catch {
        setIsStreaming(false);
        setAllMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, status: 'stopped', isStreaming: false } : m))
        );
      }
    },
    [allMessages, conversationId, isStreaming, isStopping]
  );

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

        const formatFriendlyError = (rawErr: string, code?: string, details?: string) => {
          let title = '**Ask Saka Service Unavailable**';
          let body = 'We were unable to connect to the knowledge service to answer your question right now. Please try again in a few moments.';

          if (code === 'RATE_LIMIT_EXCEEDED') {
            title = '**Service High Demand**';
            body = 'Ask Saka is currently handling a surge in requests. Please click Retry below in a moment.';
          } else if (code === 'UPSTREAM_TIMEOUT') {
            title = '**Request Timed Out**';
            body = 'Knowledge synthesis took longer than expected to generate an answer. Click Retry below to regenerate.';
          } else if (code === 'INSUFFICIENT_QUOTA') {
            title = '**Service Quota Exceeded**';
            body = 'Knowledge service quota limit reached. Please contact your system administrator.';
          } else if (code === 'DUPLICATE_REQUEST') {
            title = '**Duplicate Query in Progress**';
            body = 'A matching query is currently being processed. Please wait a moment before sending.';
          }

          const techText = details || rawErr;
          return `${title}\n\n${body}\n\n<details><summary style="cursor:pointer;color:#94a3b8;font-size:11.5px;margin-top:6px;">Technical details</summary><pre style="font-size:11px;color:#cbd5e1;background:rgba(0,0,0,0.3);padding:6px;border-radius:4px;margin-top:4px;overflow-x:auto;">${techText}</pre></details>`;
        };

        port.onMessage.addListener((msg: AskStreamServerMessage) => {
          if (msg.type === 'status') {
            setStatusLog((prev) => {
              const line = `> ${msg.message}`;
              if (prev[prev.length - 1] === line) return prev;
              return [...prev, line];
            });

            const { label, detail } = msg;
            if (label && detail) {
              setAllMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantMsgId) return m;
                  const existing = m.executionSteps || [];
                  const filtered = existing.filter((s) => s.label !== label);
                  return {
                    ...m,
                    executionSteps: [...filtered, { label, detail }],
                  };
                })
              );
            }
          } else if (msg.type === 'token') {
            setAllMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMsgId) return m;
                const delta = msg.delta || msg.token || '';
                const newRaw = m.content + delta;
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
              if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get(['saka_remember_conversation_across_tabs'], (stored) => {
                  if (stored.saka_remember_conversation_across_tabs) {
                    chrome.storage.local.set({ saka_active_conversation_id: msg.conversationId }).catch(() => {});
                  }
                });
              }
            }
            if (msg.conversationTitle) {
              setConversationTitle(msg.conversationTitle);
            }
            setHistoryRefreshTrigger((prev) => prev + 1);

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
                    status: 'completed',
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
            } catch { }
            portRef.current = null;
          } else if (msg.type === 'error') {
            hasReceivedDone = true;
            const friendly = formatFriendlyError(msg.message, msg.code, msg.details);
            setAllMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                    ...m,
                    content: friendly,
                    status: 'failed',
                    isStreaming: false,
                    isError: true,
                    errorCode: msg.code || 'SERVICE_UNAVAILABLE',
                  }
                  : m
              )
            );
            setIsStreaming(false);
            try {
              port.disconnect();
            } catch { }
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
                      ? `${m.content}\n\n*(Response was interrupted due to a temporary connection issue. Click Retry below to regenerate.)*`
                      : `**Connection Interrupted**\n\nThe connection was closed before completing your response. Click Retry below to resubmit.\n\n<details><summary style="cursor:pointer;color:#94a3b8;font-size:11.5px;margin-top:6px;">Technical details</summary><pre style="font-size:11px;color:#cbd5e1;background:rgba(0,0,0,0.3);padding:6px;border-radius:4px;margin-top:4px;overflow-x:auto;">${rawMsg}</pre></details>`,
                    isStreaming: false,
                    isError: true,
                    errorCode: 'CONNECTION_INTERRUPTED',
                  }
                  : m
              )
            );
          }
          setIsStreaming(false);
          portRef.current = null;
        });

        const storedChannel = await new Promise<string>((resolve) => {
          try {
            chrome.storage.local.get(['saka_agent_channel'], (res) => {
              resolve(res?.saka_agent_channel || 'care_center');
            });
          } catch {
            resolve('care_center');
          }
        });

        port.postMessage({
          type: 'START_ASK',
          question: trimmed,
          conversationId: conversationId || undefined,
          clientId,
          parentId: !isRetry ? effectiveParentId : undefined,
          retryUserMessageId: isRetry ? userMsgId : undefined,
          channel: storedChannel,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setAllMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                ...m,
                content: `**Connection error**: ${msg}`,
                isStreaming: false,
                isError: true,
                errorCode: 'SERVICE_UNAVAILABLE',
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
    isStopping,
    isLoadingConversation,
    conversationLoadError,
    focusTrigger,
    isDeleted,
    isRestoring,
    historyRefreshTrigger,
    markConversationDeleted,
    restoreConversation,
    sendMessage,
    stopGeneration,
    resumeGeneration,
    startNewChat,
    loadConversation,
    switchBranch,
    getBranchInfo,
    retryResponse,
    editUserMessage,
  };
}
