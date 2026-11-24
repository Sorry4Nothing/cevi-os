// Ereignisse des Lagers im Arbeitsbereich (#672): GET /api/v1/lager/{id}/ereignisse ist ein Event-Stream (SSE). Er meldet nur Folgenummer und Objekttypen, nie Inhalte; der Rahmen zeigt daraufhin den Hinweis «Es gibt Neues» mit dem Knopf «Aktualisieren». Kein Takt, kein Polling. Eine Verbindung je Lager: Sie bleibt über die Module des Lagers bestehen und endet, sobald die Person das Lager verlässt.

let offen = null; // { id, quelle, beiNeues }

function schliesse() {
  offen?.quelle.close();
  offen = null;
}

function beiAdresse() {
  if (offen && !location.hash.startsWith(`#lager/lager/${offen.id}`))
    schliesse();
}

// beiNeues(objekttypen) läuft bei jeder Meldung «aenderung» (nicht bei der ersten Meldung «bereit»)
export function verfolge(id, beiNeues) {
  if (!window.EventSource) return;
  if (offen?.id === id) {
    offen.beiNeues = beiNeues;
    return;
  }
  schliesse();
  const quelle = new window.EventSource(`/api/v1/lager/${id}/ereignisse`, {
    withCredentials: true,
  });
  const neu = { id, quelle, beiNeues };
  offen = neu;
  const lies = (e) => {
    try {
      return JSON.parse(e.data);
    } catch {
      return {};
    }
  };
  quelle.addEventListener("aenderung", (e) =>
    neu.beiNeues(lies(e).objekttypen ?? []),
  );
  // Rolle oder Rechte haben sich geändert, oder die Folgenummer liegt in der Zukunft: Der Hinweis lädt alles neu
  quelle.addEventListener("neu-laden", () => neu.beiNeues([]));
  quelle.addEventListener("ende", () => {
    // Der Server beendet die Verbindung bewusst (Rechte geändert); der Browser verbindet von selbst neu
    neu.beiNeues([]);
  });
}

window.addEventListener("hashchange", beiAdresse);
