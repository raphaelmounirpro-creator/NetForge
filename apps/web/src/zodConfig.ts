import { z } from "zod";

/*
 * À importer en premier dans chaque point d'entrée (page et Worker), avant tout
 * schéma. La politique de contenu interdit eval (security-headers.json) ; sans ce
 * réglage, Zod 4 sonde `new Function` à la construction de ses schémas d'objet :
 * la sonde échoue sans effet mais déclenche une violation « script-src eval »
 * à chaque chargement (constaté en production le 2026-11-14). La compilation
 * des schémas ne pouvant jamais s'activer ici, autant ne pas la tenter.
 */
z.config({ jitless: true });
