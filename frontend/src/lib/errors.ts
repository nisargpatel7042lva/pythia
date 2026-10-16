import { config } from "@/config";

/** An error whose message is already safe and clear to show to the user. */
export class UserError extends Error {
  constructor(
    message: string,
    readonly code: "NO_USDC" | "NO_GAS" | "CLOSED" | "NETWORK" | "REJECTED" | "OFFLINE" | "OTHER" = "OTHER",
  ) {
    super(message);
  }
}

/** Turn any thrown value into a calm, specific sentence. Never leaks stack traces. */
export function friendlyError(e: unknown): { message: string; code: UserError["code"] } {
  if (e instanceof UserError) return { message: e.message, code: e.code };
  const err = e as { code?: number | string; message?: string; shortMessage?: string; details?: string };
  const raw = `${err?.shortMessage ?? ""} ${err?.details ?? ""} ${err?.message ?? ""}`;
  if (err?.code === 4001 || err?.code === "ACTION_REJECTED" || /user rejected|user denied|rejected the request|request rejected/i.test(raw)) {
    return { message: "You rejected the request in your wallet. Nothing was sent and no funds moved.", code: "REJECTED" };
  }
  if (err?.code === -32002 || /already pending|already processing/i.test(raw)) {
    return { message: "A request is already open in your wallet. Open the wallet extension and approve or reject it, then try again.", code: "OTHER" };
  }
  // The eERC SDK hides the wallet's rejection behind this generic message when deriving the key.
  if (/failed to generate decryption key/i.test(raw)) {
    return { message: "Your wallet signature is needed to unlock your private eERC key. It was not provided, so nothing was sent. Try again and approve the signature request.", code: "REJECTED" };
  }
  if (err?.code === 4902 || /unrecognized chain|chain.*not (added|configured)|wrong network|chain mismatch|does not match the target chain/i.test(raw)) {
    return { message: "Your wallet is on a different network. Switch to Avalanche Fuji and try again.", code: "NETWORK" };
  }
  if (/insufficient funds for gas|insufficient funds|exceeds the balance/i.test(raw)) {
    return { message: `Not enough AVAX for gas. Get test AVAX from ${config.avaxFaucetUrl}`, code: "NO_GAS" };
  }
  if (/failed to fetch|networkerror|timeout|timed out|ECONNREFUSED|Load failed/i.test(raw)) {
    return { message: "A network request failed or timed out. Check your connection and try again.", code: "OFFLINE" };
  }
  if (/No wallet found/i.test(raw)) return { message: err.message!, code: "OTHER" };
  const first = (err?.shortMessage ?? err?.message ?? "Something went wrong").split("\n")[0].slice(0, 200);
  return { message: first, code: "OTHER" };
}
