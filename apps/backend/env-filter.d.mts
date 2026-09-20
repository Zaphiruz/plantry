export declare const PROTECTED_ENV_KEYS: readonly string[];
export declare function filterSecrets(
  secrets: Record<string, string> | null | undefined,
): { applied: Record<string, string>; ignored: string[] };
