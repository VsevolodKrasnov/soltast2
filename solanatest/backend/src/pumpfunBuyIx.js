import fetch from "node-fetch";
import bs58 from "bs58";
import {
  VersionedTransaction,
  Connection,
  Keypair,
} from "@solana/web3.js";

/*
  PumpPortal + Jito bundle pipeline.

  - build pumpportal request for N wallets
  - fetch unsigned TXs
  - sign TXs
  - submit bundle to Jito

  Public Jito endpoint used:
  https://mainnet.block-engine.jito.wtf/api/v1/bundles
*/

const PUMP_PORTAL = "https://pumpportal.fun/api/trade-local";
const JITO_URL = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";

export async function pumpfunBundleBuySell({
  requests,        // array of pumpportal trade objects
  keypairs,        // array of Keypair objects (same order as requests)
}) {
  // 1) Fetch unsigned transactions from PumpPortal
  const portalResp = await fetch(PUMP_PORTAL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requests),
  });

  if (!portalResp.ok) {
    throw new Error(
      `PumpPortal error: ${portalResp.status} ${portalResp.statusText}`
    );
  }

  const unsignedTxs = await portalResp.json();

  if (!Array.isArray(unsignedTxs) || unsignedTxs.length === 0) {
    throw new Error("PumpPortal returned empty/invalid unsigned transactions");
  }

  // 2) Sign each transaction
  const signedTxs = unsignedTxs.map((base58Tx, idx) => {
    const raw = bs58.decode(base58Tx);
    const tx = VersionedTransaction.deserialize(raw);
    tx.sign([keypairs[idx]]);
    return bs58.encode(tx.serialize());
  });

  // 3) Send bundle to Jito
  const jitoResp = await fetch(JITO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params: [signedTxs],
    }),
  });

  const jitoJson = await jitoResp.json().catch(() => null);

  return {
    signedTxs,
    jitoResponse: jitoJson,
  };
}
