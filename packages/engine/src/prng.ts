/**
 * Générateur pseudo-aléatoire déterministe : xoshiro128** (D. Blackman et
 * S. Vigna, « Scrambled Linear Pseudorandom Number Generators », 2018).
 *
 * C'est la seule source d'aléa du moteur : la même graine produit toujours
 * la même suite, donc la même trace. Math.random() n'est jamais utilisé.
 */
export type PrngState = readonly [number, number, number, number];

function rotl(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

/** Finaliseur 32 bits « fmix32 » de MurmurHash3 : disperse les bits de la graine. */
function fmix32(value: number): number {
  let h = value >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const GOLDEN_RATIO_32 = 0x9e3779b9;

export class Prng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  private constructor(state: PrngState) {
    [this.s0, this.s1, this.s2, this.s3] = state;
    // L'état entièrement nul est le seul point fixe de xoshiro : il est exclu.
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** Graine entière 32 bits non signée (0 à 4 294 967 295). */
  static fromSeed(seed: number): Prng {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new RangeError(`graine invalide : ${String(seed)} (entier de 0 à 4294967295 attendu)`);
    }
    const words = [0, 1, 2, 3].map((index) => fmix32((seed + Math.imul(index + 1, GOLDEN_RATIO_32)) >>> 0));
    return new Prng(words as unknown as PrngState);
  }

  static fromState(state: PrngState): Prng {
    return new Prng(state.map((word) => word >>> 0) as unknown as PrngState);
  }

  state(): PrngState {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  /** Entier 32 bits non signé uniformément distribué. */
  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Entier uniforme dans [0, bound[ (rejet des valeurs biaisées). */
  nextInt(bound: number): number {
    if (!Number.isInteger(bound) || bound < 1 || bound > 0x100000000) {
      throw new RangeError(`borne invalide : ${String(bound)}`);
    }
    const limit = 0x100000000 - (0x100000000 % bound);
    for (;;) {
      const value = this.nextUint32();
      if (value < limit) return value % bound;
    }
  }
}
