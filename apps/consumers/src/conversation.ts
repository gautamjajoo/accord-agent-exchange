const MAX_INTENT_LENGTH = 2000;

/** Keep the newest preference intact while fitting the exchange's intent limit. */
export function buildConsumerIntent(scenarioPrompt: string, previousUserMessages: readonly string[], latest: string): string {
  const request = latest.trim();
  if (request.length > MAX_INTENT_LENGTH) throw new Error('Keep your message to 2,000 characters.');
  const history = previousUserMessages.filter(message => message.trim()).slice(-3);
  if (!history.length) return request;

  const earlierLabel = 'Earlier context (excerpt):\n';
  const latestLabel = '\nLatest request: ';
  const available = MAX_INTENT_LENGTH - request.length - earlierLabel.length - latestLabel.length;
  // A full-length new message has priority over every historical character.
  if (available <= 0) return request;
  const context = [scenarioPrompt, ...history].join('\n');
  return `${earlierLabel}${context.slice(-available)}${latestLabel}${request}`;
}
