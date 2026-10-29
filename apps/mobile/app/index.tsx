import { Text, useColorScheme, View } from "react-native";

export default function Start() {
  // Android zeigt im Dunkelmodus einen dunklen Hintergrund, die Schrift muss mitwechseln (Checkliste 5.5)
  const dunkel = useColorScheme() === "dark";

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text
        accessibilityRole="header"
        style={{ color: dunkel ? "#fff" : "#000" }}
      >
        Cevi OS
      </Text>
    </View>
  );
}
