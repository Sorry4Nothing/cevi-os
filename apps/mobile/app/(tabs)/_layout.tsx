import { Tabs } from "expo-router/js-tabs";
import { StyleSheet, View } from "react-native";

import { useFarben } from "../../src/ui/tokens";

// Kein tabBarAllowFontScaling: iOS skaliert Tab-Beschriftungen nie, zeigt aber den Large Content Viewer (Checkliste 5.10)
export default function TabLayout() {
  const farben = useFarben();

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
      <Tabs.Screen name="index" options={{ title: "Start" }} />
      <Tabs.Screen name="profil" options={{ title: "Profil" }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  balken: { height: 4, width: 28, borderRadius: 2 },
});
