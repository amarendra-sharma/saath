import { bn } from "./strings.bn";
import { en } from "./strings.en";
import { es } from "./strings.es";
import { fr } from "./strings.fr";
import { hi } from "./strings.hi";
import { pt } from "./strings.pt";

// To add a language: copy strings.hi.ts, translate, and add it here and to LANGS.
export const STRINGS = { en, hi, es, fr, pt, bn } as const;
export type LangCode = keyof typeof STRINGS;

export const LANGS: { code: LangCode; native: string; english: string }[] = [
  { code: "en", native: "English", english: "English" },
  { code: "hi", native: "हिन्दी", english: "Hindi" },
  { code: "bn", native: "বাংলা", english: "Bengali" },
  { code: "es", native: "Español", english: "Spanish" },
  { code: "fr", native: "Français", english: "French" },
  { code: "pt", native: "Português", english: "Portuguese" },
];
