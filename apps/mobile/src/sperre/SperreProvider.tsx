import {
  getEnrolledLevelAsync,
  type SecurityLevel,
} from "expo-local-authentication";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";

import { SPERRE_SCHLUESSEL, speicher } from "../speicher";

type Wert = {
  niveau: SecurityLevel | undefined;
  aus: boolean;
  // Erst der Secure Store, dann der Zustand: Ein Schreibfehler lässt den Schalter stehen
  setzeAus: (aus: boolean) => Promise<void>;
  pruefeNiveau: () => void;
};

const Kontext = createContext<Wert | undefined>(undefined);

export function useSperre() {
  const wert = use(Kontext);
  if (!wert) throw new Error("useSperre braucht den SperreProvider");
  return wert;
}

// Ein Zustand für die Sperrschicht und den Schalter im Profil
export function SperreProvider({
  anfangsAus,
  children,
}: {
  anfangsAus: boolean;
  children: ReactNode;
}) {
  const [niveau, setNiveau] = useState<SecurityLevel>();
  const [aus, setAus] = useState(anfangsAus);

  // Bei einem Fehler bleibt der letzte Wert stehen; beim Start heisst das: unbekannt, also zu
  const pruefeNiveau = useCallback(() => {
    getEnrolledLevelAsync().then(setNiveau, () => {});
  }, []);

  // Beim Start und bei jedem «active»: Der Geräte-Code kann in den Einstellungen dazugekommen oder weggefallen sein
  useEffect(() => {
    pruefeNiveau();
    const abo = AppState.addEventListener("change", (status) => {
      if (status === "active") pruefeNiveau();
    });
    return () => abo.remove();
  }, [pruefeNiveau]);

  async function setzeAus(neu: boolean) {
    if (neu) await speicher.setItemAsync(SPERRE_SCHLUESSEL, "aus");
    else await speicher.deleteItemAsync(SPERRE_SCHLUESSEL);
    setAus(neu);
  }

  return (
    <Kontext value={{ niveau, aus, setzeAus, pruefeNiveau }}>
      {children}
    </Kontext>
  );
}
