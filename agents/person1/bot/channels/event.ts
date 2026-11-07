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
      }),
      handler: async (_request, { send, body }) => {
        const session = await send(
          `The player chose ${body.eventId}. What changed: ${body.summary}. React in character.`,
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