import React, { useMemo } from "react";
import { View } from "react-native";
import { qrMatrix } from "../lib/qr";

/** QR code drawn with plain Views (no native module): each row is a strip of dark/light runs. */
export function QrCode({ value, size = 220, label }: { value: string; size?: number; label?: string }) {
  const rows = useMemo(() => {
    const m = qrMatrix(value);
    return m.map((row) => {
      const runs: { dark: boolean; n: number }[] = [];
      for (const d of row) { const last = runs[runs.length - 1]; if (last && last.dark === d) last.n++; else runs.push({ dark: d, n: 1 }); }
      return runs;
    });
  }, [value]);
  const quiet = 4;
  const cell = Math.max(2, Math.floor(size / (rows.length + quiet * 2)));
  const side = cell * (rows.length + quiet * 2);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label ?? "QR code"}
      style={{ width: side, height: side, padding: cell * quiet, backgroundColor: "#FFFFFF", borderRadius: 8, alignSelf: "center" }}>
      {rows.map((runs, r) => (
        <View key={r} style={{ flexDirection: "row", height: cell }}>
          {runs.map((run, i) => <View key={i} style={{ width: cell * run.n, height: cell, backgroundColor: run.dark ? "#000000" : "#FFFFFF" }} />)}
        </View>
      ))}
    </View>
  );
}
