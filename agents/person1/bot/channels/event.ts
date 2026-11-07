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
      handler: async (_request, { send, waitUntil, body }) => {
        waitUntil(
          send(
            `The player chose ${body.eventId}. What changed: ${body.summary}. React in character.`,
            { continuationToken: `player:${body.playerId}` },
          ),
        );
        return new Response(null, { status: 202 });
      },
    }),
  ],
});