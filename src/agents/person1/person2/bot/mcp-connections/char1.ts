import { defineConnection } from "@grok/agent-sdk/connections";

export default defineConnection({
  agent: "person2",
  description: "Ask person 2 and bring back their reply.",
});