import {
  PROTOCOL_VERSION,
  workerMessageEnvelopeSchema,
  type HostErrorCode,
  type SimRequestBody,
  type TraceParams,
  type UpdateMessage,
  type WorkerMessage,
} from "@netforge/engine";
import type { Issue } from "@netforge/project";

/** Ce que le client attend d'un Worker (remplaçable par un double en test). */
export interface WorkerPort {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type Reply =
  | { readonly ok: true; readonly sessionId: string | null }
  | { readonly ok: false; readonly code: HostErrorCode; readonly params: TraceParams; readonly issues: readonly Issue[] };

export interface ClientHandlers {
  onUpdate: (update: UpdateMessage) => void;
  /** Worker en échec ou message illisible : l'interface propose de réinitialiser. */
  onFailure: () => void;
}

/**
 * Client du moteur exécuté dans un Web Worker : enveloppe versionnée,
 * identifiants de corrélation, une promesse par requête résolue par
 * l'accusé ou l'erreur correspondants. Le Worker est créé à la demande.
 */
export class SimulationClient {
  private worker: WorkerPort | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, (reply: Reply) => void>();

  constructor(
    private readonly createWorker: () => WorkerPort,
    private readonly handlers: ClientHandlers,
  ) {}

  request(body: SimRequestBody): Promise<Reply> {
    const worker = this.ensureWorker();
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<Reply>((resolve) => {
      this.pending.set(id, resolve);
      worker.postMessage({ v: PROTOCOL_VERSION, id, ...body });
    });
  }

  /** Arrête le Worker : les requêtes en attente sont résolues en échec. */
  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.failPending();
  }

  private ensureWorker(): WorkerPort {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = (event) => {
      this.receive(event.data);
    };
    worker.onerror = () => {
      this.failPending();
      this.handlers.onFailure();
    };
    this.worker = worker;
    return worker;
  }

  private failPending(): void {
    for (const resolve of this.pending.values()) resolve({ ok: false, code: "sim.not-loaded", params: {}, issues: [] });
    this.pending.clear();
  }

  private receive(data: unknown): void {
    if (!workerMessageEnvelopeSchema.safeParse(data).success) {
      this.handlers.onFailure();
      return;
    }
    const message = data as WorkerMessage;
    if (message.type === "update") {
      this.handlers.onUpdate(message);
      return;
    }
    if (message.id === null) {
      this.handlers.onFailure();
      return;
    }
    const resolve = this.pending.get(message.id);
    if (!resolve) return;
    this.pending.delete(message.id);
    resolve(
      message.type === "ack"
        ? { ok: true, sessionId: message.sessionId }
        : { ok: false, code: message.code, params: message.params, issues: message.issues },
    );
  }
}
