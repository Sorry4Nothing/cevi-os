import { Stack } from "expo-router";

// Der Anker liegt unter einem Ziel, das ein Push aus dem Kaltstart öffnet: «Zurück» landet auf der Liste
export const unstable_settings = { anchor: "index" };

// animation "none": kein Gleiten, auch ohne «Bewegung reduzieren» (Checkliste 5.9)
export default function ProgrammeLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: "none" }} />;
}
