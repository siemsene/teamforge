// Client for the AI contract-feedback proxy (a Cloudflare Worker that holds the
// Anthropic API key — see worker/). The feature is available only when
// VITE_AI_PROXY_URL is configured AND the session enables AI feedback.
//
// Privacy note: the contract text sent here leaves the app's end-to-end
// encryption. The UI must obtain explicit consent and instruct teams not to
// include names.

import type { ContractFeedback } from "../types";

export function aiProxyUrl(): string | null {
  const url = import.meta.env.VITE_AI_PROXY_URL as string | undefined;
  return url && url.trim() ? url.trim().replace(/\/$/, "") : null;
}

export function aiFeedbackConfigured(): boolean {
  return aiProxyUrl() !== null;
}

export interface FeedbackRequestSection {
  id: string;
  title: string;
  text: string;
}

export async function requestContractFeedback(
  sections: FeedbackRequestSection[],
  teamSize?: number,
): Promise<ContractFeedback> {
  const base = aiProxyUrl();
  if (!base) throw new Error("AI feedback is not configured for this deployment.");

  const res = await fetch(`${base}/v1/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sections, teamSize }),
  });

  if (res.status === 429) {
    const retry = res.headers.get("retry-after");
    throw new Error(
      `The AI feedback service is busy${retry ? ` — try again in about ${retry}s` : ""}. Please try again shortly.`,
    );
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      /* ignore */
    }
    throw new Error(detail || `AI feedback request failed (${res.status}).`);
  }
  return (await res.json()) as ContractFeedback;
}
