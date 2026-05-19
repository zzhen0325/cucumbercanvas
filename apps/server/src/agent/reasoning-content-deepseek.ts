import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import type { ChatGeneration } from "@langchain/core/outputs";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import { ChatDeepSeek, type ChatDeepSeekInput } from "@langchain/deepseek";

import { convertMessagesToReasoningContentCompletionsParams } from "./reasoning-content-openai.js";

type ChatCompletionResponseLike = {
  choices?: Array<{
    finish_reason?: unknown;
    index?: number;
    logprobs?: unknown;
    message?: Record<string, unknown> & {
      content?: string | null;
      role?: string;
    };
  }>;
  usage?: ChatCompletionUsageLike;
};

type ChatCompletionChunkLike = {
  choices?: Array<{
    delta?: Record<string, unknown> & {
      content?: string;
      role?: string;
    };
    finish_reason?: unknown;
    index?: number;
    logprobs?: unknown;
  }>;
  model?: string;
  service_tier?: unknown;
  system_fingerprint?: string;
  usage?: ChatCompletionUsageLike;
};

type ChatCompletionUsageLike = {
  completion_tokens?: number;
  completion_tokens_details?: {
    audio_tokens?: number | null;
    reasoning_tokens?: number | null;
  };
  prompt_tokens?: number;
  prompt_tokens_details?: {
    audio_tokens?: number | null;
    cached_tokens?: number | null;
  };
  total_tokens?: number;
};

/**
 * Wrap ChatDeepSeek so that `reasoning_content` round-trips on assistant
 * history messages. DeepSeek's reasoning models require this field to be
 * passed back on subsequent tool-round requests.
 */
export function createReasoningContentChatDeepSeek(
  fields: ChatDeepSeekInput,
): ChatDeepSeek {
  return new ReasoningContentChatDeepSeek(fields);
}

class ReasoningContentChatDeepSeek extends ChatDeepSeek {
  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    options.signal?.throwIfAborted();
    const usageMetadata: Record<string, unknown> = {};
    const params = this.invocationParams(options) as Record<string, unknown>;
    const messagesMapped = convertMessagesToReasoningContentCompletionsParams({
      messages,
      model: this.model,
    });

    if (params.stream) {
      const stream = this._streamResponseChunks(messages, options, runManager);
      const finalChunks: Record<string, ChatGenerationChunk> = {};
      for await (const chunk of stream) {
        chunk.message.response_metadata = {
          ...chunk.generationInfo,
          ...chunk.message.response_metadata,
        };
        const index = chunk.generationInfo?.completion ?? 0;
        if (finalChunks[index] === undefined) {
          finalChunks[index] = chunk;
        } else {
          finalChunks[index] = finalChunks[index].concat(chunk);
        }
      }

      const generations = Object.entries(finalChunks)
        .sort(
          ([aKey], [bKey]) =>
            Number.parseInt(aKey, 10) - Number.parseInt(bKey, 10),
        )
        .map(([, value]) => value);
      const { functions, function_call } = this.invocationParams(options);
      const promptTokenUsage = await this._getEstimatedTokenCountFromPrompt(
        messages,
        functions,
        function_call,
      );
      const completionTokenUsage =
        await this._getNumTokensFromGenerations(generations);
      usageMetadata.input_tokens = promptTokenUsage;
      usageMetadata.output_tokens = completionTokenUsage;
      usageMetadata.total_tokens = promptTokenUsage + completionTokenUsage;
      return {
        generations,
        llmOutput: {
          estimatedTokenUsage: {
            completionTokens: usageMetadata.output_tokens,
            promptTokens: usageMetadata.input_tokens,
            totalTokens: usageMetadata.total_tokens,
          },
        },
      };
    }

    const data = (await this.completionWithRetry(
      {
        ...params,
        messages: messagesMapped,
        stream: false,
      } as never,
      {
        signal: options?.signal,
        ...options?.options,
      },
    )) as ChatCompletionResponseLike;

    const {
      completion_tokens: completionTokens,
      prompt_tokens: promptTokens,
      total_tokens: totalTokens,
      prompt_tokens_details: promptTokensDetails,
      completion_tokens_details: completionTokensDetails,
    } = data?.usage ?? {};

    if (completionTokens) usageMetadata.output_tokens = completionTokens;
    if (promptTokens) usageMetadata.input_tokens = promptTokens;
    if (totalTokens) usageMetadata.total_tokens = totalTokens;
    if (
      promptTokensDetails?.audio_tokens !== null ||
      promptTokensDetails?.cached_tokens !== null
    ) {
      usageMetadata.input_token_details = {
        ...(promptTokensDetails?.audio_tokens !== null
          ? { audio: promptTokensDetails?.audio_tokens }
          : {}),
        ...(promptTokensDetails?.cached_tokens !== null
          ? { cache_read: promptTokensDetails?.cached_tokens }
          : {}),
      };
    }
    if (
      completionTokensDetails?.audio_tokens !== null ||
      completionTokensDetails?.reasoning_tokens !== null
    ) {
      usageMetadata.output_token_details = {
        ...(completionTokensDetails?.audio_tokens !== null
          ? { audio: completionTokensDetails?.audio_tokens }
          : {}),
        ...(completionTokensDetails?.reasoning_tokens !== null
          ? { reasoning: completionTokensDetails?.reasoning_tokens }
          : {}),
      };
    }

    const generations: ChatGeneration[] = [];
    for (const part of data?.choices ?? []) {
      const generation = {
        generationInfo: {
          ...(part.finish_reason ? { finish_reason: part.finish_reason } : {}),
          ...(part.logprobs ? { logprobs: part.logprobs } : {}),
        },
        message: this._convertCompletionsMessageToBaseMessage(
          (part.message ?? { role: "assistant" }) as never,
          data as never,
        ),
        text: part.message?.content ?? "",
      };
      if (AIMessage.isInstance(generation.message)) {
        Object.assign(generation.message, { usage_metadata: usageMetadata });
      }
      generations.push(generation);
    }

    return {
      generations,
      llmOutput: {
        tokenUsage: {
          completionTokens: usageMetadata.output_tokens,
          promptTokens: usageMetadata.input_tokens,
          totalTokens: usageMetadata.total_tokens,
        },
      },
    };
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const messagesMapped = convertMessagesToReasoningContentCompletionsParams({
      messages,
      model: this.model,
    });
    const params = {
      ...this.invocationParams(options, { streaming: true }),
      messages: messagesMapped,
      stream: true,
    };
    let defaultRole: string | undefined;
    const streamIterable = (await this.completionWithRetry(
      params as never,
      options,
    )) as AsyncIterable<unknown>;
    let usage: ChatCompletionUsageLike | undefined;

    for await (const rawData of streamIterable) {
      const data = rawData as ChatCompletionChunkLike;
      if (options.signal?.aborted) return;
      const choice = data?.choices?.[0];
      if (data.usage) usage = data.usage;
      if (!choice) continue;
      const { delta } = choice;
      if (!delta) continue;

      const chunk = this._convertCompletionsDeltaToBaseMessageChunk(
        delta,
        data as never,
        defaultRole as never,
      );
      defaultRole = delta.role ?? defaultRole;
      const newTokenIndices = {
        completion: choice.index ?? 0,
        prompt: options.promptIndex ?? 0,
      };
      if (typeof chunk.content !== "string") {
        console.warn(
          "[model] Received non-string content from DeepSeek stream.",
        );
        continue;
      }
      const generationInfo: Record<string, unknown> = { ...newTokenIndices };
      if (choice.finish_reason != null) {
        generationInfo.finish_reason = choice.finish_reason;
        generationInfo.system_fingerprint = data.system_fingerprint;
        generationInfo.model_name = data.model;
        generationInfo.service_tier = data.service_tier;
      }
      if (this.logprobs) generationInfo.logprobs = choice.logprobs;

      const generationChunk = new ChatGenerationChunk({
        generationInfo,
        message: chunk,
        text: chunk.content,
      });
      yield generationChunk;
      await runManager?.handleLLMNewToken(
        generationChunk.text ?? "",
        newTokenIndices,
        undefined,
        undefined,
        undefined,
        { chunk: generationChunk },
      );
    }

    if (usage) {
      const inputTokenDetails = {
        ...(usage.prompt_tokens_details?.audio_tokens !== null
          ? { audio: usage.prompt_tokens_details?.audio_tokens }
          : {}),
        ...(usage.prompt_tokens_details?.cached_tokens !== null
          ? { cache_read: usage.prompt_tokens_details?.cached_tokens }
          : {}),
      };
      const outputTokenDetails = {
        ...(usage.completion_tokens_details?.audio_tokens !== null
          ? { audio: usage.completion_tokens_details?.audio_tokens }
          : {}),
        ...(usage.completion_tokens_details?.reasoning_tokens !== null
          ? { reasoning: usage.completion_tokens_details?.reasoning_tokens }
          : {}),
      };
      const usageChunk = new AIMessageChunk({
        content: "",
        response_metadata: { usage: { ...usage } },
      });
      Object.assign(usageChunk, {
        usage_metadata: {
          input_tokens: usage.prompt_tokens,
          output_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens,
          ...(Object.keys(inputTokenDetails).length > 0
            ? { input_token_details: inputTokenDetails }
            : {}),
          ...(Object.keys(outputTokenDetails).length > 0
            ? { output_token_details: outputTokenDetails }
            : {}),
        },
      });

      const generationChunk = new ChatGenerationChunk({
        message: usageChunk,
        text: "",
      });
      yield generationChunk;
      await runManager?.handleLLMNewToken(
        generationChunk.text ?? "",
        { completion: 0, prompt: 0 },
        undefined,
        undefined,
        undefined,
        { chunk: generationChunk },
      );
    }

    if (options.signal?.aborted) throw new Error("AbortError");
  }
}
