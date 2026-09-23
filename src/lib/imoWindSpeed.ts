export function isWindRelatedImoWarning(eventEn?: string, headlineEn?: string): boolean {
  return /\b(?:wind|gales?|storm)\b/i.test(`${eventEn ?? ""} ${headlineEn ?? ""}`);
}

export function splitImoWindSpeeds(source: string): { value: string; speed: boolean }[] {
  const parts: { value: string; speed: boolean }[] = [];
  const pattern = /(\d+(?:\.\d+)?(?:\s*[–-]\s*\d+(?:\.\d+)?)?)\s*m\/s/gi;
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ value: source.slice(last, index), speed: false });
    parts.push({ value: match[0], speed: true });
    last = index + match[0].length;
  }
  if (last < source.length) parts.push({ value: source.slice(last), speed: false });
  return parts.length > 0 ? parts : [{ value: source, speed: false }];
}
