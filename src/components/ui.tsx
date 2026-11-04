import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text,
  TextInput, TextInputProps, View, ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { initials } from "../lib/format";
import { C, R, S, T, shadow } from "../lib/theme";

export type IconName = React.ComponentProps<typeof Ionicons>["name"];
export const Icon = ({ name, size = 22, color = C.ink }: { name: IconName | string; size?: number; color?: string }) => (
  <Ionicons name={name as IconName} size={size} color={color} />
);

/** Page shell: safe areas, header, scrolling body, optional sticky footer. */
export function Screen({
  title, subtitle, back = true, right, children, footer, scroll = true, onRefresh, padded = true,
}: {
  title?: string; subtitle?: string; back?: boolean; right?: React.ReactNode; children: React.ReactNode;
  footer?: React.ReactNode; scroll?: boolean; onRefresh?: () => void; padded?: boolean;
}) {
  const ins = useSafeAreaInsets();
  const Body: any = scroll ? ScrollView : View;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ paddingTop: ins.top + 6, paddingHorizontal: S.lg, paddingBottom: S.sm, flexDirection: "row", alignItems: "center", gap: S.sm }}>
        {back ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))}
            style={({ pressed }) => [st.iconBtn, pressed && { opacity: 0.6 }]}>
            <Icon name="chevron-back" size={24} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          {title ? <Text style={[T.h1, { color: C.ink }]} numberOfLines={1} accessibilityRole="header">{title}</Text> : null}
          {subtitle ? <Text style={[T.small, { color: C.ink3 }]} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      <Body
        style={{ flex: 1 }}
        contentContainerStyle={scroll ? { padding: padded ? S.lg : 0, paddingBottom: (footer ? 120 : 40) + ins.bottom, gap: S.lg } : undefined}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </Body>
      {footer ? (
        <View style={[st.footer, { paddingBottom: ins.bottom + S.md }]}>{footer}</View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

export function Card({ children, style, onPress, tone }: { children: React.ReactNode; style?: ViewStyle | ViewStyle[]; onPress?: () => void; tone?: "primary" | "accent" | "owe" | "ok" }) {
  const bg = tone === "primary" ? C.primary : tone === "accent" ? C.accentSoft : tone === "owe" ? C.oweSoft : tone === "ok" ? C.okSoft : C.card;
  const inner = <View style={[st.card, { backgroundColor: bg }, style as any]}>{children}</View>;
  if (!onPress) return inner;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [pressed && { transform: [{ scale: 0.99 }], opacity: 0.92 }]}>
      {inner}
    </Pressable>
  );
}

export function Button({
  label, onPress, kind = "primary", icon, loading, disabled, small, style,
}: {
  label: string; onPress?: () => void; kind?: "primary" | "secondary" | "ghost" | "danger" | "accent"; icon?: IconName | string;
  loading?: boolean; disabled?: boolean; small?: boolean; style?: ViewStyle;
}) {
  const bg = { primary: C.primary, secondary: C.primarySoft, ghost: "transparent", danger: C.oweSoft, accent: C.accent }[kind];
  const fg = { primary: C.white, secondary: C.primaryDark, ghost: C.primary, danger: C.owe, accent: C.white }[kind];
  return (
    <Pressable
      accessibilityRole="button" accessibilityState={{ disabled: !!(disabled || loading) }}
      disabled={disabled || loading} onPress={onPress}
      style={({ pressed }) => [
        st.btn, small && st.btnSmall, { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        kind === "ghost" && { paddingHorizontal: S.sm }, style,
      ]}>
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          {icon ? <Icon name={icon} size={small ? 18 : 20} color={fg} /> : null}
          <Text style={[small ? T.small : T.h3, { color: fg, fontWeight: "700" }]} numberOfLines={1}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, color = C.ink, bg = C.card }: { icon: IconName | string; onPress: () => void; label: string; color?: string; bg?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={8} onPress={onPress}
      style={({ pressed }) => [st.iconBtn, { backgroundColor: bg }, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={22} color={color} />
    </Pressable>
  );
}

export function Field({ label, hint, error, style, ...p }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[T.small, { color: C.ink2, fontWeight: "600" }]}>{label}</Text>
      <TextInput
        placeholderTextColor={C.ink3}
        accessibilityLabel={label}
        {...p}
        style={[st.input, p.multiline && { minHeight: 84, textAlignVertical: "top", paddingTop: 12 }, error ? { borderColor: C.owe } : null, style]}
      />
      {error ? <Text style={[T.tiny, { color: C.owe }]}>{error}</Text> : hint ? <Text style={[T.tiny, { color: C.ink3 }]}>{hint}</Text> : null}
    </View>
  );
}

/** Large, calculator-like amount input */
export function AmountField({ value, onChangeText, currency, label, autoFocus }: { value: string; onChangeText: (s: string) => void; currency: string; label: string; autoFocus?: boolean }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[T.small, { color: C.ink2, fontWeight: "600" }]}>{label}</Text>
      <View style={[st.input, { flexDirection: "row", alignItems: "center", height: 72, gap: 8 }]}>
        <Text style={[T.h2, { color: C.ink3 }]}>{currency}</Text>
        <TextInput
          value={value} onChangeText={onChangeText} keyboardType="decimal-pad" placeholder="0" autoFocus={autoFocus}
          placeholderTextColor={C.line} accessibilityLabel={label}
          style={{ flex: 1, minWidth: 0, width: "100%", fontSize: 34, fontWeight: "800", color: C.ink, paddingVertical: 0, outlineStyle: "none" } as any}
        />
      </View>
    </View>
  );
}

export function Chips<V extends string>({ options, value, onChange, wrap = true }: { options: { value: V; label: string; icon?: string }[]; value: V | null; onChange: (v: V) => void; wrap?: boolean }) {
  const content = options.map((o) => {
    const on = o.value === value;
    return (
      <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)}
        style={[st.chip, on && { backgroundColor: C.primary, borderColor: C.primary }]}>
        {o.icon ? <Icon name={o.icon} size={16} color={on ? C.white : C.ink2} /> : null}
        <Text style={[T.small, { color: on ? C.white : C.ink2, fontWeight: "600" }]}>{o.label}</Text>
      </Pressable>
    );
  });
  if (wrap) return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{content}</View>;
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{content}</ScrollView>;
}

export function Segmented<V extends string>({ options, value, onChange }: { options: { value: V; label: string; badge?: number }[]; value: V; onChange: (v: V) => void }) {
  return (
    <View style={st.seg} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)}
            style={[st.segItem, on && { backgroundColor: C.card, ...(shadow as any) }]}>
            <Text style={{ fontSize: 13, color: on ? C.ink : C.ink3, fontWeight: on ? "700" : "600" }} numberOfLines={1}>{o.label}</Text>
            {o.badge ? <View style={[st.badge, { position: "absolute", top: 2, right: 2 }]}><Text style={{ color: C.white, fontSize: 10, fontWeight: "800" }}>{o.badge}</Text></View> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function Avatar({ name, size = 40, tone = 0 }: { name: string; size?: number; tone?: number }) {
  const palette = [["#E1EFEA", C.primaryDark], ["#FBEBD2", "#8A5410"], ["#E6E4F5", "#463C8F"], ["#FBE6DC", "#8F3412"], ["#E2EEF7", "#1F4E79"]];
  const [bg, fg] = palette[Math.abs(tone) % palette.length];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: fg, fontWeight: "800", fontSize: size * 0.38 }}>{initials(name)}</Text>
    </View>
  );
}
export const hashTone = (s: string) => [...(s || "")].reduce((a, c) => a + c.charCodeAt(0), 0);

export function Row({ left, title, subtitle, right, onPress, last }: { left?: React.ReactNode; title: string; subtitle?: string; right?: React.ReactNode; onPress?: () => void; last?: boolean }) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} accessibilityRole={onPress ? "button" : undefined}
      style={({ pressed }) => [st.row, !last && st.rowLine, pressed && onPress && { backgroundColor: "#FAF8F3" }]}>
      {left}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[T.body, { color: C.ink, fontWeight: "600" }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[T.small, { color: C.ink3 }]} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right}
      {onPress && !right ? <Icon name="chevron-forward" size={18} color={C.ink3} /> : null}
    </Pressable>
  );
}

export function Pill({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "owe" | "ok" | "pending" | "primary" }) {
  const map = { neutral: [C.bg, C.ink2], owe: [C.oweSoft, C.owe], ok: [C.okSoft, C.ok], pending: [C.pendingSoft, C.pending], primary: [C.primarySoft, C.primaryDark] } as const;
  const [bg, fg] = map[tone];
  return <View style={{ backgroundColor: bg, borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 4 }}><Text style={{ color: fg, fontSize: 12, fontWeight: "700" }}>{text}</Text></View>;
}

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ gap: S.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 28 }}>
        <Text style={[T.h3, { color: C.ink }]} accessibilityRole="header">{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

export function Empty({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: S.xxl, paddingHorizontal: S.lg, gap: S.sm }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: C.primarySoft, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={34} color={C.primary} />
      </View>
      <Text style={[T.h3, { color: C.ink, textAlign: "center" }]}>{title}</Text>
      {text ? <Text style={[T.small, { color: C.ink3, textAlign: "center", maxWidth: 320 }]}>{text}</Text> : null}
      {action ? <View style={{ marginTop: S.sm }}>{action}</View> : null}
    </View>
  );
}

export function Loading() {
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg }}><ActivityIndicator size="large" color={C.primary} /></View>;
}

export function Banner({ text, tone = "pending", icon = "information-circle-outline" }: { text: string; tone?: "pending" | "owe" | "ok" | "primary"; icon?: string }) {
  const map = { pending: [C.pendingSoft, C.pending], owe: [C.oweSoft, C.owe], ok: [C.okSoft, C.ok], primary: [C.primarySoft, C.primaryDark] } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ flexDirection: "row", gap: 10, backgroundColor: bg, padding: S.md, borderRadius: R.md, alignItems: "flex-start" }}>
      <Icon name={icon} size={20} color={fg} />
      <Text style={[T.small, { color: fg, flex: 1, fontWeight: "600" }]}>{text}</Text>
    </View>
  );
}

/** Bottom sheet modal */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ins = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: C.overlay }} onPress={onClose} accessibilityLabel="Close" />
      <View style={[st.sheet, { paddingBottom: ins.bottom + S.lg }]}>
        <View style={{ alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: C.line, marginBottom: S.md }} />
        <Text style={[T.h2, { color: C.ink, marginBottom: S.md }]}>{title}</Text>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: S.md }} style={{ maxHeight: 520 }}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} onPress={() => onChange(!value)}
      style={{ flexDirection: "row", alignItems: "center", gap: S.md, paddingVertical: 6 }}>
      <View style={{ flex: 1 }}>
        <Text style={[T.body, { color: C.ink, fontWeight: "600" }]}>{label}</Text>
        {hint ? <Text style={[T.tiny, { color: C.ink3 }]}>{hint}</Text> : null}
      </View>
      <View style={{ width: 52, height: 32, borderRadius: 16, backgroundColor: value ? C.primary : C.line, padding: 3, alignItems: value ? "flex-end" : "flex-start" }}>
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.white }} />
      </View>
    </Pressable>
  );
}

export const st = StyleSheet.create({
  card: { borderRadius: R.lg, padding: S.lg, gap: S.sm, ...(shadow as any) },
  btn: { height: 54, borderRadius: R.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: S.lg },
  btnSmall: { height: 40, borderRadius: R.sm, paddingHorizontal: S.md },
  iconBtn: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  input: { backgroundColor: C.card, borderWidth: 1.5, borderColor: C.line, borderRadius: R.md, paddingHorizontal: S.md, minHeight: 52, fontSize: 17, color: C.ink },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, height: 38, borderRadius: R.pill, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.card },
  seg: { flexDirection: "row", backgroundColor: "#ECE7DC", borderRadius: R.md, padding: 4, gap: 4 },
  segItem: { flex: 1, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, paddingHorizontal: 4 },
  badge: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.owe, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingVertical: S.md, paddingHorizontal: S.xs },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: S.lg, paddingTop: S.md, backgroundColor: "rgba(246,243,236,0.96)", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: S.lg },
});
