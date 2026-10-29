import { Tabs } from "expo-router/js-tabs";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";

import { authClient } from "../../src/api/client";
import { useIch } from "../../src/api/ich";
import { tokenRegistrieren, usePushTipps } from "../../src/push";
import { useFarben } from "../../src/ui/tokens";

// Kein tabBarAllowFontScaling: iOS skaliert Tab-Beschriftungen nie, zeigt aber den Large Content Viewer (Checkliste 5.10)
export default function TabLayout() {
  const farben = useFarben();
  const ich = useIch();
  const sitzungId = authClient.useSession().data?.session?.id ?? null;

  // Jeder App-Start und jede neue Sitzung melden das Token; ein Passwortwechsel ersetzt die Sitzung und registriert so neu
  useEffect(() => {
    if (sitzungId !== null) void tokenRegistrieren();
  }, [sitzungId]);

  usePushTipps();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Eigene Farben: Der Router startet sonst mit dem hellen Standard-Theme von React Navigation (Checkliste 5.4)
        tabBarStyle: {
          backgroundColor: farben.hintergrund,
          borderTopColor: farben.rand,
        },
        tabBarActiveTintColor: farben.akzent,
        tabBarInactiveTintColor: farben.textLeise,
        // Ohne Icon malt React Navigation «⏷»; der Balken zeigt den aktiven Tab nicht nur über Farbe (Checkliste 5.6)
        tabBarIcon: ({ focused, color }) => (
          <View
            style={[styles.balken, focused && { backgroundColor: color }]}
          />
        ),
      }}
    >
      <Tabs.Screen name="programme" options={{ title: "Programme" }} />
      <Tabs.Screen name="profil" options={{ title: "Profil" }} />
      {/* Nur Bedienschutz: Jede Admin-Route prüft das Recht aus der Sitzung selbst */}
      <Tabs.Protected guard={ich.data?.admin === true}>
        <Tabs.Screen name="verwaltung" options={{ title: "Verwaltung" }} />
      </Tabs.Protected>
    </Tabs>
  );
}

const styles = StyleSheet.create({
  balken: { height: 4, width: 28, borderRadius: 2 },
});
