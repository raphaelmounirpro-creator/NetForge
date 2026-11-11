import { z } from "zod";
import { CATALOG_VERSION, DEVICE_MODEL_IDS } from "./catalog.js";
import { isIpv4Address } from "./ipv4.js";

/**
 * Format d'échange .nfg.json, version 2 (version 1 + routes statiques).
 *
 * Contient uniquement les données persistantes du projet : métadonnées,
 * topologie, configurations et disposition. Jamais d'état d'exécution
 * (caches ARP/MAC, paquets en transit), de session ni de secret.
 */
export const NFG_FORMAT = "netforge-project";
export const CURRENT_SCHEMA_VERSION = 2;

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
} as const;

// Les noms réservés des objets JavaScript sont exclus : ces identifiants
// servent de clés d'objet (configurations, disposition).
export const idSchema = z
  .string()
  .regex(/^(?!(?:__proto__|constructor|prototype)$)[A-Za-z0-9_-]{1,64}$/, "identifiant invalide");

/** Nom d'équipement : utilisable plus tard dans la CLI et les explications. */
export const DEVICE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const deviceNameSchema = z.string().regex(DEVICE_NAME_PATTERN, "nom d'équipement invalide");

const portIdSchema = z.string().regex(/^[a-z]{1,8}\d{1,3}$/, "identifiant de port invalide");
const ipv4AddressSchema = z.string().refine(isIpv4Address, "adresse IPv4 invalide");

export const ipv4InterfaceSchema = z.strictObject({
  address: ipv4AddressSchema,
  prefixLength: z.int().min(0).max(32),
});

const interfaceConfigSchema = z.strictObject({
  ipv4: ipv4InterfaceSchema.nullable(),
});

/** Route statique d'un routeur : réseau de destination et prochain saut. */
export const staticRouteSchema = z.strictObject({
  /** Adresse du réseau de destination (bits d'hôte à zéro). */
  destination: ipv4AddressSchema,
  prefixLength: z.int().min(0).max(32),
  nextHop: ipv4AddressSchema,
});

const deviceConfigSchema = z.strictObject({
  /** Configuration par port ; un port absent n'est pas configuré. */
  interfaces: z.record(portIdSchema, interfaceConfigSchema),
  /** Passerelle par défaut (PC uniquement). */
  defaultGateway: ipv4AddressSchema.nullable(),
  /** Routes statiques (routeurs uniquement), dans l'ordre de saisie. */
  staticRoutes: z.array(staticRouteSchema).max(LIMITS.maxStaticRoutes),
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

const linkSchema = z.strictObject({
  id: idSchema,
  endpoints: z.tuple([endpointSchema, endpointSchema]),
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
  layout: z.strictObject({
    devices: z.record(idSchema, z.strictObject({ x: coordinateSchema, y: coordinateSchema })),
  }),
});

export type NfgDocument = z.infer<typeof nfgDocumentSchema>;
export type Device = NfgDocument["topology"]["devices"][number];
export type Link = NfgDocument["topology"]["links"][number];
export type LinkEndpoint = Link["endpoints"][number];
export type DeviceConfig = NfgDocument["configurations"][string];
export type StaticRoute = DeviceConfig["staticRoutes"][number];
export type Position = NfgDocument["layout"]["devices"][string];
