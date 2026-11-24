// Veralteter Alias (#730): «admin:anlegen» heisst jetzt «konto:anlegen --rolle abteilungsleitung». Die Warnung geht auf stderr, die Ausgabe auf stdout bleibt die von konto:anlegen. Ein eigenes --rolle der Eingabe gilt nicht: Der Alias legt immer die Abteilungsleitung an
console.error(
  "Warnung: «admin:anlegen» ist veraltet. Nimm «konto:anlegen --rolle abteilungsleitung».",
);
process.argv.push("--rolle", "abteilungsleitung");
await import("./konto-anlegen.js");
