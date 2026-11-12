import { z } from "zod";
import { CATALOG_VERSION, DEVICE_MODEL_IDS } from "./catalog.js";
import { isIpv4Address } from "./ipv4.js";
import { VLAN_MAX, VLAN_MIN } from "./vlan.js";

/**
 * Format d'échange .nfg.json, version 5 (v2 : routes statiques ; v3 : annotations ;
 * v4 : fibres optiques et pannes ; v5 : VLAN — ports de switch et sous-interfaces).
 *
 * Contient uniquement les données persistantes du projet : métadonnées,
 * topologie, configurations et disposition. Jamais d'état d'exécution
 * (caches ARP/MAC, paquets en transit), de session ni de secret.
 */
export const NFG_FORMAT = "netforge-project";
export const CURRENT_SCHEMA_VERSION = 5;

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
/** Interface : port physique, ou sous-interface « port.vlan » d'un routeur (v5). */
const interfaceIdSchema = z.string().regex(/^[a-z]{1,8}\d{0,3}(?:\.\d{1,4})?$/, "identifiant d'interface invalide");
const ipv4AddressSchema = z.string().refine(isIpv4Address, "adresse IPv4 invalide");

export const ipv4InterfaceSchema = z.strictObject({
  address: ipv4AddressSchema,
  prefixLength: z.int().min(0).max(32),
});

const interfaceConfigSchema = z.strictObject({
  ipv4: ipv4InterfaceSchema.nullable(),
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
