import { Platform } from "react-native";

// Saath palette: deep navy + refined gold on cool neutrals. All text pairs meet WCAG AA (4.5:1).
export const C = {
  bg: "#F4F6FA",
  card: "#FFFFFF",
  ink: "#0E1A2B",
  ink2: "#44526A",
  ink3: "#63708A",
  line: "#E2E7EF",
  primary: "#1A3A6E",
  primaryDark: "#112850",
  primarySoft: "#E8EEF8",
  accent: "#8F6316",
  accentSoft: "#F8EFDD",
  gold: "#C99A3E",          // brand mark / decorative only (not for text)
  owe: "#B42318",
  oweSoft: "#FDECEA",
  ok: "#0E7A48",
  okSoft: "#E3F4EA",
  pending: "#7F5B00",
  pendingSoft: "#FCF2D6",
  white: "#FFFFFF",
  segBg: "#E9EDF4",
  pressed: "#F1F4F9",
  overlay: "rgba(8,18,38,0.5)",
};

export const R = { sm: 10, md: 14, lg: 18, pill: 999 };
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const T = {
  hero: { fontSize: 34, fontWeight: "800" as const, letterSpacing: -0.8 },
  h1: { fontSize: 26, fontWeight: "800" as const, letterSpacing: -0.5 },
  h2: { fontSize: 20, fontWeight: "700" as const, letterSpacing: -0.2 },
  h3: { fontSize: 17, fontWeight: "700" as const },
  body: { fontSize: 16, lineHeight: 23 },
  small: { fontSize: 14, lineHeight: 19 },
  tiny: { fontSize: 12, lineHeight: 16 },
};

export const shadow = Platform.select({
  ios: { shadowColor: "#0E1A2B", shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  android: { elevation: 1 },
  default: { boxShadow: "0 1px 2px rgba(14,26,43,0.04), 0 4px 14px rgba(14,26,43,0.06)" } as any,
});
