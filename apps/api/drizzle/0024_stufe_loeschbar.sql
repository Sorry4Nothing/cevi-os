-- Eine Stufe ohne Kinder und Leitung lässt sich löschen; die Route prüft das, die Fremdschlüssel (RESTRICT) sichern es
GRANT DELETE ON stufe TO cevi_os_api;
