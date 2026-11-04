import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Avatar, Banner, Button, Card, Field, Row, Screen, hashTone } from "../components/ui";
import { notify, useApp } from "../lib/app";
import { errText, supabase } from "../lib/supabase";
import { C, S, T } from "../lib/theme";

type Preview = { id: string; name: string; purpose: string; currency: string; already_member: boolean; members: number; placeholders: { id: string; name: string }[] };

export default function Join() {
  const { t } = useApp();
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState((params.code ?? "").toUpperCase());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const look = async (c = code) => {
    setErr(null); setBusy(true);
    try {
      const { data, error } = await supabase.rpc("saath_preview_join", { p_code: c.trim().toUpperCase() });
      if (error) throw error;
      if (!data) { setErr(t("code_not_found")); setPreview(null); return; }
      const p = data as Preview;
      if (p.already_member) { router.replace({ pathname: "/circle/[id]", params: { id: p.id } }); return; }
      setPreview(p);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  useEffect(() => { if (params.code) look(params.code); /* eslint-disable-next-line */ }, []);

  const join = async (claim: string | null) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("saath_join", { p_code: code.trim().toUpperCase(), p_claim: claim });
      if (error) throw error;
      router.replace({ pathname: "/circle/[id]", params: { id: data as string } });
    } catch (e) { notify(t("something_wrong"), errText(e)); } finally { setBusy(false); }
  };

  return (
    <Screen title={t("join_circle")}>
      {!preview ? (
        <>
          <Text style={[T.body, { color: C.ink2 }]}>{t("join_intro")}</Text>
          <Field label={t("invite_code")} value={code} onChangeText={(s) => setCode(s.toUpperCase())} autoCapitalize="characters" autoCorrect={false}
            maxLength={7} placeholder="ABC1234" style={{ fontSize: 26, letterSpacing: 4, fontWeight: "800", textAlign: "center" }} error={err} onSubmitEditing={() => look()} />
          <Button label={t("find_circle")} loading={busy} disabled={code.trim().length < 6} onPress={() => look()} />
        </>
      ) : (
        <>
          <Card tone="primary">
            <Text style={[T.small, { color: "rgba(255,255,255,0.8)" }]}>{t("you_are_joining")}</Text>
            <Text style={[T.h1, { color: C.white }]}>{preview.name}</Text>
            <Text style={[T.small, { color: "rgba(255,255,255,0.8)" }]}>{t("n_members", { n: preview.members })} · {preview.currency}</Text>
          </Card>
          {preview.placeholders.length > 0 ? (
            <>
              <Text style={[T.h3, { color: C.ink }]}>{t("are_you_one")}</Text>
              <Card style={{ paddingVertical: 4 }}>
                {preview.placeholders.map((p, i) => (
                  <Row key={p.id} last={i === preview.placeholders.length - 1} left={<Avatar name={p.name} tone={hashTone(p.name)} />}
                    title={p.name} subtitle={t("thats_me")} onPress={() => join(p.id)} />
                ))}
              </Card>
              <Banner tone="primary" text={t("claim_hint")} />
              <Button kind="secondary" label={t("im_someone_else")} loading={busy} onPress={() => join(null)} />
            </>
          ) : (
            <Button label={t("join_now")} icon="enter-outline" loading={busy} onPress={() => join(null)} />
          )}
          <View style={{ alignItems: "center" }}><Button kind="ghost" label={t("use_other_code")} onPress={() => setPreview(null)} /></View>
        </>
      )}
    </Screen>
  );
}
