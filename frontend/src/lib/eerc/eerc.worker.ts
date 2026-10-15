/**
 * Web Worker that runs all heavy eERC work (zk proof generation, balance decryption, discrete-log
 * search) so the UI thread never freezes.
 *
 * The worker has no wallet. Anything that needs the user's wallet (sending a transaction, signing
 * the key-derivation message) is relayed to the page, which owns the wallet connection.
 */
import {
  DlpSolver,
  createEercClient,
  decodeTransferCalldata,
  decryptReceivedAmount,
  decryptSentAmount,
  extractFormattedKey,
  privateTransfer,
  readEncryptedBalance,
  register,
  type EercClient,
} from "@pythia/eerc-core";

interface WorkerScope {
  postMessage(m: unknown): void;
  onmessage: ((e: MessageEvent) => void) | null;
}
const scope = self as unknown as WorkerScope & { window?: unknown; document?: unknown };

// The eERC SDK picks its circuit-loading strategy by looking for window.document. Inside a worker
// there is none, so present a minimal stand-in; the SDK then fetches circuits by URL (browser path).
scope.window = self;
scope.document ??= {};

// The SDK logs "Proof generation took Xms"; capture it so the UI can report the real proof time.
let lastProofMs: number | null = null;
const origLog = console.log.bind(console);
console.log = (...a: unknown[]) => {
  const m = /Proof generation took ([\d.]+)ms/.exec(String(a.join(" ")));
  if (m) lastProofMs = Number(m[1]);
  origLog(...a);
};

interface InitPayload {
  rpcUrl: string;
  addresses: { encryptedERC: `0x${string}`; registrar: `0x${string}`; token: `0x${string}` };
  circuitsBaseUrl: string;
  address: `0x${string}`;
  decryptionKey: string;
}

let client: EercClient | null = null;
let formattedKey: bigint | null = null;
let solver: DlpSolver | null = null;

let relaySeq = 1;
const relays = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const relay = (kind: "writeContract" | "signMessage", args: unknown) =>
  new Promise<unknown>((resolve, reject) => {
    const rid = relaySeq++;
    relays.set(rid, { resolve, reject });
    scope.postMessage({ type: "relay", rid, kind, args });
  });

const progress = (reqId: number, stage: string, detail?: unknown) => scope.postMessage({ type: "progress", id: reqId, stage, detail });

function init(p: InitPayload, reqId: number) {
  // Minimal wallet: only what the SDK calls (writeContract + signMessage), both relayed to the page.
  const wallet = {
    account: { address: p.address },
    writeContract: async (args: unknown) => {
      progress(reqId, "wallet");
      return relay("writeContract", args);
    },
    signMessage: async ({ message }: { message: string }) => relay("signMessage", message),
  };
  client = createEercClient({
    walletClient: wallet as never,
    rpcUrl: p.rpcUrl,
    addresses: p.addresses,
    circuitsBaseUrl: p.circuitsBaseUrl,
    decryptionKey: p.decryptionKey,
  });
  formattedKey = null;
}

async function handle(id: number, type: string, payload: never) {
  switch (type) {
    case "init":
      init(payload, id);
      return true;

    case "register": {
      progress(id, "proof");
      const r = await register(client!);
      return { alreadyRegistered: r.alreadyRegistered, transactionHash: "transactionHash" in r ? r.transactionHash : null, proofMs: lastProofMs };
    }

    case "balance": {
      const b = await readEncryptedBalance(client!);
      return { tokenId: b.tokenId, total: b.total, decimals: b.decimals };
    }

    case "transfer": {
      const { to, amount } = payload as { to: string; amount: bigint };
      lastProofMs = null;
      progress(id, "proof");
      const r = await privateTransfer(client!, to, amount, {
        onSubmitted: (hash) => progress(id, "submitted", { hash }),
      });
      return { hash: r.transactionHash, proofMs: lastProofMs };
    }

    case "decrypt": {
      // Decrypt the caller's own transfers: kind "sent" uses the sender ciphertext (discrete log),
      // kind "received" uses the receiver ciphertext.
      const { items } = payload as { items: { key: string; kind: "sent" | "received"; data: string }[] };
      const out: { key: string; amount?: bigint; error?: string }[] = [];
      if (items.some((i) => i.kind === "sent")) {
        if (!formattedKey) {
          progress(id, "key");
          formattedKey = await extractFormattedKey(client!.eerc);
        }
        if (!solver) {
          progress(id, "table");
          solver = new DlpSolver();
        }
      }
      let done = 0;
      for (const it of items) {
        try {
          const tx = decodeTransferCalldata(it.data);
          if (!tx) throw new Error("not a direct transfer");
          const amount = it.kind === "sent" ? decryptSentAmount(client!.eerc, formattedKey!, tx, solver!) : decryptReceivedAmount(client!.eerc, tx);
          out.push({ key: it.key, amount });
        } catch (e) {
          out.push({ key: it.key, error: (e as Error).message });
        }
        progress(id, "decrypted", { done: ++done, total: items.length });
      }
      return out;
    }

    default:
      throw new Error(`unknown request ${type}`);
  }
}

scope.onmessage = async (ev: MessageEvent) => {
  const m = ev.data as { id?: number; type: string; payload?: never; rid?: number; value?: unknown; error?: string };
  if (m.type === "relayResult") {
    const r = relays.get(m.rid!);
    relays.delete(m.rid!);
    if (m.error) r?.reject(new Error(m.error));
    else r?.resolve(m.value);
    return;
  }
  try {
    const value = await handle(m.id!, m.type, m.payload as never);
    scope.postMessage({ type: "result", id: m.id, value });
  } catch (e) {
    scope.postMessage({ type: "error", id: m.id, message: (e as Error).message ?? String(e) });
  }
};
