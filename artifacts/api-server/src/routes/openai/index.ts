import { Router, type IRouter } from "express";
import {
  GenerateOpenaiBotStrategyBody,
  type OpenaiError,
} from "@workspace/api-zod";
import { generateBotStrategy } from "./strategy-generator";
import { StrategyValidationError } from "./strategy-intent";

const router: IRouter = Router();
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 4;
const requestsByClient = new Map<string, { count: number; resetAt: number }>();
let requestsSinceCleanup = 0;

function isRateLimited(clientKey: string, now = Date.now()): boolean {
  const current = requestsByClient.get(clientKey);
  if (!current || current.resetAt <= now) {
    requestsByClient.set(clientKey, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    requestsSinceCleanup += 1;
  } else if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  } else {
    current.count += 1;
    requestsSinceCleanup += 1;
  }

  if (requestsSinceCleanup >= 128) {
    for (const [key, entry] of requestsByClient) {
      if (entry.resetAt <= now) requestsByClient.delete(key);
    }
    requestsSinceCleanup = 0;
  }

  return false;
}

function sendError(res: Parameters<Parameters<typeof router.post>[1]>[1], status: number, error: string): void {
  const payload: OpenaiError = { error };
  res.status(status).json(payload);
}

router.post("/openai/bot-builder/generate", async (req, res): Promise<void> => {
  const parsed = GenerateOpenaiBotStrategyBody.safeParse(req.body);
  const prompt = parsed.success ? parsed.data.prompt.trim() : "";

  if (!parsed.success || prompt.length < 12) {
    req.log.warn(
      { issueCount: parsed.success ? 1 : parsed.error.issues.length },
      "Rejected invalid AI bot builder prompt",
    );
    sendError(res, 400, "Describe the strategy in at least 12 characters.");
    return;
  }

  if (isRateLimited(req.ip || req.socket.remoteAddress || "unknown")) {
    sendError(res, 429, "Too many generations. Please wait a few minutes and try again.");
    return;
  }

  try {
    const strategy = await generateBotStrategy(
      prompt,
      parsed.data.existingXml,
      parsed.data.blockCatalog,
    );
    res.json(strategy);
  } catch (error) {
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "OpenAI strategy generation failed",
    );
    if (error instanceof StrategyValidationError) {
      sendError(res, 422, error.message);
      return;
    }
    sendError(res, 502, "The strategy could not be generated. Please try again.");
  }
});

export default router;
