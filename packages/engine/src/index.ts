/**
 * Point d'entrée public du moteur NetForge.
 *
 * Moteur à événements discrets : horloge virtuelle en nanosecondes, file
 * d'événements stable, générateur pseudo-aléatoire à graine, Ethernet,
 * VLAN, STP, ARP, IPv4, ICMP, routage statique, RIP, OSPF et BGP, VRRP, DHCP et DNS ; bilan optique et activation PON (statiques). Aucune dépendance au DOM ni à React.
 */
/** Version du moteur : change dès que la trace produite pour un même scénario peut changer. */
export const ENGINE_VERSION = "0.12.0";

export * from "./commands.js";
export * from "./evaluation.js";
export * from "./exercise.js";
export * from "./host.js";
export * from "./mac.js";
export * from "./optics.js";
export * from "./ospf.js";
export * from "./pon.js";
export * from "./parameters.js";
export * from "./pdu.js";
export * from "./prng.js";
export * from "./protocol.js";
export * from "./queue.js";
export * from "./routing.js";
export * from "./scenarios.js";
export * from "./simulation.js";
export * from "./time.js";
export * from "./trace.js";
export * from "./views.js";
