import { AccessibilityInfo, type HostInstance } from "react-native";

// Setzt den Fokus von Screenreader und Schalter: nach Navigation, Dialog oder Fehler (Checkliste 6.1–6.3)
export function fokussieren(element: HostInstance | null) {
  if (element) AccessibilityInfo.sendAccessibilityEvent(element, "focus");
}
