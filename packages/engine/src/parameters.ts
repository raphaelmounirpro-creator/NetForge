import { fromMicroseconds, fromMilliseconds, fromSeconds, type SimTime } from "./time.js";

/**
 * Paramètres pédagogiques du moteur. Les valeurs par défaut sont fixes et
 * documentées (docs/protocols/) : les systèmes réels varient, parfois avec
 * une part d'aléa, mais une valeur fixe rend les expirations prévisibles.
 */
export interface SimulationParameters {
  /** Durée de vie d'une entrée ARP sur un PC. */
  readonly hostArpLifetime: SimTime;
  /** Durée de vie d'une entrée ARP sur un routeur. */
  readonly routerArpLifetime: SimTime;
  /** Vieillissement d'une entrée de la table MAC d'un switch (IEEE 802.1D : 300 s). */
  readonly macAgingTime: SimTime;
  /** Intervalle entre deux requêtes ARP sans réponse. */
  readonly arpRetryInterval: SimTime;
  /** Nombre total de requêtes ARP avant abandon. */
  readonly arpMaxAttempts: number;
  /** Paquets mis en attente d'une résolution ARP (au-delà : abandon). */
  readonly arpQueueLimit: number;
  /** Délai de propagation forfaitaire d'un câble (longueur non modélisée). */
  readonly propagationDelay: SimTime;
  /** Délai de traitement avant réémission, par type d'équipement. */
  readonly switchLatency: SimTime;
  readonly routerLatency: SimTime;
  readonly hostLatency: SimTime;
  /** TTL initial des paquets émis. */
  readonly hostInitialTtl: number;
  readonly routerInitialTtl: number;
  /** STP : durée de chacun des états d'écoute et d'apprentissage (Forward Delay, 15 s par défaut). */
  readonly stpForwardDelay: SimTime;
  /** DHCP : attente avant la première retransmission (4 s), doublée ensuite (RFC 2131 §4.1, sans tirage aléatoire). */
  readonly dhcpRetryTimeout: SimTime;
  /** DHCP : émissions d'un même message avant abandon (4 : à 0, 4, 12 puis 28 s ; abandon à 60 s). */
  readonly dhcpMaxAttempts: number;
  readonly limits: SimulationLimits;
}

/** Limites d'exécution : un dépassement interrompt proprement la simulation. */
export interface SimulationLimits {
  /** Événements en attente au-delà desquels la simulation s'interrompt. */
  readonly maxPendingEvents: number;
  /** Événements traités au total depuis le chargement ou la réinitialisation. */
  readonly maxEvents: number;
  /** Sessions ping simultanées. */
  readonly maxPingSessions: number;
}

export const DEFAULT_LIMITS: SimulationLimits = {
  maxPendingEvents: 100_000,
  maxEvents: 2_000_000,
  maxPingSessions: 16,
};

export const DEFAULT_PARAMETERS: SimulationParameters = {
  hostArpLifetime: fromSeconds(60),
  routerArpLifetime: fromSeconds(4 * 60 * 60),
  macAgingTime: fromSeconds(300),
  arpRetryInterval: fromSeconds(1),
  arpMaxAttempts: 3,
  arpQueueLimit: 3,
  propagationDelay: 500,
  switchLatency: fromMicroseconds(2),
  routerLatency: fromMicroseconds(10),
  hostLatency: fromMicroseconds(10),
  hostInitialTtl: 64,
  routerInitialTtl: 255,
  stpForwardDelay: 15_000_000_000,
  dhcpRetryTimeout: fromSeconds(4),
  dhcpMaxAttempts: 4,
  limits: DEFAULT_LIMITS,
};

/** Valeurs par défaut d'un ping (proches de l'outil ping de Windows). */
export const PING_DEFAULTS = {
  count: 4,
  interval: fromSeconds(1),
  timeout: fromMilliseconds(4000),
  dataLength: 32,
  maxCount: 20,
} as const;
