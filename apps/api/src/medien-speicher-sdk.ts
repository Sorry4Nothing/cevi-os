import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Medienspeicher } from "./medien-speicher.js";

// Der kleinste tragfähige Client für S3-kompatible Anbieter: das offizielle SDK, nur das Paket für S3
export function erstelleMedienspeicher({
  endpunkt,
  region,
  bucket,
  zugangsschluessel,
  geheimschluessel,
  pfadstil,
}: {
  endpunkt: string;
  region: string;
  bucket: string;
  zugangsschluessel: string;
  geheimschluessel: string;
  pfadstil: boolean;
}): Medienspeicher {
  const client = new S3Client({
    endpoint: endpunkt,
    region,
    forcePathStyle: pfadstil,
    credentials: {
      accessKeyId: zugangsschluessel,
      secretAccessKey: geheimschluessel,
    },
    // Das SDK fügt sonst jeder Anfrage eine Prüfsumme an, die nicht jeder S3-kompatible Anbieter kennt
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return {
    async ablegen(inhalt, typ) {
      const schluessel = randomUUID();
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: schluessel,
          Body: inhalt,
          ContentType: typ,
        }),
      );
      return schluessel;
    },
    async holen(schluessel) {
      const antwort = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: schluessel }),
      );
      if (!antwort.Body) throw new Error("Leere Antwort des Speichers");
      return antwort.Body.transformToByteArray();
    },
    async loeschen(schluessel) {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: schluessel }),
      );
    },
  };
}
