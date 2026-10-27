import { Stack } from "expo-router";

// animation "none": kein Gleiten, auch ohne «Bewegung reduzieren» (Checkliste 5.9)
export default function ProgrammeLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: "none" }} />;
}
