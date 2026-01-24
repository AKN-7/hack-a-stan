"use client";

import { create } from "zustand";

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  createdAt: Date;
}

interface EditorContext {
  clipCount: number;
  totalDurationMs: number;
  wordCount: number;
  deletedCount: number;
  currentTimeMs: number;
  transcriptPreview: string;
  clipIds: string[];
}

interface IChatStore {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;

  // Actions
  addMessage: (message: Omit<ChatMessage, "id" | "createdAt">) => string;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  appendToolCall: (messageId: string, toolCall: ToolCall) => void;
  updateToolCallResult: (messageId: string, toolCallId: string, result: unknown, isError?: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearMessages: () => void;

  // Get editor context for API calls
  getEditorContext: () => EditorContext;
}

const generateId = () => Math.random().toString(36).substring(2, 11);

const useChatStore = create<IChatStore>((set, get) => ({
  messages: [],
  isLoading: false,
  error: null,

  addMessage: (message) => {
    const id = generateId();
    const newMessage: ChatMessage = {
      ...message,
      id,
      createdAt: new Date(),
    };

    set((state) => ({
      messages: [...state.messages, newMessage],
    }));

    return id;
  },

  updateMessage: (id, updates) => {
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id ? { ...msg, ...updates } : msg
      ),
    }));
  },

  appendToolCall: (messageId, toolCall) => {
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              toolCalls: [...(msg.toolCalls || []), toolCall],
            }
          : msg
      ),
    }));
  },

  updateToolCallResult: (messageId, toolCallId, result, isError = false) => {
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              toolCalls: msg.toolCalls?.map((tc) =>
                tc.id === toolCallId ? { ...tc, result, isError } : tc
              ),
            }
          : msg
      ),
    }));
  },

  setLoading: (loading) => {
    set({ isLoading: loading });
  },

  setError: (error) => {
    set({ error });
  },

  clearMessages: () => {
    set({ messages: [], error: null });
  },

  getEditorContext: () => {
    // Import dynamically to avoid circular dependencies
    // This will be called from the component where useTranscriptStore is available
    return {
      clipCount: 0,
      totalDurationMs: 0,
      wordCount: 0,
      deletedCount: 0,
      currentTimeMs: 0,
      transcriptPreview: "",
      clipIds: [],
    };
  },
}));

export default useChatStore;
