/**
 * Local decryption of the caller's OWN transfer ciphertexts (Node + browser; nothing leaves the
 * machine).
 *
 * A private transfer's calldata carries (TransferProof.publicSignals):
 *   [6..9]   the amount encrypted to the SENDER's key (ElGamal point, c1.x c1.y c2.x c2.y)
 *   [16..22] the amount encrypted to the RECEIVER's key (Poseidon "PCT")
 * so the sender can recover what they sent, and the receiver what they received, using only
 * their own eERC key.
 */
import { ethers } from "ethers";
import { Base8, Fr, addPoint, mulPointEscalar, type Point } from "@zk-kit/baby-jubjub";
import type { EERC } from "@avalabs/ac-eerc-sdk/dist/index.js";
import { ENCRYPTED_ERC_ABI } from "./client";

const iface = new ethers.Interface(ENCRYPTED_ERC_ABI);

export interface DecodedTransfer {
  to: string;
  tokenId: bigint;
  /** [c1.x, c1.y, c2.x, c2.y]: amount encrypted to the sender. */
  senderAmount: [bigint, bigint, bigint, bigint];
  /** 7-element Poseidon ciphertext: amount encrypted to the receiver. */
  receiverPct: bigint[];
}

/** Decode a direct `EncryptedERC.transfer` call. Returns null for any other calldata. */
export function decodeTransferCalldata(data: string): DecodedTransfer | null {
  let call: ethers.TransactionDescription | null;
  try {
    call = iface.parseTransaction({ data });
  } catch {
    return null;
  }
  if (!call || call.name !== "transfer") return null;
  const s: bigint[] = [...call.args.proof.publicSignals].map((x: bigint) => BigInt(x));
  return {
    to: call.args.to as string,
    tokenId: BigInt(call.args.tokenId),
    senderAmount: [s[6], s[7], s[8], s[9]],
    receiverPct: s.slice(16, 23),
  };
}

/** Amount (eERC base units) someone sent to us, from the receiver ciphertext in the calldata. */
export function decryptReceivedAmount(eerc: EERC, tx: DecodedTransfer): bigint {
  return BigInt(eerc.decryptPCT(tx.receiverPct));
}

/**
 * The SDK keeps the formatted private scalar private. This recovers it by letting the SDK use it
 * once: calculateTotalBalance() hands the formatted key to curve.elGamalDecryption(), which we
 * wrap for the duration of that call. The key stays in memory and is never logged or sent.
 */
export async function extractFormattedKey(eerc: EERC): Promise<bigint> {
  if (!eerc.isDecryptionKeySet) throw new Error("decryption key not set");
  const { cipher, nonce, authKey } = await eerc.poseidon.processPoseidonEncryption({
    inputs: [1n],
    publicKey: eerc.publicKey as never,
  });
  const pct = [...cipher, authKey[0], authKey[1], nonce].map(BigInt);
  const curve = eerc.curve as unknown as {
    elGamalDecryption: (k: bigint, c: unknown) => unknown;
  };
  const original = curve.elGamalDecryption;
  let captured: bigint | undefined;
  curve.elGamalDecryption = function (this: unknown, k: bigint, c: unknown) {
    captured = k;
    return original.call(this, k, c);
  };
  try {
    const base = [Base8[0], Base8[1]];
    eerc.calculateTotalBalance({ c1: { x: base[0], y: base[1] }, c2: { x: base[0], y: base[1] } } as never, [], pct);
  } finally {
    curve.elGamalDecryption = original;
  }
  if (captured === undefined) throw new Error("could not obtain the formatted key from the SDK");
  return captured;
}

/**
 * Baby-step giant-step discrete log on BabyJubJub: find a with a*Base8 == P for 0 <= a < m*m.
 * The table is built once per solver (m points); each solve costs at most m point additions.
 * m = 2^14 covers amounts up to ~268M base units (2.68M USDC at 2 decimals).
 */
export class DlpSolver {
  private table = new Map<string, number>();
  private negGiant: Point<bigint>;
  readonly limit: bigint;

  constructor(private m = 1 << 14) {
    let p: Point<bigint> = [0n, 1n]; // identity
    for (let j = 0; j < m; j++) {
      this.table.set(`${p[0]}:${p[1]}`, j);
      p = addPoint(p, Base8);
    }
    // p is now m*Base8
    this.negGiant = [Fr.e(-p[0]), p[1]];
    this.limit = BigInt(m) * BigInt(m);
  }

  solve(point: [bigint, bigint]): bigint | null {
    let q: Point<bigint> = [point[0], point[1]];
    for (let i = 0; i < this.m; i++) {
      const j = this.table.get(`${q[0]}:${q[1]}`);
      if (j !== undefined) return BigInt(i) * BigInt(this.m) + BigInt(j);
      q = addPoint(q, this.negGiant);
    }
    return null;
  }
}

/** Amount (eERC base units) we sent, from the sender ciphertext in the calldata. */
export function decryptSentAmount(eerc: EERC, formattedKey: bigint, tx: DecodedTransfer, solver: DlpSolver): bigint {
  const [c1x, c1y, c2x, c2y] = tx.senderAmount;
  const point = eerc.curve.elGamalDecryption(formattedKey, { c1: [c1x, c1y], c2: [c2x, c2y] } as never) as [bigint, bigint];
  const amount = solver.solve([BigInt(point[0]), BigInt(point[1])]);
  if (amount === null) throw new Error("amount outside the searchable range");
  // Sanity: re-derive the point.
  const check = mulPointEscalar(Base8, amount);
  if (check[0] !== BigInt(point[0]) || check[1] !== BigInt(point[1])) throw new Error("discrete-log self-check failed");
  return amount;
}
