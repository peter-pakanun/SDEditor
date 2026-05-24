export const ZIP_TXT_FILE_COUNT_THRESHOLD = 5000;

export const GAME_VERSIONS = {
  poe1: { id: "poe1", label: "PoE1", title: "Path of Exile 1" },
  poe2: { id: "poe2", label: "PoE2", title: "Path of Exile 2" },
} as const;

export const SETTINGS_LANG_TO_BCP47: Record<string, string> = {
  Thai: "th",
  Portuguese: "pt",
  German: "de",
  Russian: "ru",
  Spanish: "es",
  French: "fr",
  "Traditional Chinese": "zh-Hant",
  "Simplified Chinese": "zh-Hans",
  Korean: "ko",
  Japanese: "ja",
};

export const GAME_PREVIEW_FONT_STACKS: Record<string, string> = {
  Thai: '"Kanit", sans-serif',
  "Traditional Chinese": '"Noto Sans TC", sans-serif',
  "Simplified Chinese": '"Noto Sans SC", sans-serif',
  Korean: '"Spoqa Han Sans Neo", "Noto Sans KR", sans-serif',
  Japanese: '"Koruri Regular", "Koruri", "Noto Sans JP", sans-serif',
  Spanish: '"Fontin Smallcaps", "Fontin", "Noto Serif", serif',
  French: '"Friz Quadrata ITC", "Friz Quadrata", "Fontin Smallcaps", "Fontin", Georgia, serif',
  Portuguese: '"Friz Quadrata ITC", "Friz Quadrata", "Fontin Smallcaps", "Fontin", Georgia, serif',
  German: '"Friz Quadrata ITC", "Friz Quadrata", "Fontin Smallcaps", "Fontin", Georgia, serif',
  Russian: '"Friz Quadrata ITC", "Friz Quadrata", "Fontin Smallcaps", "Fontin", Georgia, serif',
};
