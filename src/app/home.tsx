import { router } from "expo-router";
import React from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Card, Empty, Icon, IconButton, Pill } from "../components/ui";
import { useApp } from "../lib/app";
import { useLoad } from "../lib/data";
import { money } from "../lib/format";
import { supabase } from "../lib/supabase";
import { PURPOSE_ICON } from "../lib/constants";
import { C, S, T } from "../lib/theme";

type Item = { id: string; name: string; purpose: string; currency: string; status: string; role: string; share: number; members: number; balance: number; pending: number };

export default function Home() {
  const { t, lang, profile, isAdmin } = useApp();
  const ins = useSafeAreaInsets();
  const { data, loading, reload } = useLoad<Item[]>(async () => {
    const { data, error } = await supabase.rpc("saath_my_circles");
    if (error) throw error;
    return (data ?? []) as Item[];
  });
  const items = data ?? [];
  const first = (profile?.full_name || "").split(" ")[0];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: ins.top + S.md, paddingHorizontal: S.lg, paddingBottom: ins.bottom + 120, gap: S.lg }}
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} tintColor={C.primary} />}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: S.md }}>
          <View style={{ flex: 1 }}>
            <Text style={[T.small, { color: C.ink3 }]}>{t("namaste")}{first ? `, ${first}` : ""}</Text>
            <Text style={[T.h1, { color: C.ink }]} accessibilityRole="header">{t("your_circles")}</Text>
          </View>
          {isAdmin ? <IconButton icon="shield-half-outline" label="Admin console" color={C.primary} onPress={() => router.push("/admin")} /> : null}
          <IconButton icon="person-circle-outline" label={t("profile")} onPress={() => router.push("/profile")} />
        </View>

        {!loading && items.length === 0 ? (
          <Card>
            <Empty icon="people-outline" title={t("no_circles_title")} text={t("no_circles_text")} />
          </Card>
        ) : null}

        {items.map((c) => {
          const bal = Number(c.balance ?? 0);
          return (
            <Card key={c.id} onPress={() => router.push({ pathname: "/circle/[id]", params: { id: c.id } })}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: S.md }}>
                <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: C.primarySoft, alignItems: "center", justifyContent: "center" }}>
                  <Icon name={PURPOSE_ICON[c.purpose] ?? "albums-outline"} size={24} color={C.primary} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[T.h3, { color: C.ink }]} numberOfLines={1}>{c.name}</Text>
                  <Text style={[T.small, { color: C.ink3 }]}>
                    {t("n_members", { n: c.members })} · {t("your_share_pct", { pct: Number(c.share).toFixed(0) })}
                  </Text>
                </View>
                {c.role === "admin" && c.pending > 0 ? <Pill text={t("n_to_confirm", { n: c.pending })} tone="pending" /> : null}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4,
                backgroundColor: bal > 0.5 ? C.oweSoft : bal < -0.5 ? C.okSoft : C.bg, borderRadius: 12, padding: 12 }}>
                <Text style={[T.small, { color: bal > 0.5 ? C.owe : bal < -0.5 ? C.ok : C.ink2, fontWeight: "700" }]}>
                  {bal > 0.5 ? t("you_owe") : bal < -0.5 ? t("you_are_owed") : t("all_settled")}
                </Text>
                {Math.abs(bal) > 0.5 ? (
                  <Text style={[T.h3, { color: bal > 0 ? C.owe : C.ok }]}>{money(Math.abs(bal), c.currency, lang)}</Text>
                ) : <Icon name="checkmark-circle" size={20} color={C.ok} />}
              </View>
            </Card>
          );
        })}
      </ScrollView>
      <View style={{ position: "absolute", left: S.lg, right: S.lg, bottom: ins.bottom + S.lg, flexDirection: "row", gap: S.md }}>
        <Button style={{ flex: 1 }} kind="secondary" icon="enter-outline" label={t("join_circle")} onPress={() => router.push("/join")} />
        <Button style={{ flex: 1.3 }} icon="add" label={t("new_circle")} onPress={() => router.push("/new-circle")} />
      </View>
    </View>
  );
}

