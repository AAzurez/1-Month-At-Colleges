import { defineChannel, POST } from "@grok/agent-sdk/channels";
import * as z from "zod/v4";

export default defineChannel({
  routes: [
    POST("/choice", {
      description: "Tell person 1 which event the player chose.",
      bodySchema: z.object({
        playerId: z.string(),
        eventId: z.string(),
        summary: z.string(),
        memory: z.string().optional(),
        stats: z.string().optional(),
      }),
      handler: async (_request, { send, body }) => {
        const earlier = body.memory ?? "No earlier decisions.";
        const stats = body.stats ?? "Stats were not included.";
        const session = await send(
          `The player chose ${body.eventId}. What changed: ${body.summary}.\n${stats}\nEarlier decisions:\n${earlier}\nReply to the player by their first name in one short, casual line, in character, using this game's names. Do not mention any numbers or list what changed.`,
          { continuationToken: `player:${body.playerId}` },
        );
        const outcome = await session.waitForCompletion();
        return Response.json({
          ok: outcome.status === "finished",
          reply: outcome.result ?? "",
          error: outcome.errorMessage ?? null,
          sessionId: session.id,
          playground: `http://127.0.0.1:3000/person1/playground?sessionId=${session.id}`,
        });
      },
    }),
  ],
});