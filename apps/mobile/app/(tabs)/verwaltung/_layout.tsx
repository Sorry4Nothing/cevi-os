import { Stack } from "expo-router";

// Ohne Animation, damit «Bewegung reduzieren» für alle gilt (Checkliste 5.9); die Überschrift stellt Bildschirm
export default function VerwaltungLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: "none" }} />;
}
