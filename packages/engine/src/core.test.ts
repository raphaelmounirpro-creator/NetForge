import { describe, expect, it } from "vitest";
import { assignMacs, BROADCAST_MAC } from "./mac.js";
import { frameBytes, type EthernetFrame } from "./pdu.js";
import { Prng } from "./prng.js";
import { EventQueue } from "./queue.js";

/** Implémentation de référence de xoshiro128** en BigInt, lisible et indépendante des astuces 32 bits. */
function referenceXoshiro(state: bigint[], count: number): number[] {
  const mask = 0xffffffffn;
  const rotl = (x: bigint, k: bigint) => ((x << k) | (x >> (32n - k))) & mask;
  const s = [...state];
  const out: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const [s0 = 0n, s1 = 0n, s2 = 0n, s3 = 0n] = s;
    out.push(Number((rotl((s1 * 5n) & mask, 7n) * 9n) & mask));
    const t = (s1 << 9n) & mask;
    const n2 = s2 ^ s0;
    const n3 = s3 ^ s1;
    const n1 = s1 ^ n2;
    const n0 = s0 ^ n3;
    s[0] = n0;
    s[1] = n1;
    s[2] = n2 ^ t;
    s[3] = rotl(n3, 11n);
  }
  return out;
}

describe("générateur pseudo-aléatoire", () => {
  it("suit l'algorithme xoshiro128** (référence BigInt)", () => {
    const prng = Prng.fromState([1, 2, 3, 4]);
    const values = Array.from({ length: 8 }, () => prng.nextUint32());
    expect(values).toEqual(referenceXoshiro([1n, 2n, 3n, 4n], 8));
  });

  it("donne la même suite pour la même graine et une autre pour une autre graine", () => {
    const draw = (seed: number) => {
      const prng = Prng.fromSeed(seed);
      return Array.from({ length: 16 }, () => prng.nextUint32());
    };
    expect(draw(42)).toEqual(draw(42));
    expect(draw(42)).not.toEqual(draw(43));
  });

  it("reprend exactement à partir d'un état sauvegardé", () => {
    const prng = Prng.fromSeed(9);
    prng.nextUint32();
    const copy = Prng.fromState(prng.state());
    expect(Array.from({ length: 5 }, () => copy.nextUint32())).toEqual(Array.from({ length: 5 }, () => prng.nextUint32()));
  });

  it("tire des entiers bornés uniformes", () => {
    const prng = Prng.fromSeed(5);
    const counts = [0, 0, 0, 0, 0, 0];
    for (let index = 0; index < 60_000; index += 1) {
      const value = prng.nextInt(6);
      counts[value] = (counts[value] ?? 0) + 1;
    }
    for (const count of counts) expect(Math.abs(count - 10_000)).toBeLessThan(400);
  });

  it("refuse une graine invalide", () => {
    expect(() => Prng.fromSeed(-1)).toThrow(RangeError);
    expect(() => Prng.fromSeed(2 ** 32)).toThrow(RangeError);
    expect(() => Prng.fromSeed(1.5)).toThrow(RangeError);
  });
});

describe("file d'événements", () => {
  it("sort par instant puis par ordre de programmation, comme un tri stable", () => {
    const queue = new EventQueue<string>();
    const prng = Prng.fromSeed(11);
    const items = Array.from({ length: 500 }, (_, seq) => ({ time: prng.nextInt(20), seq, value: `e${String(seq)}` }));
    for (const item of items) queue.push(item);
    const popped: string[] = [];
    for (let item = queue.pop(); item; item = queue.pop()) popped.push(item.value);
    const expected = [...items].sort((a, b) => a.time - b.time || a.seq - b.seq).map((item) => item.value);
    expect(popped).toEqual(expected);
    expect(queue.size).toBe(0);
  });
});

describe("adresses MAC", () => {
  it("attribue des adresses uniques, stables et administrées localement", () => {
    const keys = Array.from({ length: 2000 }, (_, index) => `device-${String(index)}/eth0`);
    const first = assignMacs(keys);
    const second = assignMacs([...keys].reverse());
    expect(new Set(first.values()).size).toBe(keys.length);
    expect([...first.entries()].sort()).toEqual([...second.entries()].sort());
    for (const mac of first.values()) {
      expect(mac).toMatch(/^02(:[0-9a-f]{2}){5}$/);
      expect(mac).not.toBe(BROADCAST_MAC);
    }
  });
});

describe("tailles de trame", () => {
  it("complète une trame ARP au minimum Ethernet et compte l'écho ICMP", () => {
    const arp: EthernetFrame = {
      kind: "ethernet",
      source: "02:00:00:00:00:01",
      destination: BROADCAST_MAC,
      payload: { kind: "arp", operation: "request", senderMac: "02:00:00:00:00:01", senderIp: "10.0.0.1", targetMac: "00:00:00:00:00:00", targetIp: "10.0.0.2" },
    };
    // 14 + 28 + 4 = 46 octets, complétés à 64.
    expect(frameBytes(arp)).toBe(64);
    const echo: EthernetFrame = {
      ...arp,
      payload: {
        kind: "ipv4",
        source: "10.0.0.1",
        destination: "10.0.0.2",
        ttl: 64,
        identification: 1,
        payload: { kind: "icmp", type: "echo-request", identifier: 1, sequence: 1, dataLength: 32 },
      },
    };
    // 14 (Ethernet) + 20 (IPv4) + 8 (ICMP) + 32 (données) + 4 (FCS).
    expect(frameBytes(echo)).toBe(78);
  });
});
