import { snowtraceTx } from "./eerc.js";

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  /** Log a message about a transaction, with its Snowtrace link. */
  tx(msg: string, hash: string): void;
}

const ts = () => new Date().toISOString().replace("T", " ").slice(0, 19);

export const log: Logger = {
  info: (m) => console.log(`${ts()} INFO  ${m}`),
  warn: (m) => console.warn(`${ts()} WARN  ${m}`),
  error: (m) => console.error(`${ts()} ERROR ${m}`),
  tx: (m, hash) => console.log(`${ts()} TX    ${m}  ${snowtraceTx(hash)}`),
};

export const silentLogger: Logger = { info() {}, warn() {}, error() {}, tx() {} };
