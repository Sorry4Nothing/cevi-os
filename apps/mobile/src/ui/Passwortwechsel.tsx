import { useState } from "react";

import { fehlertext, KEIN_NETZ, passwortFehlerfeld } from "../api/fehlertexte";
import { Ansage } from "./Ansage";
import { Button } from "./Button";
import { Fehlermeldung } from "./Fehlermeldung";
import { Passwortfeld } from "./Passwortfeld";
import { schrift, useFarben } from "./tokens";

type Props = {
  // «Startpasswort» beim Pflichtwechsel, «Bisheriges Passwort» im Profil
  bisherigesLabel: string;
  knopfTitel: string;
  senden: (
    bisheriges: string,
    neues: string,
  ) => Promise<{ code?: string | undefined } | null>;
  onErfolg?: () => void;
  // Bleibt stehen, bis die nächste Eingabe beginnt (Checkliste 8.2)
  erfolgText?: string;
};

// Beide Passwortwechsel teilen Felder, Regeln und Fehlertexte; nur ein Fehler aufs Mal
export function Passwortwechsel({
  bisherigesLabel,
  knopfTitel,
  senden,
  onErfolg,
  erfolgText,
}: Props) {
  const farben = useFarben();
  const [bisheriges, setBisheriges] = useState("");
  const [neues, setNeues] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [erfolg, setErfolg] = useState(false);
  const [fehler, setFehler] = useState<{
    feld: "bisheriges" | "neues" | "allgemein";
    text: string;
  }>();

  async function absenden() {
    setFehler(undefined);
    setErfolg(false);
    setLaeuft(true);
    try {
      // Eingaben gehen wie getippt zur API; #15 normalisiert Startpasswörter auf dem Server
      const antwort = await senden(bisheriges, neues);
      if (antwort) {
        setFehler({
          feld: passwortFehlerfeld(antwort.code),
          text: fehlertext(antwort),
        });
        return;
      }
      setBisheriges("");
      setNeues("");
      setErfolg(true);
      onErfolg?.();
    } catch {
      setFehler({ feld: "allgemein", text: KEIN_NETZ });
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <>
      <Passwortfeld
        label={bisherigesLabel}
        value={bisheriges}
        onChangeText={setBisheriges}
        autoComplete="current-password"
        textContentType="password"
        fehler={fehler?.feld === "bisheriges" ? fehler.text : undefined}
      />
      <Passwortfeld
        label="Neues Passwort"
        value={neues}
        onChangeText={setNeues}
        autoComplete="new-password"
        textContentType="newPassword"
        passwordRules="minlength: 12;"
        fehler={fehler?.feld === "neues" ? fehler.text : undefined}
      />
      <Fehlermeldung
        text={fehler?.feld === "allgemein" ? fehler.text : undefined}
      />
      <Ansage
        text={erfolg ? erfolgText : undefined}
        stil={{ fontSize: schrift.text, color: farben.erfolg }}
      />
      {/* Während des Sendens ist nur der Knopf gesperrt, die Felder bleiben bearbeitbar */}
      <Button
        titel={knopfTitel}
        onPress={() => void absenden()}
        disabled={laeuft}
      />
    </>
  );
}
