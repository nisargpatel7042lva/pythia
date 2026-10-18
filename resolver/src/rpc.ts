import { ethers } from "ethers";

/**
 * JSON-RPC provider with a short request timeout. ethers' default is 5 minutes (with retries on
 * top), which let one stalled call freeze the whole resolver loop for hours. Failing fast lets the
 * next poll simply try again.
 */
export function makeProvider(rpcUrl: string, timeoutMs = 20_000): ethers.JsonRpcProvider {
  const req = new ethers.FetchRequest(rpcUrl);
  req.timeout = timeoutMs;
  return new ethers.JsonRpcProvider(req, undefined, { staticNetwork: true });
}
