import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { Image, Modal, Pressable, Text, View } from "react-native";
import { Avatar, Button, Card, Icon, Loading, Row, Screen, Section, hashTone } from "../../../components/ui";
import { confirm, notify, useApp } from "../../../lib/app";
import { CATEGORY_ICON } from "../../../lib/constants";
import { Expense, Summary, loadSummary, memberName, useLoad } from "../../../lib/data";
import { dateLabel, money } from "../../../lib/format";
import { openUrl } from "../../../lib/share";
import { RECEIPTS_BUCKET, errText, supabase } from "../../../lib/supabase";
import { C, R, S, T } from "../../../lib/theme";
import { signedUrl } from "../../../lib/upload";
import { BillCheck, loadCheck } from "../../../lib/billcheck";
import { BillCheckCard } from "../../../components/BillCheckCard";

type Receipt = { id: string; path: string; mime: string | null; uploaded_by: string; created_at: string };
type Full = Omit<Expense, "saath_receipts"> & { saath_receipts: Receipt[] };

export default function ExpenseView() {
  const { id, eid } = useLocalSearchParams<{ id: string; eid: string }>();
  const { t, lang, session } = useApp();
  const sum = useLoad<Summary>(() => loadSummary(id), [id]);
  const exp = useLoad<{ e: Full; charges: { member_id: string; amount: number }[] }>(async () => {
    const [{ data: e, error }, { data: charges }] = await Promise.all([
      supabase.from("saath_expenses").select("*, saath_receipts(*)").eq("id", eid).single(),
      supabase.from("saath_charges").select("member_id, amount").eq("expense_id", eid),
    ]);
    if (error) throw error;
    return { e: e as Full, charges: (charges ?? []) as any };
  }, [eid]);
  const check = useLoad<BillCheck | null>(() => loadCheck(eid), [eid]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [big, setBig] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const out: Record<string, string> = {};
      for (const r of exp.data?.e.saath_receipts ?? []) { const u = await signedUrl(r.path); if (u) out[r.id] = u; }
      setUrls(out);
    })();
  }, [exp.data]);

  const s = sum.data, d = exp.data;
  if (!s || !d) return <Loading />;
  const e = d.e, cur = s.circle.currency;
  const canEdit = s.is_admin || e.created_by === session?.user.id;

  const delReceipt = async (r: Receipt) => {
    if (!(await confirm(t("remove_receipt_q"), "", t("remove"), t("cancel"), true))) return;
    const { error } = await supabase.from("saath_receipts").delete().eq("id", r.id);
    const { count } = await supabase.from("saath_receipts").select("id", { count: "exact", head: true }).eq("path", r.path);
    if (!error && !count) await supabase.storage.from(RECEIPTS_BUCKET).remove([r.path]);
    if (error) notify(t("something_wrong"), errText(error)); else exp.reload();
  };

  return (
    <Screen title={e.title} subtitle={dateLabel(e.spent_on, lang, true)}
      right={canEdit ? <Button small kind="secondary" icon="create-outline" label={t("edit")} onPress={() => router.push({ pathname: "/circle/[id]/expense", params: { id, eid } })} /> : undefined}>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: S.md }}>
          <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: C.primarySoft, alignItems: "center", justifyContent: "center" }}>
            <Icon name={CATEGORY_ICON[e.category] ?? "pricetag-outline"} size={24} color={C.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[T.hero, { color: C.ink }]}>{money(e.amount, cur, lang)}</Text>
            <Text style={[T.small, { color: C.ink3 }]}>{t("cat_" + e.category)}{e.vendor ? ` · ${e.vendor}` : ""}</Text>
          </View>
        </View>
        {e.orig_amount && e.orig_currency ? <Text style={[T.small, { color: C.ink2 }]}>{t("sent_as", { amount: money(e.orig_amount, e.orig_currency, lang) })}</Text> : null}
        <Text style={[T.small, { color: C.ink2 }]}>
          {e.paid_by_member_id ? t("paid_by_x", { name: memberName(s, e.paid_by_member_id) }) : s.payees[0] ? t("paid_by_payee", { name: s.payees[0].name }) : t("paid_from_fund")}
        </Text>
        {e.notes ? <Text style={[T.body, { color: C.ink }]}>{e.notes}</Text> : null}
      </Card>

      <BillCheckCard expenseId={e.id} check={check.data ?? null} currency={cur} plan={s.circle.plan} onChange={(c) => check.setData(c)} />

      <Section title={t("receipts")} action={canEdit ? <Button small kind="ghost" icon="add" label={t("add")} onPress={() => router.push({ pathname: "/circle/[id]/expense", params: { id, eid } })} /> : undefined}>
        {e.saath_receipts.length === 0 ? <Card><Text style={[T.small, { color: C.ink3 }]}>{t("no_receipt_yet")}</Text></Card> : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: S.sm }}>
            {e.saath_receipts.map((r) => (
              <View key={r.id} style={{ width: "48%", gap: 4 }}>
                <Pressable onPress={() => (r.mime?.startsWith("image/") ? setBig(urls[r.id]) : urls[r.id] && openUrl(urls[r.id]))}
                  style={{ height: 160, borderRadius: R.md, overflow: "hidden", backgroundColor: C.primarySoft, alignItems: "center", justifyContent: "center" }}>
                  {r.mime?.startsWith("image/") && urls[r.id] ? <Image source={{ uri: urls[r.id] }} style={{ width: "100%", height: "100%" }} resizeMode="cover" /> : (
                    <><Icon name="document-text-outline" size={36} color={C.primary} /><Text style={[T.small, { color: C.primaryDark }]}>{t("open_pdf")}</Text></>
                  )}
                </Pressable>
                {canEdit || r.uploaded_by === session?.user.id ? <Button small kind="ghost" icon="trash-outline" label={t("remove")} onPress={() => delReceipt(r)} /> : null}
              </View>
            ))}
          </View>
        )}
      </Section>

      {d.charges.length ? (
        <Section title={t("how_split")}>
          <Card style={{ paddingVertical: 4 }}>
            {d.charges.map((c, i) => {
              const n = memberName(s, c.member_id);
              return <Row key={c.member_id} last={i === d.charges.length - 1} left={<Avatar name={n} tone={hashTone(n)} size={34} />} title={n}
                right={<Text style={[T.body, { fontWeight: "700", color: C.ink }]}>{money(c.amount, cur, lang)}</Text>} />;
            })}
          </Card>
        </Section>
      ) : null}

      <Modal visible={!!big} transparent animationType="fade" onRequestClose={() => setBig(null)}>
        <Pressable onPress={() => setBig(null)} accessibilityLabel={t("close")}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center", gap: S.md, padding: S.md }}>
          {big ? <Image source={{ uri: big }} style={{ width: "100%", height: "80%" }} resizeMode="contain" /> : null}
          {big ? <Button small kind="secondary" label={t("open_full")} icon="open-outline" onPress={() => openUrl(big)} /> : null}
        </Pressable>
      </Modal>
    </Screen>
  );
}
