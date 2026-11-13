import { z } from "zod";
import { CATALOG_VERSION, DEVICE_MODEL_IDS } from "./catalog.js";
import { DHCP_LEASE_MAX, DHCP_LEASE_MIN } from "./dhcp.js";
import { DNS_MAX_RECORDS, normalizeDnsName } from "./dns.js";
import { BGP_AS_MAX, BGP_AS_MIN, BGP_MAX_NEIGHBORS, BGP_MAX_NETWORKS } from "./bgp.js";
import { OSPF_COST_MAX, OSPF_COST_MIN, OSPF_MODES, OSPF_PRIORITY_MAX, parseOspfArea } from "./ospf.js";
import { RIP_MODES } from "./rip.js";
import { isIpv4Address } from "./ipv4.js";
import { STP_PRIORITY_MAX, STP_PRIORITY_STEP } from "./stp.js";
import { VLAN_MAX, VLAN_MIN } from "./vlan.js";
import { VRID_MAX, VRID_MIN, VRRP_PRIORITY_MAX, VRRP_PRIORITY_MIN } from "./vrrp.js";

/**
 * Format d'échange .nfg.json, version 12 (v2 : routes statiques ; v3 : annotations ;
 * v4 : fibres optiques et pannes ; v5 : VLAN — ports de switch et sous-interfaces —,
 * STP par switch ; v6 : DHCP — plages des routeurs, adressage automatique des postes ;
 * v7 : DNS ; v8 : RIP ; v9 : OSPF en zone unique ; v10 : VRRP ; v11 : zones OSPF ; v12 : BGP).
 *
 * Contient uniquement les données persistantes du projet : métadonnées,
 * topologie, configurations et disposition. Jamais d'état d'exécution
 * (caches ARP/MAC, paquets en transit), de session ni de secret.
 */
export const NFG_FORMAT = "netforge-project";
export const CURRENT_SCHEMA_VERSION = 12;

/** Limites appliquées à tout document externe (import, stockage local). */
export const LIMITS = {
  maxImportBytes: 5 * 1024 * 1024,
  maxJsonDepth: 16,
  maxJsonNodes: 200_000,
  maxDevices: 500,
  maxLinks: 1000,
  maxProjectNameLength: 80,
  maxDescriptionLength: 2000,
  maxCoordinate: 1_000_000,
  maxStaticRoutes: 64,
  maxAnnotations: 200,
  maxAnnotationLength: 280,
  maxFaults: 100,
  /** Longueur d'une fibre, en mètres. */
  minFiberLength: 0.1,
  maxFiberLength: 100_000,
  /** Perte supplémentaire d'une panne, en dB. */
  minFaultLoss: 0.1,
  maxFaultLoss: 30,
} as const;

// Les noms réservés des objets JavaScript sont exclus : ces identifiants
// servent de clés d'objet (configurations, disposition).
export const idSchema = z
  .string()
  .regex(/^(?!(?:__proto__|constructor|prototype)$)[A-Za-z0-9_-]{1,64}$/, "identifiant invalide");

/** Nom d'équipement : utilisable plus tard dans la CLI et les explications. */
export const DEVICE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const deviceNameSchema = z.string().regex(DEVICE_NAME_PATTERN, "nom d'équipement invalide");

const portIdSchema = z.string().regex(/^[a-z]{1,8}\d{0,3}$/, "identifiant de port invalide");
/** Interface : port physique, ou sous-interface « port.vlan » d'un routeur (v6). */
const interfaceIdSchema = z.string().regex(/^[a-z]{1,8}\d{0,3}(?:\.\d{1,4})?$/, "identifiant d'interface invalide");
const ipv4AddressSchema = z.string().refine(isIpv4Address, "adresse IPv4 invalide");

export const ipv4InterfaceSchema = z.strictObject({
  address: ipv4AddressSchema,
  prefixLength: z.int().min(0).max(32),
});

const interfaceConfigSchema = z.strictObject({
  ipv4: ipv4InterfaceSchema.nullable(),
  /** Adressage automatique par DHCP (PC, v6) : adresse, masque et passerelle obtenus pendant la simulation. */
  dhcp: z.boolean(),
});

/** Plage d'un serveur DHCP de routeur (v6), rattachée à l'interface qui reçoit les demandes. */
const dhcpPoolSchema = z.strictObject({
  start: ipv4AddressSchema,
  end: ipv4AddressSchema,
  gateway: ipv4AddressSchema,
  leaseSeconds: z.int().min(DHCP_LEASE_MIN).max(DHCP_LEASE_MAX),
});

const vlanIdSchema = z.int().min(VLAN_MIN).max(VLAN_MAX);

/** Port de switch (v5) : accès dans un VLAN, ou trunk 802.1Q (VLAN natif sans étiquette, VLAN autorisés). */
const switchportSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("access"), vlan: vlanIdSchema }),
  z.strictObject({
    mode: z.literal("trunk"),
    nativeVlan: vlanIdSchema,
    allowedVlans: z.union([
      z.literal("all"),
      z
        .array(vlanIdSchema)
        .min(1)
        .max(VLAN_MAX)
        .refine((vlans) => vlans.every((vlan, index) => index === 0 || vlan > (vlans[index - 1] ?? 0)), "liste triée sans doublon"),
    ]),
  }),
]);

/** Route statique d'un routeur : réseau de destination et prochain saut. */
export const staticRouteSchema = z.strictObject({
  /** Adresse du réseau de destination (bits d'hôte à zéro). */
  destination: ipv4AddressSchema,
  prefixLength: z.int().min(0).max(32),
  nextHop: ipv4AddressSchema,
});

const deviceConfigSchema = z.strictObject({
  /** Configuration par interface (port ou sous-interface) ; une interface absente n'est pas configurée. */
  interfaces: z.record(interfaceIdSchema, interfaceConfigSchema),
  /** Passerelle par défaut (PC uniquement). */
  defaultGateway: ipv4AddressSchema.nullable(),
  /** Routes statiques (routeurs uniquement), dans l'ordre de saisie. */
  staticRoutes: z.array(staticRouteSchema).max(LIMITS.maxStaticRoutes),
  /** Ports de switch (switches uniquement) ; un port absent est en accès dans le VLAN 1. */
  switchports: z.record(portIdSchema, switchportSchema),
  /** Spanning Tree 802.1D (switches uniquement ; null ailleurs) : activation et priorité du pont. */
  stp: z
    .strictObject({
      enabled: z.boolean(),
      priority: z
        .int()
        .min(0)
        .max(STP_PRIORITY_MAX)
        .refine((priority) => priority % STP_PRIORITY_STEP === 0, "multiple de 4096"),
    })
    .nullable(),
  /** Serveur DHCP (routeurs uniquement) : une plage par interface ; vide sans serveur. */
  dhcpPools: z.record(interfaceIdSchema, dhcpPoolSchema),
  /** Résolveur (PC uniquement) : serveur DNS saisi manuellement, y compris en adressage automatique. */
  dnsServer: ipv4AddressSchema.nullable(),
  /** Service DNS (routeurs uniquement) : null désactivé ; sinon enregistrements A par nom canonique. */
  dnsRecords: z
    .record(
      z.string().refine((name) => normalizeDnsName(name) === name, "nom DNS canonique"),
      ipv4AddressSchema,
    )
    .refine((records) => Object.keys(records).length <= DNS_MAX_RECORDS, "trop d'enregistrements")
    .nullable(),
  /** RIP version 2 (routeurs uniquement) : mode de chaque interface participante ; vide sans RIP. */
  ripInterfaces: z.record(interfaceIdSchema, z.enum(RIP_MODES)),
  /** OSPF version 2, zone 0 (routeurs uniquement) : mode, coût et priorité de chaque interface participante ; vide sans OSPF. */
  ospfInterfaces: z.record(
    interfaceIdSchema,
    z.strictObject({
      mode: z.enum(OSPF_MODES),
      cost: z.int().min(OSPF_COST_MIN).max(OSPF_COST_MAX),
      priority: z.int().min(0).max(OSPF_PRIORITY_MAX),
      /** Zone (v11), en notation pointée canonique ; « 0.0.0.0 » : dorsale. */
      area: z.string().refine((area) => parseOspfArea(area) === area, "zone OSPF en notation pointée"),
    }),
  ),
  /** VRRP version 3 (routeurs uniquement) : un groupe par interface (VRID, adresse virtuelle, priorité, préemption) ; vide sans VRRP. */
  vrrpGroups: z.record(
    interfaceIdSchema,
    z.strictObject({
      vrid: z.int().min(VRID_MIN).max(VRID_MAX),
      address: ipv4AddressSchema,
      priority: z.int().min(VRRP_PRIORITY_MIN).max(VRRP_PRIORITY_MAX),
      preempt: z.boolean(),
    }),
  ),
  /** BGP-4 (routeurs uniquement, v12) : AS, voisins externes et réseaux annoncés ; null sans BGP. */
  bgp: z
    .strictObject({
      as: z.int().min(BGP_AS_MIN).max(BGP_AS_MAX),
      neighbors: z.array(z.strictObject({ address: ipv4AddressSchema, remoteAs: z.int().min(BGP_AS_MIN).max(BGP_AS_MAX) })).max(BGP_MAX_NEIGHBORS),
      networks: z.array(z.strictObject({ address: ipv4AddressSchema, prefixLength: z.int().min(0).max(32) })).max(BGP_MAX_NETWORKS),
    })
    .nullable(),
});

const deviceSchema = z.strictObject({
  id: idSchema,
  model: z.enum(DEVICE_MODEL_IDS),
  name: deviceNameSchema,
});

const endpointSchema = z.strictObject({
  deviceId: idSchema,
  portId: portIdSchema,
});

export const FIBER_TYPES = ["G.652.D", "G.657.A2"] as const;
export const FIBER_CABLES = ["distribution", "short"] as const;

/**
 * Propriétés d'une fibre (lien entre deux ports fibre) : longueur en mètres,
 * type de fibre et catégorie du câble : « distribution » (câble de transport
 * ou de distribution) ou « short » (câble court : jarretière, câble intérieur,
 * câble de raccordement d'abonné). null pour un câble cuivre.
 */
const fiberSchema = z.strictObject({
  length: z.number().min(LIMITS.minFiberLength).max(LIMITS.maxFiberLength),
  type: z.enum(FIBER_TYPES),
  cable: z.enum(FIBER_CABLES),
});

const linkSchema = z.strictObject({
  id: idSchema,
  endpoints: z.tuple([endpointSchema, endpointSchema]),
  fiber: fiberSchema.nullable(),
});

export const FAULT_KINDS = ["cut", "bend", "dirty-connector", "bad-splice", "polish-mismatch"] as const;

/**
 * Panne injectée par le formateur : une perte supplémentaire (distincte de la
 * perte nominale du composant), une coupure ou une incompatibilité de
 * raccordement. Visible dans le projet ; masquée pendant un exercice.
 */
const faultSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(FAULT_KINDS),
  target: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("link"), linkId: idSchema }),
    z.strictObject({ kind: z.literal("port"), deviceId: idSchema, portId: portIdSchema }),
  ]),
  /** Perte supplémentaire en dB (courbure, connecteur sale, épissure défectueuse) ; null sinon. */
  extraLoss: z.number().min(LIMITS.minFaultLoss).max(LIMITS.maxFaultLoss).nullable(),
});

const coordinateSchema = z.number().min(-LIMITS.maxCoordinate).max(LIMITS.maxCoordinate);

export const nfgDocumentSchema = z.strictObject({
  format: z.literal(NFG_FORMAT),
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  models: z.strictObject({ catalog: z.literal(CATALOG_VERSION) }),
  metadata: z.strictObject({
    id: idSchema,
    name: z.string().trim().min(1).max(LIMITS.maxProjectNameLength),
    description: z.string().max(LIMITS.maxDescriptionLength),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
  topology: z.strictObject({
    devices: z.array(deviceSchema).max(LIMITS.maxDevices),
    links: z.array(linkSchema).max(LIMITS.maxLinks),
  }),
  configurations: z.record(idSchema, deviceConfigSchema),
  faults: z.array(faultSchema).max(LIMITS.maxFaults),
  layout: z.strictObject({
    devices: z.record(idSchema, z.strictObject({ x: coordinateSchema, y: coordinateSchema })),
    /** Annotations libres : du texte affiché sur le canevas, sans effet sur le réseau. */
    annotations: z
      .array(
        z.strictObject({
          id: idSchema,
          text: z.string().trim().min(1).max(LIMITS.maxAnnotationLength),
          x: coordinateSchema,
          y: coordinateSchema,
        }),
      )
      .max(LIMITS.maxAnnotations),
  }),
});

export type NfgDocument = z.infer<typeof nfgDocumentSchema>;
export type Device = NfgDocument["topology"]["devices"][number];
export type Link = NfgDocument["topology"]["links"][number];
export type LinkEndpoint = Link["endpoints"][number];
export type DeviceConfig = NfgDocument["configurations"][string];
export type StaticRoute = DeviceConfig["staticRoutes"][number];
export type Position = NfgDocument["layout"]["devices"][string];
export type Annotation = NfgDocument["layout"]["annotations"][number];
export type Fiber = NonNullable<Link["fiber"]>;
export type Fault = NfgDocument["faults"][number];
export type FaultKind = Fault["kind"];
export type FaultTarget = Fault["target"];
