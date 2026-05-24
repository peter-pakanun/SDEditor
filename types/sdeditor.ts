export type GameVersion = "poe1" | "poe2";

export interface TempTranslation {
  count: number;
  content: string[];
}

export interface StatDesc {
  filepath: string;
  filedir: string;
  filename?: string;
  name: string | null;
  stats: string[];
  variables: string[];
  remarks: string[];
  tempTranslations: Record<string, TempTranslation>;
  translations: Record<string, string[]>;
  isDNT: boolean;
  isMissing?: boolean;
  hasChanges?: boolean;
  needsReview?: boolean;
}

export interface TranslationDiagnostic {
  level: "warning" | "error";
  code: string;
  message: string;
  start: number;
  end: number;
  expected?: string;
}
