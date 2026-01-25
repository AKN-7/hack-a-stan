"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Send,
  Loader2,
  Sparkles,
  Scissors,
  RotateCcw,
  Wand2,
  ArrowUpDown,
  ArrowUp,
  Paperclip,
  FileText,
  Info,
  Type,
  Palette,
  Image,
  Video,
  Volume2,
  Layers,
  Search,
  X,
  Play,
  Clock,
  Trash2
} from "lucide-react";
import { MessageMarkdown } from "@/components/message-markdown";
import { ShimmeringText } from "@/components/ui/shimmering-text";
import useChatStore, { ChatMessage, ToolCall } from "@/features/chat/use-chat-store";
import useTranscriptStore, { MagicProcessingResult } from "@/features/editor/store/use-transcript-store";
import useStore from "@/features/editor/store/use-store";
import { useDownloadState } from "@/features/editor/store/use-download-state";
import StateManager from "@designcombo/state";
import { generateId } from "@designcombo/timeline";
import type { IDesign } from "@designcombo/types";
import { executeToolCall } from "@/features/chat/tool-executor";
import type Anthropic from "@anthropic-ai/sdk";
import { ChevronDown, ChevronUp, Check, Undo2, Film, Type as TypeIcon } from "lucide-react";

// Progress hints that rotate during AI analysis
const PROGRESS_HINTS = [
  "Finding filler words like 'um' and 'uh'...",
  "Detecting duplicate takes...",
  "Analyzing speech patterns...",
  "Looking for stammering and false starts...",
  "Optimizing clip order for narrative flow...",
  "Generating attention-grabbing hook...",
  "Calculating time savings...",
];

// Hook for rotating progress hints
function useRotatingHint(isActive: boolean, currentStatus: string) {
  const [hintIndex, setHintIndex] = useState(0);

  useEffect(() => {
    if (!isActive) {
      setHintIndex(0);
      return;
    }

    // If there's a real status from the store, use it
    if (currentStatus && currentStatus !== "Analyzing your clips...") {
      return;
    }

    // Rotate through hints every 2 seconds
    const interval = setInterval(() => {
      setHintIndex((prev) => (prev + 1) % PROGRESS_HINTS.length);
    }, 2000);

    return () => clearInterval(interval);
  }, [isActive, currentStatus]);

  // If there's a real status, use it; otherwise use rotating hint
  if (currentStatus && currentStatus !== "Analyzing your clips...") {
    return currentStatus;
  }

  return PROGRESS_HINTS[hintIndex];
}

// Format milliseconds to readable time
function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

// Quick action buttons
const QUICK_ACTIONS = [
  { label: "Polish my video", prompt: "Make my video professional: remove all filler words, apply a clean TikTok-style caption preset, and suggest where I should add B-roll" },
  { label: "Remove filler words", prompt: "Remove all the ums, uhs, and filler words" },
  { label: "Add captions", prompt: "Apply the tiktok-bold caption style to my video" },
  { label: "Add B-roll", prompt: "Suggest B-roll moments for my video and generate images for the top 2 suggestions" },
  { label: "Find key moments", prompt: "Find the most important moments for social clips" },
  { label: "Show transcript", prompt: "Show me the full transcript" },
  { label: "Project status", prompt: "What's the status of my project?" },
  { label: "Undo changes", prompt: "Undo my last edit" },
];

export function Chat() {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const quickActionsRef = useRef<HTMLDivElement>(null);

  const { messages, isLoading, addMessage, updateMessage, appendToolCall, updateToolCallResult, setLoading, setError, clearMessages } =
    useChatStore();
  const transcriptStore = useTranscriptStore();
  const editorStore = useStore();

  // Get magic processing result for display
  const { magicProcessingResult, clearMagicProcessingResult, isProcessing, processingStatus, processingStartTime, processingStep } = useTranscriptStore();

  // Get rotating hint during processing
  const displayStatus = useRotatingHint(isProcessing, processingStatus);

  // Track elapsed time during processing
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!isProcessing || !processingStartTime) {
      setElapsedSeconds(0);
      return;
    }

    // Update every 100ms for smooth counter
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - processingStartTime) / 1000));
    }, 100);

    return () => clearInterval(interval);
  }, [isProcessing, processingStartTime]);

  // Scroll to bottom when messages change or magic processing completes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, magicProcessingResult]);

  // Auto-scroll quick actions carousel - smooth continuous scroll
  useEffect(() => {
    if (messages.length > 0 || !quickActionsRef.current) return;

    let animationFrameId: number | null = null;
    let timeoutId: NodeJS.Timeout;

    // Small delay to ensure DOM is ready
    timeoutId = setTimeout(() => {
      const container = quickActionsRef.current;
      if (!container) return;

      const scrollWidth = container.scrollWidth;
      const clientWidth = container.clientWidth;
      const maxScroll = scrollWidth - clientWidth;

      if (maxScroll <= 0) return; // No scrolling needed

      let currentScroll = 0;
      let scrollDirection = 1; // 1 for right, -1 for left

      const scroll = () => {
        const currentMaxScroll = container.scrollWidth - container.clientWidth;
        if (currentMaxScroll <= 0) {
          animationFrameId = null;
          return;
        }

        // Smooth continuous scroll - 0.3px per frame (~18px per second at 60fps)
        const scrollSpeed = 0.3;

        if (scrollDirection === 1) {
          currentScroll += scrollSpeed;
          if (currentScroll >= currentMaxScroll) {
            currentScroll = currentMaxScroll;
            scrollDirection = -1; // Reverse direction
          }
        } else {
          currentScroll -= scrollSpeed;
          if (currentScroll <= 0) {
            currentScroll = 0;
            scrollDirection = 1; // Reverse direction
          }
        }

        container.scrollLeft = currentScroll;
        animationFrameId = requestAnimationFrame(scroll);
      };

      animationFrameId = requestAnimationFrame(scroll);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [messages.length]);

  // Get current editor context
  const getEditorContext = useCallback(() => {
    const allWords = transcriptStore.getUnifiedTranscript();
    const activeWords = transcriptStore.getActiveWords();
    const totalDurationMs = transcriptStore.getTotalDurationMs();

    // Build per-clip context
    const clips = transcriptStore.clipOrder.map((clipId, index) => {
      const clip = transcriptStore.clips[clipId];
      if (!clip) return null;

      const clipActiveWords = clip.words.filter((w) => !w.isDeleted);
      const clipDeletedWords = clip.words.filter((w) => w.isDeleted);

      return {
        id: clipId,
        index: index + 1, // 1-indexed for natural language ("clip 1", "first clip")
        status: clip.status,
        wordCount: clip.words.length,
        activeWordCount: clipActiveWords.length,
        deletedWordCount: clipDeletedWords.length,
        // Preview: first 50 words or 200 chars, whichever is shorter
        transcriptPreview: clipActiveWords
          .slice(0, 50)
          .map((w) => w.text)
          .join(" ")
          .substring(0, 200),
      };
    }).filter(Boolean);

    // Build overlay elements context (text, images, etc.)
    const overlayElements = Object.entries(editorStore.trackItemsMap)
      .filter(([_, item]) => item.type !== "video" && item.type !== "caption")
      .map(([id, item]) => ({
        id,
        type: item.type,
        startMs: item.display?.from || 0,
        endMs: item.display?.to || 0,
        // Include relevant details based on type
        ...(item.type === "text" && item.details?.text
          ? { text: String(item.details.text).substring(0, 50) }
          : {}),
        ...(item.type === "image" && item.details?.src
          ? { src: "image" }
          : {}),
      }));

    return {
      clipCount: Object.keys(transcriptStore.clips).length,
      totalDurationMs,
      wordCount: allWords.length,
      deletedCount: allWords.filter((w) => w.isDeleted).length,
      currentTimeMs: 0, // Could get from player
      transcriptPreview: activeWords
        .slice(0, 100)
        .map((w) => w.text)
        .join(" ")
        .substring(0, 500),
      clipIds: transcriptStore.clipOrder,
      clips, // Per-clip details
      overlayElements, // Text, images, etc. on the timeline
    };
  }, [transcriptStore, editorStore.trackItemsMap]);

  // Process Claude response and execute tools
  const processResponse = useCallback(
    async (
      response: Anthropic.Message,
      messageId: string,
      conversationMessages: Anthropic.MessageParam[]
    ) => {
      let textContent = "";
      const newToolCalls: ToolCall[] = [];

      // Extract text and tool calls from response
      for (const block of response.content) {
        if (block.type === "text") {
          textContent += block.text;
        } else if (block.type === "tool_use") {
          newToolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          });
        }
      }

      // Update message text content
      if (textContent) {
        updateMessage(messageId, { content: textContent });
      }

      // Append new tool calls (don't replace existing ones)
      for (const toolCall of newToolCalls) {
        appendToolCall(messageId, toolCall);
      }

      // If there are tool calls, execute them and continue
      if (newToolCalls.length > 0 && response.stop_reason === "tool_use") {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const tool of newToolCalls) {
          try {
            const result = await executeToolCall(tool.name, tool.input);

            // Update this specific tool call with its result
            updateToolCallResult(messageId, tool.id, result.result, !result.success);

            toolResults.push({
              type: "tool_result",
              tool_use_id: tool.id,
              content: JSON.stringify(result.result),
              is_error: !result.success,
            });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Tool execution failed";
            updateToolCallResult(messageId, tool.id, { error: errorMessage }, true);
            toolResults.push({
              type: "tool_result",
              tool_use_id: tool.id,
              content: errorMessage,
              is_error: true,
            });
          }
        }

        // Continue conversation with tool results
        const continueResponse = await fetch("/api/chat", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [
              ...conversationMessages,
              { role: "assistant", content: response.content },
            ],
            editorContext: getEditorContext(),
            toolResults,
          }),
        });

        if (continueResponse.ok) {
          const continueData = (await continueResponse.json()) as Anthropic.Message;

          // Extract final text response (append, don't replace)
          let finalText = "";
          for (const block of continueData.content) {
            if (block.type === "text") {
              finalText += block.text;
            }
          }

          if (finalText) {
            // Get existing content and append new text
            const existingMessage = messages.find(m => m.id === messageId);
            const existingContent = existingMessage?.content || "";
            const newContent = existingContent ? `${existingContent}\n\n${finalText}` : finalText;
            updateMessage(messageId, { content: newContent });
          }

          // If there are more tool calls, recursively process
          if (continueData.stop_reason === "tool_use") {
            await processResponse(continueData, messageId, [
              ...conversationMessages,
              { role: "assistant", content: response.content },
              { role: "user", content: toolResults },
            ]);
          }
        }
      }
    },
    [updateMessage, appendToolCall, updateToolCallResult, getEditorContext]
  );

  // Send message to Claude
  const sendMessage = useCallback(async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput || isLoading) return;

    setInput("");
    setLoading(true);
    setError(null);

    // Add user message
    addMessage({ role: "user", content: trimmedInput });

    // Prepare conversation history
    const conversationMessages: Anthropic.MessageParam[] = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
    conversationMessages.push({ role: "user", content: trimmedInput });

    // Add placeholder assistant message
    const assistantMessageId = addMessage({ role: "assistant", content: "" });

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: conversationMessages,
          editorContext: getEditorContext(),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to get response");
      }

      const data = (await response.json()) as Anthropic.Message;
      await processResponse(data, assistantMessageId, conversationMessages);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Something went wrong";
      updateMessage(assistantMessageId, {
        content: `Error: ${errorMessage}`,
      });
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [
    input,
    isLoading,
    messages,
    addMessage,
    updateMessage,
    setLoading,
    setError,
    getEditorContext,
    processResponse,
  ]);

  // Handle quick action - auto-send for faster workflow
  const handleQuickAction = useCallback(
    async (prompt: string) => {
      if (isLoading) return;

      setLoading(true);
      setError(null);

      // Add user message
      addMessage({ role: "user", content: prompt });

      // Prepare conversation history
      const conversationMessages: Anthropic.MessageParam[] = messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));
      conversationMessages.push({ role: "user", content: prompt });

      // Add placeholder assistant message
      const assistantMessageId = addMessage({ role: "assistant", content: "" });

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: conversationMessages,
            editorContext: getEditorContext(),
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to get response");
        }

        const data = (await response.json()) as Anthropic.Message;
        await processResponse(data, assistantMessageId, conversationMessages);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Something went wrong";
        updateMessage(assistantMessageId, {
          content: `Error: ${errorMessage}`,
        });
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    },
    [isLoading, messages, addMessage, updateMessage, setLoading, setError, getEditorContext, processResponse]
  );

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!input.trim() || isLoading) return;
        sendMessage();
      }
    },
    [input, isLoading, sendMessage]
  );

  // Handle form submission
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || isLoading) return;
      sendMessage();
    },
    [input, isLoading, sendMessage]
  );

  // Auto-grow textarea
  useEffect(() => {
    if (textareaRef.current) {
      const minHeight = 24; // 1.5rem in pixels
      textareaRef.current.style.height = "auto";
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.max(scrollHeight, minHeight)}px`;
    }
  }, [input]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0 w-full">
        <div className="flex flex-col min-h-full w-full px-3 md:px-4">
          <div className="flex-1" />
          <div className="space-y-3 md:space-y-4 py-3 md:py-4 w-full">
            {/* Empty state */}
            {messages.length === 0 && !magicProcessingResult && !isProcessing && (
              <div className="text-center text-sm text-muted-foreground py-6 md:py-8">
                <Sparkles className="h-7 w-7 md:h-8 md:w-8 mx-auto mb-2 md:mb-3 text-primary/50" />
                <p className="font-medium mb-1 text-sm md:text-base">AI Video Editor</p>
                <p className="text-xs">
                  Ask me to edit your video, remove filler words, or generate B-roll.
                </p>
              </div>
            )}

            {/* Magic processing in progress */}
            {isProcessing && (
              <div className="w-full rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-purple-500/5 p-4">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Loader2 className="h-4 w-4 text-primary animate-spin" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-sm font-semibold text-foreground">Magic Processing...</div>
                      <div className="text-xs font-medium text-primary tabular-nums">
                        {elapsedSeconds}s
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground truncate transition-all duration-300">
                      {displayStatus}
                    </div>
                  </div>
                </div>

                {/* Progress steps indicator */}
                <div className="mt-3 flex items-center gap-1">
                  {[1, 2, 3].map((step) => (
                    <div key={step} className="flex-1 flex items-center gap-1">
                      <div
                        className={cn(
                          "h-1.5 flex-1 rounded-full transition-all duration-300",
                          processingStep >= step
                            ? "bg-primary"
                            : "bg-primary/20"
                        )}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
                  <span className={cn(processingStep >= 1 && "text-primary font-medium")}>Filler words</span>
                  <span className={cn(processingStep >= 2 && "text-primary font-medium")}>AI analysis</span>
                  <span className={cn(processingStep >= 3 && "text-primary font-medium")}>Pacing</span>
                </div>
              </div>
            )}

            {/* Magic processing result */}
            {magicProcessingResult && !isProcessing && (
              <MagicProcessingSummary
                result={magicProcessingResult}
                onDismiss={clearMagicProcessingResult}
              />
            )}

            {/* Chat messages */}
            {messages.length > 0 && (
              messages
                .filter((msg) => msg.role === "user" || msg.content || msg.toolCalls?.length)
                .map((message) => (
                  <MessageBubble key={message.id} message={message} isLoading={isLoading} />
                ))
            )}

            {/* Chat loading state */}
            {isLoading && !messages.some((m) => m.role === "assistant" && (m.content || m.toolCalls?.length)) && (
              <ShimmeringText
                text="Thinking..."
                className="text-sm text-muted-foreground"
                duration={1.5}
                color="rgb(107 114 128)"
                shimmerColor="var(--primary)"
                spread={3}
              />
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </ScrollArea>

      {/* Quick Actions */}
      {messages.length === 0 && (
        <div className="shrink-0 px-3 md:px-4 pb-2 overflow-hidden">
          <div
            ref={quickActionsRef}
            className="flex gap-1.5 md:gap-2 overflow-x-auto scrollbar-hide"
          >
            {QUICK_ACTIONS.map((action) => (
              <Button
                key={action.label}
                variant="outline"
                size="sm"
                className="text-xs h-8 md:h-7 shrink-0 whitespace-nowrap px-2.5 md:px-3"
                onClick={() => handleQuickAction(action.prompt)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 border-t border-border/50 p-3 md:p-4 w-full min-w-0">
        <form onSubmit={handleSubmit} className="w-full min-w-0">
          <div className="flex flex-col gap-1 rounded-2xl border bg-background px-3 py-2 shadow-sm w-full min-w-0">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Remove filler words, add a title..."
              disabled={isLoading}
              className="max-h-32 w-full min-w-0 resize-none border-0 bg-transparent px-0 py-1 text-sm outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50 overflow-y-auto"
              rows={1}
              style={{ minHeight: '1.5rem', fontSize: '16px' }}
            />
            <div className="flex items-center justify-between -mx-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="inline-flex h-9 w-9 md:h-8 md:w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground"
                  aria-label="Attach file"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={clearMessages}
                    className="inline-flex h-9 w-9 md:h-8 md:w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-opacity hover:bg-red-50 hover:text-red-500"
                    aria-label="Clear conversation"
                    title="Clear conversation"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="inline-flex h-9 w-9 md:h-8 md:w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs transition-opacity disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                aria-label="Send message"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// Message bubble component
function MessageBubble({ message, isLoading }: { message: ChatMessage; isLoading?: boolean }) {
  const isUser = message.role === "user";

  // Don't render empty assistant messages
  if (!isUser && !message.content && !message.toolCalls?.length) {
    return null;
  }

  return (
    <div className={cn("flex w-full flex-col gap-2", isUser ? "items-end" : "items-start")}>
      {/* Tool calls - use collapsed view for multiple tools */}
      {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
        <div className="w-full">
          {message.toolCalls.length > 1 ? (
            <CollapsedToolCalls toolCalls={message.toolCalls} />
          ) : (
            <ToolCallCard toolCall={message.toolCalls[0]} />
          )}
        </div>
      )}

      {/* Message content */}
      {message.content && (
        <div
          className={cn(
            "max-w-[90%] rounded-lg px-3 py-2 text-sm",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground"
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <MessageMarkdown content={message.content} />
          )}
        </div>
      )}
    </div>
  );
}

// Tool metadata with icons, categories, and progress messages
const TOOL_META: Record<string, { name: string; icon: React.ElementType; category: string; color: string; progressMessage?: string }> = {
  // Transcript tools
  delete_words: { name: "Delete Words", icon: Scissors, category: "Edit", color: "text-red-500", progressMessage: "Finding and removing words..." },
  restore_words: { name: "Restore Words", icon: RotateCcw, category: "Edit", color: "text-green-500", progressMessage: "Restoring deleted words..." },
  edit_text: { name: "Edit Text", icon: Type, category: "Edit", color: "text-blue-500", progressMessage: "Updating transcript text..." },
  smart_cuts: { name: "Smart Cuts", icon: Wand2, category: "Edit", color: "text-purple-500", progressMessage: "Analyzing speech patterns..." },
  reorder_clips: { name: "Reorder Clips", icon: ArrowUpDown, category: "Edit", color: "text-blue-500", progressMessage: "Rearranging your clips..." },
  trim_clip: { name: "Trim Clip", icon: Scissors, category: "Edit", color: "text-orange-500", progressMessage: "Adjusting clip boundaries..." },
  get_transcript: { name: "Get Transcript", icon: FileText, category: "Info", color: "text-slate-500", progressMessage: "Loading transcript..." },
  get_project_status: { name: "Project Status", icon: Info, category: "Info", color: "text-slate-500", progressMessage: "Checking project status..." },
  undo: { name: "Undo", icon: RotateCcw, category: "Edit", color: "text-slate-500", progressMessage: "Reverting last change..." },
  redo: { name: "Redo", icon: RotateCcw, category: "Edit", color: "text-slate-500", progressMessage: "Reapplying change..." },
  // Navigation tools
  seek_to: { name: "Seek To", icon: Play, category: "Navigate", color: "text-blue-500", progressMessage: "Jumping to position..." },
  set_playback_rate: { name: "Playback Rate", icon: Clock, category: "Navigate", color: "text-blue-500", progressMessage: "Adjusting playback speed..." },
  // Text overlay tools
  add_text_overlay: { name: "Add Text", icon: Type, category: "Text", color: "text-indigo-500", progressMessage: "Creating text overlay..." },
  edit_text_overlay: { name: "Edit Text", icon: Type, category: "Text", color: "text-indigo-500", progressMessage: "Updating text overlay..." },
  remove_element: { name: "Remove Element", icon: X, category: "Edit", color: "text-red-500", progressMessage: "Removing element..." },
  // Caption tools
  apply_caption_preset: { name: "Caption Preset", icon: Palette, category: "Style", color: "text-pink-500", progressMessage: "Applying caption style..." },
  customize_caption_style: { name: "Caption Style", icon: Palette, category: "Style", color: "text-pink-500", progressMessage: "Customizing captions..." },
  highlight_keywords: { name: "Highlight Words", icon: Type, category: "Style", color: "text-yellow-500", progressMessage: "Highlighting keywords..." },
  // Generation tools
  generate_broll_image: { name: "Generate Image", icon: Image, category: "Generate", color: "text-emerald-500", progressMessage: "Creating B-roll image with AI..." },
  generate_video_clip: { name: "Generate Video", icon: Video, category: "Generate", color: "text-emerald-500", progressMessage: "Generating video clip..." },
  extend_video: { name: "Extend Video", icon: Video, category: "Generate", color: "text-emerald-500", progressMessage: "Extending video with AI..." },
  video_to_video: { name: "Transform Video", icon: Video, category: "Generate", color: "text-emerald-500", progressMessage: "Transforming video..." },
  // Audio tools
  add_audio_visualization: { name: "Audio Viz", icon: Volume2, category: "Audio", color: "text-cyan-500", progressMessage: "Adding audio visualization..." },
  adjust_audio: { name: "Adjust Audio", icon: Volume2, category: "Audio", color: "text-cyan-500", progressMessage: "Adjusting audio levels..." },
  // Effects tools
  apply_transition: { name: "Transition", icon: Layers, category: "Effects", color: "text-violet-500", progressMessage: "Adding transition effect..." },
  apply_video_filter: { name: "Filter", icon: Palette, category: "Effects", color: "text-violet-500", progressMessage: "Applying video filter..." },
  add_shape: { name: "Add Shape", icon: Layers, category: "Effects", color: "text-violet-500", progressMessage: "Adding shape element..." },
  // Analysis tools
  analyze_transcript: { name: "Analyze", icon: Search, category: "Analyze", color: "text-amber-500", progressMessage: "Analyzing your content..." },
  suggest_broll_moments: { name: "B-Roll Suggest", icon: Search, category: "Analyze", color: "text-amber-500", progressMessage: "Finding B-roll opportunities..." },
  find_key_moments: { name: "Key Moments", icon: Search, category: "Analyze", color: "text-amber-500", progressMessage: "Identifying key moments..." },
  // Auto enhance tools
  smooth_jump_cuts: { name: "Smooth Cuts", icon: Wand2, category: "Effects", color: "text-purple-500", progressMessage: "Smoothing jump cuts..." },
  auto_enhance: { name: "Auto Enhance", icon: Sparkles, category: "Edit", color: "text-amber-500", progressMessage: "Auto-enhancing your video..." },
};

// Collapsed tool calls display - Grok-style compact view
function CollapsedToolCalls({ toolCalls }: { toolCalls: ToolCall[] }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (toolCalls.length === 0) return null;

  const completedCount = toolCalls.filter(t => t.result !== undefined).length;
  const isAllDone = completedCount === toolCalls.length;
  const hasError = toolCalls.some(t => t.isError);
  const currentTool = toolCalls.find(t => t.result === undefined) || toolCalls[toolCalls.length - 1];
  const currentMeta = TOOL_META[currentTool.name] || { name: currentTool.name, icon: Wand2, progressMessage: "Processing..." };
  const CurrentIcon = currentMeta.icon;

  return (
    <div
      className={cn(
        "w-full rounded-lg border overflow-hidden transition-all duration-300",
        hasError
          ? "border-red-200 bg-red-50"
          : isAllDone
          ? "border-green-200 bg-green-50/50"
          : "border-primary/20 bg-primary/5"
      )}
    >
      {/* Collapsed header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-black/5 transition-colors"
      >
        {/* Status icon */}
        {!isAllDone ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
        ) : hasError ? (
          <X className="h-3.5 w-3.5 text-red-500 shrink-0" />
        ) : (
          <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />
        )}

        {/* Current action / summary */}
        <div className="flex-1 min-w-0 text-left">
          <span className="text-xs text-muted-foreground">
            {!isAllDone ? (
              <>
                <span className="font-medium text-foreground">{currentMeta.name}</span>
                {" · "}{currentMeta.progressMessage}
              </>
            ) : (
              <span className="text-green-700">
                {toolCalls.length} action{toolCalls.length > 1 ? "s" : ""} completed
              </span>
            )}
          </span>
        </div>

        {/* Expand indicator */}
        <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
          <span className="text-[10px]">{completedCount}/{toolCalls.length}</span>
          {isExpanded ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </div>
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="border-t border-black/5 px-3 py-2 space-y-1.5">
          {toolCalls.map((tool) => {
            const meta = TOOL_META[tool.name] || { name: tool.name, icon: Wand2 };
            const Icon = meta.icon;
            const hasResult = tool.result !== undefined;
            return (
              <div key={tool.id} className="flex items-center gap-2 text-xs">
                {!hasResult ? (
                  <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
                ) : tool.isError ? (
                  <X className="h-3 w-3 text-red-500 shrink-0" />
                ) : (
                  <Check className="h-3 w-3 text-green-600 shrink-0" />
                )}
                <span className={cn(
                  "truncate",
                  hasResult && !tool.isError && "text-muted-foreground"
                )}>
                  {meta.name}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Animated count-up hook for time saved
function useCountUp(end: number, duration: number = 1000) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let startTime: number;
    let animationFrame: number;

    const animate = (currentTime: number) => {
      if (!startTime) startTime = currentTime;
      const progress = Math.min((currentTime - startTime) / duration, 1);

      // Easing function for satisfying feel
      const easeOut = 1 - Math.pow(1 - progress, 3);
      setCount(easeOut * end);

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [end, duration]);

  return count;
}

// Magic Processing Summary - shows results of auto-magic processing
function MagicProcessingSummary({ result, onDismiss }: { result: MagicProcessingResult; onDismiss?: () => void }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { restoreClip, restoreAllWords, clips, resetMagicProcessing, clearMagicProcessingResult } = useTranscriptStore();
  const { actions } = useDownloadState();
  const editorStore = useStore();

  const hasChanges = result.fillerCount > 0 || result.aiCutsCount > 0 || result.clipsRemoved > 0 || result.textHook;

  if (!hasChanges) return null;

  const timeSavedSec = result.timeSavedMs / 1000;
  const animatedTime = useCountUp(timeSavedSec, 1200);
  const totalCuts = result.fillerCount + result.aiCutsCount;

  // Handle export button click
  const handleExport = () => {
    const stateManager = (window as any).__stateManager;
    if (stateManager) {
      const data: IDesign = {
        id: generateId(),
        ...stateManager.toJSON()
      };
      actions.setState({ payload: data });
      actions.startExport();
    }
  };

  // Handle undo all - reverses everything magic did
  const handleUndoAll = () => {
    // Restore all deleted words
    restoreAllWords();
    // Restore all removed clips
    if (result.removedClipIds) {
      result.removedClipIds.forEach(clipId => restoreClip(clipId));
    }
    // Clear the text hook and emphasis points
    resetMagicProcessing();
    // Clear the result card
    clearMagicProcessingResult();
  };

  return (
    <div className="w-full rounded-2xl border-2 border-green-200 bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 overflow-hidden shadow-lg shadow-green-100/50">
      {/* Hero Section - Time Saved */}
      <div className="px-4 pt-5 pb-4 text-center">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-100 text-green-700 text-xs font-medium mb-3">
          <Sparkles className="h-3.5 w-3.5" />
          Magic Complete
        </div>

        {/* Big Time Saved Number */}
        <div className="mb-1">
          <span className="text-5xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
            {animatedTime.toFixed(1)}s
          </span>
        </div>
        <div className="text-sm text-green-700 font-medium mb-4">
          saved from your video
        </div>

        {/* Stats Row */}
        <div className="flex justify-center gap-4 mb-4">
          {totalCuts > 0 && (
            <div className="text-center">
              <div className="text-lg font-bold text-foreground">{totalCuts}</div>
              <div className="text-xs text-muted-foreground">words cut</div>
            </div>
          )}
          {result.clipsRemoved > 0 && (
            <div className="text-center">
              <div className="text-lg font-bold text-foreground">{result.clipsRemoved}</div>
              <div className="text-xs text-muted-foreground">bad takes</div>
            </div>
          )}
          {result.textHook && (
            <div className="text-center">
              <div className="text-lg font-bold text-foreground">1</div>
              <div className="text-xs text-muted-foreground">hook added</div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 justify-center">
          <Button
            onClick={handleExport}
            className="bg-green-600 hover:bg-green-700 text-white shadow-md shadow-green-200"
          >
            <Play className="h-4 w-4 mr-1.5 fill-current" />
            Export Video
          </Button>
          <Button
            variant="outline"
            onClick={handleUndoAll}
            className="border-green-200 text-green-700 hover:bg-green-50"
          >
            <RotateCcw className="h-4 w-4 mr-1.5" />
            Undo All
          </Button>
        </div>
      </div>

      {/* Expandable Details */}
      <div className="border-t border-green-200">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full px-4 py-2.5 flex items-center justify-center gap-2 hover:bg-green-50/50 transition-colors text-sm text-green-700"
        >
          <span>{isExpanded ? "Hide" : "Show"} details</span>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-green-100 bg-white/50">
          {/* Clips removed */}
          {result.clipsRemoved > 0 && result.removedClipIds && (
            <div className="space-y-1.5 pt-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-red-600">
                <Film className="h-3.5 w-3.5" />
                <span>{result.clipsRemoved} clip{result.clipsRemoved > 1 ? "s" : ""} removed</span>
              </div>
              <div className="pl-5 space-y-1">
                {result.removedClipIds.map((clipId) => {
                  const clip = clips[clipId];
                  const isDeleted = clip?.isDeleted;
                  return (
                    <div key={clipId} className="flex items-center justify-between text-xs">
                      <span className={cn(
                        "truncate",
                        isDeleted ? "text-muted-foreground" : "text-green-600 line-through"
                      )}>
                        {clip?.deleteReason || "Duplicate take"}
                      </span>
                      {isDeleted ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            restoreClip(clipId);
                          }}
                          className="flex items-center gap-1 text-primary hover:underline shrink-0 ml-2"
                        >
                          <Undo2 className="h-3 w-3" />
                          Restore
                        </button>
                      ) : (
                        <span className="flex items-center gap-1 text-green-600 shrink-0 ml-2">
                          <Check className="h-3 w-3" />
                          Restored
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Words cut */}
          {(result.fillerCount > 0 || result.aiCutsCount > 0) && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-orange-600">
                <Scissors className="h-3.5 w-3.5" />
                <span>{result.fillerCount + result.aiCutsCount} words removed</span>
              </div>
              <div className="pl-5 text-xs text-muted-foreground">
                {result.fillerCount > 0 && <div>{result.fillerCount} filler words (um, uh, like...)</div>}
                {result.wordCuts && result.wordCuts.length > 0 && (
                  <div className="space-y-0.5 mt-1">
                    {result.wordCuts.slice(0, 3).map((cut, i) => (
                      <div key={i} className="truncate">
                        "{cut.text}" - {cut.reason}
                      </div>
                    ))}
                    {result.wordCuts.length > 3 && (
                      <div className="text-muted-foreground/70">
                        +{result.wordCuts.length - 3} more...
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Text hook */}
          {result.textHook && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-600">
                <TypeIcon className="h-3.5 w-3.5" />
                <span>Text hook added</span>
              </div>
              <div className="pl-5">
                <div className="text-xs bg-indigo-50 text-indigo-800 px-2 py-1.5 rounded font-medium">
                  "{result.textHook}"
                </div>
              </div>
            </div>
          )}

          {/* AI reasoning */}
          {result.reasoning && (
            <div className="text-[11px] text-muted-foreground/80 italic pt-1 border-t border-black/5">
              {result.reasoning}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Tool call card component (for single tool calls or when not using collapsed view)
function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const meta = TOOL_META[toolCall.name] || {
    name: toolCall.name,
    icon: Wand2,
    category: "Tool",
    color: "text-slate-500",
    progressMessage: "Processing..."
  };
  const Icon = meta.icon;
  const hasResult = toolCall.result !== undefined;
  const isError = toolCall.isError;

  // Get a summary of the result (max 50 chars)
  const getResultSummary = () => {
    if (!hasResult) return null;
    const result = toolCall.result as Record<string, unknown>;
    let summary = "";
    if (result.message) summary = result.message as string;
    else if (result.deletedCount !== undefined) {
      const timeSaved = result.timeSavedMs ? ` (saved ${((result.timeSavedMs as number) / 1000).toFixed(1)}s)` : "";
      summary = `${result.deletedCount} words deleted${timeSaved}`;
    }
    else if (result.removedCount !== undefined) {
      const timeSaved = result.timeSavedMs ? ` (saved ${((result.timeSavedMs as number) / 1000).toFixed(1)}s)` : "";
      summary = `${result.removedCount} filler words removed${timeSaved}`;
    }
    else if (result.restoredCount !== undefined) summary = `${result.restoredCount} words restored`;
    else if (result.editedCount !== undefined) summary = `${result.editedCount} words edited`;
    else if (result.imageUrl) summary = "Image generated successfully";
    else if (result.success === false) summary = result.error as string || "Failed";
    else summary = "Done";

    // Truncate to 60 chars
    return summary.length > 60 ? summary.substring(0, 57) + "..." : summary;
  };

  return (
    <div
      className={cn(
        "w-full max-w-full rounded-lg border px-3 py-2 overflow-hidden transition-all duration-300",
        isError
          ? "border-red-200 bg-red-50"
          : hasResult
          ? "border-green-200 bg-green-50"
          : "border-primary/20 bg-primary/5"
      )}
    >
      <div className="flex items-center gap-2 overflow-hidden">
        {/* Tool icon with loading state */}
        {!hasResult ? (
          <div className="relative shrink-0">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          </div>
        ) : (
          <Icon className={cn("h-4 w-4 shrink-0", isError ? "text-red-500" : "text-green-600")} />
        )}

        {/* Tool info */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium truncate">{meta.name}</span>
            {!hasResult && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                Running
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground truncate">
            {hasResult ? getResultSummary() : (meta.progressMessage || "Processing...")}
          </p>
        </div>
      </div>
    </div>
  );
}

export default Chat;
