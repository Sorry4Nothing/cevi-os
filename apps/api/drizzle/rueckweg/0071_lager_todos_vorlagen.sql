-- Rückweg zu 0071_lager_todos_vorlagen (#376), als Besitzer der Datenbank in einer Transaktion ausführen:
--   psql -1 -f rueckweg/0071_lager_todos_vorlagen.sql
-- Danach den Code auf den Stand vor 0071 zurückstellen (ohne private To-dos und Vorlagen).
-- Es gehen alle privaten To-dos und alle Vorlagen verloren; Aufgaben und Packlisten-Punkte, die aus einer Vorlage entstanden sind, bleiben.
DROP TABLE "vorlage";
DROP TABLE "todo_privat";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "id" = (SELECT max("id") FROM "drizzle"."__drizzle_migrations");
