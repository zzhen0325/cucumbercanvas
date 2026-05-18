"use client";

import { useCallback } from "react";

import { ApiApplicationError } from "@/lib/server-api";
import { useToast } from "@/components/toast";

export function useGenerationErrorHandler() {
  const { error: showErrorToast } = useToast();

  const handleGenerationError = useCallback(
    (error: unknown): boolean => {
      if (!(error instanceof ApiApplicationError)) {
        // Not an application error — log for debugging, show generic toast to user
        console.error("[generation-error] Unexpected error:", error);
        showErrorToast("生成失败，请重试。");
        return false;
      }

      // Other application errors: log raw message, show generic toast to user
      console.error("[generation-error] Application error:", error.code, error.message);
      showErrorToast("生成失败，请重试。");
      return false;
    },
    [showErrorToast],
  );

  return { handleGenerationError };
}
