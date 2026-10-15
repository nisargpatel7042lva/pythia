/**
 * Circuit artifact locations. Copied unchanged from PHANTOM
 * (frontend/public/circuits/{register,transfer,withdraw}); they live in
 * packages/eerc-core/circuits. Only register/transfer/withdraw are used;
 * mint/burn are standalone-mode only.
 *
 * `base` must be an ABSOLUTE URL prefix pointing at the directory that holds
 * register/, transfer/ and withdraw/:
 *   - Node:    pathToFileURL(circuitsDir).href
 *   - Browser: `${window.location.origin}/circuits`
 * (snarkjs runs in web workers, where relative URLs do not resolve against the
 * page origin.)
 */
export interface CircuitURLs {
  register: { wasm: string; zkey: string };
  transfer: { wasm: string; zkey: string };
  withdraw: { wasm: string; zkey: string };
  mint: { wasm: string; zkey: string };
  burn: { wasm: string; zkey: string };
}

export function getCircuitURLs(base: string): CircuitURLs {
  const b = base.replace(/\/+$/, "");
  return {
    register: {
      wasm: `${b}/register/RegistrationCircuit.wasm`,
      zkey: `${b}/register/RegistrationCircuit.groth16.zkey`,
    },
    transfer: {
      wasm: `${b}/transfer/TransferCircuit.wasm`,
      zkey: `${b}/transfer/TransferCircuit.groth16.zkey`,
    },
    withdraw: {
      wasm: `${b}/withdraw/WithdrawCircuit.wasm`,
      zkey: `${b}/withdraw/WithdrawCircuit.groth16.zkey`,
    },
    mint: { wasm: "", zkey: "" },
    burn: { wasm: "", zkey: "" },
  };
}
