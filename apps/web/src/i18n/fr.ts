/**
 * Textes de l'interface en français.
 *
 * Regroupés ici pour préparer une traduction future : les composants lisent
 * ces messages au lieu d'écrire le texte en dur. Une autre langue ajoutera un
 * fichier de même forme (type Messages) sans toucher aux composants.
 */
export const fr = {
  app: {
    name: "NetForge",
    homeLabel: "NetForge, accueil",
    tagline: "Laboratoire réseau et fibre optique",
  },
  theme: {
    switchToLight: "Passer au thème clair",
    switchToDark: "Passer au thème sombre",
  },
  home: {
    title: "Le socle de NetForge est en place",
    intro:
      "NetForge sera un laboratoire pédagogique pour construire une topologie, configurer les équipements et comprendre pourquoi un échange réseau réussit ou échoue.",
    honesty:
      "Aucune simulation n'est encore disponible. L'éditeur de topologie et le laboratoire sans compte arrivent en phase 1.",
  },
  services: {
    title: "État des services locaux",
    description:
      "Indicateur de développement. Le futur laboratoire invité fonctionnera sans l'API ni la base de données.",
    api: "API NestJS",
    database: "Base PostgreSQL",
    recheck: "Vérifier à nouveau",
    checking: "Vérification…",
    up: "Disponible",
    down: "Indisponible",
    unknown: "Non vérifiable sans l'API",
    lastChecked: "Dernière vérification",
  },
  roadmap: {
    title: "Prochaines étapes",
    current: "En cours",
    planned: "Prévu",
    steps: [
      { phase: "Phase 0", label: "Socle technique, documentation et intégration continue", current: true },
      { phase: "Phase 1", label: "Éditeur de topologie et sauvegarde locale sans compte", current: false },
      { phase: "Phase 2", label: "Moteur LAN (Ethernet, ARP, IPv4, ICMP) puis routage statique", current: false },
      { phase: "Phase 3", label: "Pas à pas, explications, CLI et premier exercice", current: false },
      { phase: "Phase 4", label: "Premier laboratoire FTTH : bilan optique et photomètre", current: false },
    ],
  },
  footer: {
    engine: "Moteur",
  },
} as const;

export type Messages = typeof fr;
