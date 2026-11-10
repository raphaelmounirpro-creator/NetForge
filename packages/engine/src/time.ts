/**
 * Temps simulé du moteur NetForge.
 *
 * Unité interne unique : la nanoseconde, stockée dans un entier JavaScript
 * « sûr » (Number.isSafeInteger). Choix documenté dans docs/DECISIONS.md :
 * - la nanoseconde rend représentables les délais de sérialisation et de
 *   propagation sur des liens rapides (64 octets à 1 Gb/s = 512 ns) ;
 * - la borne Number.MAX_SAFE_INTEGER correspond à environ 104 jours simulés,
 *   ce qui couvre largement les temporisations pédagogiques (ARP, MAC, baux).
 *
 * Le temps simulé est indépendant de l'horloge réelle : aucune fonction de ce
 * module ne lit Date.now().
 */
export type SimTime = number;

export const NANOSECONDS_PER_MICROSECOND = 1_000;
export const NANOSECONDS_PER_MILLISECOND = 1_000_000;
export const NANOSECONDS_PER_SECOND = 1_000_000_000;

/** Plus grand instant simulé représentable sans perte de précision. */
export const MAX_SIM_TIME: SimTime = Number.MAX_SAFE_INTEGER;

/** Vrai si la valeur est un instant ou une durée simulée valide. */
export function isSimTime(value: number): value is SimTime {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Lève une RangeError explicite si la valeur n'est pas un temps simulé valide. */
export function assertSimTime(value: number, label = "temps simulé"): SimTime {
  if (!isSimTime(value)) {
    throw new RangeError(
      `${label} invalide : ${String(value)} (attendu : entier de nanosecondes entre 0 et ${String(MAX_SIM_TIME)})`,
    );
  }
  return value;
}

/** Convertit une durée exprimée dans une unité externe, arrondie à la nanoseconde. */
function fromUnit(amount: number, nanosecondsPerUnit: number, label: string): SimTime {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`${label} invalide : ${String(amount)}`);
  }
  return assertSimTime(Math.round(amount * nanosecondsPerUnit), label);
}

export function fromMicroseconds(microseconds: number): SimTime {
  return fromUnit(microseconds, NANOSECONDS_PER_MICROSECOND, "durée en microsecondes");
}

export function fromMilliseconds(milliseconds: number): SimTime {
  return fromUnit(milliseconds, NANOSECONDS_PER_MILLISECOND, "durée en millisecondes");
}

export function fromSeconds(seconds: number): SimTime {
  return fromUnit(seconds, NANOSECONDS_PER_SECOND, "durée en secondes");
}

/** Conversion destinée à l'affichage : le résultat peut être fractionnaire. */
export function toMilliseconds(time: SimTime): number {
  return time / NANOSECONDS_PER_MILLISECOND;
}

/** Conversion destinée à l'affichage : le résultat peut être fractionnaire. */
export function toSeconds(time: SimTime): number {
  return time / NANOSECONDS_PER_SECOND;
}
