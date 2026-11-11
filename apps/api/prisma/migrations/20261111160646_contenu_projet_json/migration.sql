-- Contenu des projets en « json » : le texte enregistré est conservé tel quel (ordre des clés compris),
-- donc un projet exporté depuis le compte est identique au fichier enregistré. « jsonb » réordonnait les clés.
-- AlterTable
ALTER TABLE "projects" ALTER COLUMN "content" SET DATA TYPE JSON;
