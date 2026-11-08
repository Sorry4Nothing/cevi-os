-- Die Abteilung führt nur Samstage (#314): Programme ohne Samstag unter ihren Tagen (Schweizer Zeit) entfallen samt Anmeldungen
DELETE FROM "programm" p
WHERE NOT EXISTS (
  SELECT 1
  FROM generate_series(
    CASE WHEN p."ganztaegig" THEN p."tag_von"
         ELSE (p."beginn" AT TIME ZONE 'Europe/Zurich')::date END,
    CASE WHEN p."ganztaegig" THEN p."tag_bis"
         ELSE greatest(
           (p."beginn" AT TIME ZONE 'Europe/Zurich')::date,
           ((p."ende" - interval '1 millisecond') AT TIME ZONE 'Europe/Zurich')::date
         ) END,
    interval '1 day'
  ) AS tag
  WHERE extract(dow FROM tag) = 6
);
