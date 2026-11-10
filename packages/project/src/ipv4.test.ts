import { describe, expect, it } from "vitest";
import {
  broadcastAddress,
  formatIpv4,
  networkAddress,
  networkCidr,
  parseIpv4,
  parsePrefixOrMask,
  prefixToMask,
  subnetsOverlap,
  unassignableReason,
} from "./ipv4.js";

describe("analyse IPv4", () => {
  it("lit la notation décimale pointée stricte", () => {
    expect(parseIpv4("192.168.1.10")).toBe(0xc0a8010a);
    expect(parseIpv4(" 10.0.0.1 ")).toBe(0x0a000001);
    expect(formatIpv4(0xc0a8010a)).toBe("192.168.1.10");
  });

  it("refuse les formes ambiguës ou incomplètes", () => {
    for (const bad of ["192.168.1", "192.168.1.256", "192.168.01.1", "1.2.3.4.5", "a.b.c.d", "", "1..2.3"]) {
      expect(parseIpv4(bad), bad).toBeNull();
    }
  });
});

describe("masques", () => {
  it("accepte préfixe et masque décimal", () => {
    expect(parsePrefixOrMask("24")).toBe(24);
    expect(parsePrefixOrMask("/30")).toBe(30);
    expect(parsePrefixOrMask("255.255.255.0")).toBe(24);
    expect(parsePrefixOrMask("255.255.255.252")).toBe(30);
    expect(parsePrefixOrMask("0.0.0.0")).toBe(0);
  });

  it("refuse un masque non contigu ou hors plage", () => {
    expect(parsePrefixOrMask("255.0.255.0")).toBeNull();
    expect(parsePrefixOrMask("33")).toBeNull();
    expect(parsePrefixOrMask("masque")).toBeNull();
  });

  it("convertit un préfixe en masque", () => {
    expect(prefixToMask(24)).toBe("255.255.255.0");
    expect(prefixToMask(20)).toBe("255.255.240.0");
    expect(prefixToMask(0)).toBe("0.0.0.0");
    expect(prefixToMask(32)).toBe("255.255.255.255");
  });
});

describe("réseaux", () => {
  it("calcule réseau et diffusion (référence calculée à la main)", () => {
    // 172.16.37.200/20 → réseau 172.16.32.0, diffusion 172.16.47.255
    const address = parseIpv4("172.16.37.200") ?? 0;
    expect(formatIpv4(networkAddress(address, 20))).toBe("172.16.32.0");
    expect(formatIpv4(broadcastAddress(address, 20))).toBe("172.16.47.255");
    expect(networkCidr({ address: "172.16.37.200", prefixLength: 20 })).toBe("172.16.32.0/20");
  });

  it("détecte le chevauchement de réseaux", () => {
    expect(subnetsOverlap({ address: "10.0.0.1", prefixLength: 16 }, { address: "10.0.5.1", prefixLength: 24 })).toBe(true);
    expect(subnetsOverlap({ address: "10.0.0.1", prefixLength: 24 }, { address: "10.0.1.1", prefixLength: 24 })).toBe(false);
  });

  it("identifie les adresses non attribuables à une interface", () => {
    expect(unassignableReason({ address: "192.168.1.0", prefixLength: 24 })).toBe("network-address");
    expect(unassignableReason({ address: "192.168.1.255", prefixLength: 24 })).toBe("broadcast-address");
    expect(unassignableReason({ address: "127.0.0.1", prefixLength: 8 })).toBe("loopback");
    expect(unassignableReason({ address: "224.0.0.5", prefixLength: 24 })).toBe("multicast");
    expect(unassignableReason({ address: "0.1.2.3", prefixLength: 8 })).toBe("this-network");
    expect(unassignableReason({ address: "250.1.1.1", prefixLength: 8 })).toBe("reserved");
    // /31 (liaison point à point) : les deux adresses sont attribuables.
    expect(unassignableReason({ address: "10.0.0.0", prefixLength: 31 })).toBeNull();
    expect(unassignableReason({ address: "192.168.1.10", prefixLength: 24 })).toBeNull();
  });
});
