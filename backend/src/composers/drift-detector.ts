import crypto from 'crypto';
import { PromptDriftInfo } from './types';

function hashPrompt(prompt: string): string {
  return crypto.createHash('sha256').update(prompt || '').digest('hex');
}

export function detectPromptDrift(codePrompt: string, dbPrompt: string | null | undefined): PromptDriftInfo | null {
  if (typeof dbPrompt !== 'string' || !dbPrompt.trim()) {
    return null;
  }

  const codeHash = hashPrompt(codePrompt || '');
  const dbHash = hashPrompt(dbPrompt);

  return {
    driftDetected: codeHash !== dbHash,
    codeHash,
    dbHash,
  };
}
