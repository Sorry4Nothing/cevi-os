import { useColorScheme } from "react-native";

// Kontraste belegt in __tests__/kontrast.test.ts (Checkliste 5.5)
const hell = {
  hintergrund: "#FFFFFF",
  flaeche: "#F2F3F5",
  text: "#1A1C1E",
  textLeise: "#53575E",
  rand: "#71757C",
  akzent: "#0B57B8",
  aufAkzent: "#FFFFFF",
  fehler: "#B3261E",
  erfolg: "#17703A",
};

const dunkel: typeof hell = {
  hintergrund: "#121316",
  flaeche: "#1F2125",
  text: "#ECEDEF",
  textLeise: "#B9BCC2",
  rand: "#8B8F96",
  akzent: "#9DC1FF",
  aufAkzent: "#0A1F3D",
  fehler: "#FFB4AB",
  erfolg: "#7DD89A",
};

export const farben = { hell, dunkel };

export function useFarben() {
  return useColorScheme() === "dark" ? dunkel : hell;
}

// Grössen in pt bzw. dp auf der Systemschrift; sie wachsen mit der Schriftgrösse des Geräts
export const schrift = { titel: 28, text: 17, klein: 15 };

// 48 erfüllt 44 × 44 pt auf iOS und 48 × 48 dp auf Android (Checkliste 5.7)
export const masse = { ziel: 48, abstand: 16, luecke: 8, radius: 8 };
