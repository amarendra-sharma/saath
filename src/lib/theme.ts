import { Platform } from "react-native";

export const C = {
  bg: "#F6F3EC",
  card: "#FFFFFF",
  ink: "#1C2624",
  ink2: "#4A5754",
  ink3: "#7C8784",
  line: "#E4DFD3",
  primary: "#0E6B5C",
  primaryDark: "#0A5246",
  primarySoft: "#E1EFEA",
  accent: "#D98A1E",
  accentSoft: "#FBEBD2",
  owe: "#B4441C",
  oweSoft: "#FBE6DC",
  ok: "#1F7A3E",
  okSoft: "#E1F2E6",
  pending: "#8A6D12",
  pendingSoft: "#FBF1CF",
  white: "#FFFFFF",
  overlay: "rgba(20,30,28,0.45)",
};

export const R = { sm: 10, md: 16, lg: 22, pill: 999 };
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const T = {
  hero: { fontSize: 34, fontWeight: "800" as const, letterSpacing: -0.5 },
  h1: { fontSize: 26, fontWeight: "800" as const, letterSpacing: -0.3 },
  h2: { fontSize: 20, fontWeight: "700" as const },
  h3: { fontSize: 17, fontWeight: "700" as const },
  body: { fontSize: 16, lineHeight: 23 },
  small: { fontSize: 14, lineHeight: 19 },
  tiny: { fontSize: 12, lineHeight: 16 },
};

export const shadow = Platform.select({
  ios: { shadowColor: "#2B2A20", shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  android: { elevation: 2 },
  default: { boxShadow: "0 4px 14px rgba(43,42,32,0.07)" } as any,
});
