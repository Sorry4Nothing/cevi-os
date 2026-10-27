import { useRouter } from "expo-router";

import { usePersonen } from "../../../../src/api/personen";
import { Bildschirm } from "../../../../src/ui/Bildschirm";
import { Button } from "../../../../src/ui/Button";
import { Listenzeile } from "../../../../src/ui/Listenzeile";
import { statusText } from "../../../../src/verwaltung/status";

export default function Personen() {
  const router = useRouter();
  const personen = usePersonen();

  return (
    <Bildschirm
      titel="Personen"
      zustand={
        personen.data ? "bereit" : personen.isPending ? "laden" : "fehler"
      }
      onNeuLaden={() => void personen.refetch()}
      onZurueck={() => router.back()}
    >
      {personen.data?.personen.map((person) => (
        <Listenzeile
          key={person.id}
          titel={person.name}
          text={statusText(person)}
          onPress={() => router.push(`/verwaltung/personen/${person.id}`)}
        />
      ))}
      <Button
        titel="Person anlegen"
        onPress={() => router.push("/verwaltung/personen/neu")}
      />
    </Bildschirm>
  );
}
