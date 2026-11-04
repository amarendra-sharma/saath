import React from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useApp } from "../lib/app";
import { C, R, S, T } from "../lib/theme";
import { LocalFile, pickPdf, pickPhotos, takePhoto } from "../lib/upload";
import { Button, Icon } from "./ui";

/** Camera / gallery / PDF picker with removable thumbnails. */
export function AttachBar({ files, onChange, label }: { files: LocalFile[]; onChange: (f: LocalFile[]) => void; label: string }) {
  const { t } = useApp();
  return (
    <View style={{ gap: S.sm }}>
      <Text style={[T.small, { color: C.ink2, fontWeight: "600" }]}>{label}</Text>
      <View style={{ flexDirection: "row", gap: S.sm }}>
        <Button small kind="secondary" icon="camera-outline" label={t("take_photo")} style={{ flex: 1 }}
          onPress={async () => { const f = await takePhoto(); if (f) onChange([...files, f]); }} />
        <Button small kind="secondary" icon="images-outline" label={t("from_gallery")} style={{ flex: 1 }}
          onPress={async () => onChange([...files, ...(await pickPhotos())])} />
        <Button small kind="secondary" icon="document-outline" label="PDF" style={{ flex: 0.6 }}
          onPress={async () => onChange([...files, ...(await pickPdf())])} />
      </View>
      {files.length ? (
        <ScrollView horizontal contentContainerStyle={{ gap: S.sm }}>
          {files.map((f, i) => (
            <View key={f.uri + i} style={{ width: 84, height: 84, borderRadius: R.sm, overflow: "hidden", backgroundColor: C.primarySoft, alignItems: "center", justifyContent: "center" }}>
              {f.mime.startsWith("image/") ? <Image source={{ uri: f.uri }} style={{ width: 84, height: 84 }} /> : (
                <><Icon name="document-text-outline" size={28} color={C.primary} /><Text style={[T.tiny, { color: C.primaryDark }]} numberOfLines={1}>{f.name}</Text></>
              )}
              <Pressable onPress={() => onChange(files.filter((_, j) => j !== i))} accessibilityLabel={t("remove")} hitSlop={6}
                style={{ position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }}>
                <Icon name="close" size={16} color={C.white} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
