"use client";

/** Page-side handle to the eERC worker. Also answers the worker's wallet relay requests. */
import { config } from "@/config";
import type { PythiaWalletClient } from "@/lib/wallet";

export type Progress = (stage: string, detail?: unknown) => void;

export interface WorkerContext {
  address: `0x${string}`;
  decryptionKey: string;
  walletClient: PythiaWalletClient;
}

export class EercWorker {
  private worker: Worker;
  private seq = 1;
  private pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void; onProgress?: Progress }>();
  private wallet: PythiaWalletClient | null = null;

  constructor() {
    this.worker = new Worker(new URL("./eerc.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent) => this.onMessage(ev.data);
    this.worker.onerror = (ev) => {
      const err = new Error(ev.message || "worker crashed");
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  private async onMessage(m: { type: string; id?: number; rid?: number; kind?: string; args?: unknown; stage?: string; detail?: unknown; value?: never; message?: string }) {
    if (m.type === "relay") {
      try {
        if (!this.wallet) throw new Error("wallet not available");
        const value =
          m.kind === "writeContract"
            ? await this.wallet.writeContract(m.args as never)
            : await this.wallet.signMessage({ message: m.args as string });
        this.worker.postMessage({ type: "relayResult", rid: m.rid, value });
      } catch (e) {
        this.worker.postMessage({ type: "relayResult", rid: m.rid, error: (e as Error).message ?? String(e) });
      }
      return;
    }
    const p = this.pending.get(m.id!);
    if (!p) return;
    if (m.type === "progress") p.onProgress?.(m.stage!, m.detail);
    else if (m.type === "result") {
      this.pending.delete(m.id!);
      p.resolve(m.value as never);
    } else if (m.type === "error") {
      this.pending.delete(m.id!);
      p.reject(new Error(m.message));
    }
  }

  call<T>(type: string, payload?: unknown, onProgress?: Progress): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this.seq++;
      this.pending.set(id, { resolve: resolve as never, reject, onProgress });
      this.worker.postMessage({ id, type, payload });
    });
  }

  /** (Re)configure the worker for an account. Cheap; call before each flow. */
  async init(ctx: WorkerContext) {
    this.wallet = ctx.walletClient;
    await this.call("init", {
      rpcUrl: config.rpcUrl,
      addresses: { encryptedERC: config.addresses.encryptedERC, registrar: config.addresses.registrar, token: config.addresses.token },
      circuitsBaseUrl: `${window.location.origin}/circuits`,
      address: ctx.address,
      decryptionKey: ctx.decryptionKey,
    });
  }
}

let instance: EercWorker | null = null;
export function getEercWorker(): EercWorker {
  instance ??= new EercWorker();
  return instance;
}
