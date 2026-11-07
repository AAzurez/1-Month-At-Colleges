export function databaseUrl(): Promise<string>;

export function saveChoice(input: {
  playerId: string;
  eventId: string;
  summary: string;
}): Promise<number>;

export function saveReply(input: {
  choiceId: number;
  agent: string;
  reply: string;
}): Promise<void>;

export function listMemories(playerId: string): Promise<
  Array<{
    id: number;
    eventId: string;
    caused: string;
    notes: string;
  }>
>;

export function formatMemories(
  memories: Array<{ eventId: string; caused: string; notes: string }>,
): string;
