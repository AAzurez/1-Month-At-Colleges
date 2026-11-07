import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { listMemories } from "../../../../db/memory.mjs";

export default defineTool({
  description: "Read the decisions this player already made and what each one caused.",
  inputSchema: z.object({
    playerId: z.string().describe("Player id, such as sam."),
  }),
  async execute({ playerId }) {
    const memories = await listMemories(playerId);
    return { memories };
  },
});
