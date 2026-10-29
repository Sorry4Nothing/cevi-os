import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { masse, useFarben } from "./tokens";

export function Karte({ children }: { children: ReactNode }) {
  const farben = useFarben();

  return (
    <View style={[styles.karte, { backgroundColor: farben.flaeche }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  karte: {
    gap: masse.luecke,
    padding: masse.abstand,
    borderRadius: masse.radius,
  },
});
