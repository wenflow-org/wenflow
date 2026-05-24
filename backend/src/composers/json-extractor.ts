export function extractJsonObject(raw: string): { extractedJson: string | null; parsed: any | null } {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { extractedJson: null, parsed: null };
  }

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    return { extractedJson: null, parsed: null };
  }

  try {
    return {
      extractedJson: match[0],
      parsed: JSON.parse(match[0]),
    };
  } catch {
    return {
      extractedJson: match[0],
      parsed: null,
    };
  }
}
