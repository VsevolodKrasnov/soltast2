// pumpfunBundler.js — CLEAN VERSION (Pumpfun + Jito only)

import {
  Connection,
  Keypair,
  PublicKey,
  ComputeBudgetProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import base58 from "bs58";

// Jito executor
import { executeJitoTx } from "./jito.js";

// Pump.fun trade-local endpoint
const PUMP_TRADE_LOCAL = "https://pumpportal.fun/api/trade-local";

/* ============================================================================================
   UTILITES
============================================================================================ */

function lamportsToSol(l) {
  return Number(l) / 1e9;
}

/**
 * Build Pumpfun BUY transaction for a wallet
 */
async function buildPumpfunBuyTx({ wallet, mint, amountSol, priorityFee }) {
  try {
    const body = {
      publicKey: wallet.publicKey.toBase58(),
      action: "buy",
      mint: mint,                           // Pump CA
      denominatedInSol: "true",
      amount: amountSol,                    // e.g. 0.01
      slippage: 10,
      priorityFee: lamportsToSol(priorityFee),
      pool: "pump",
    };

    const resp = await fetch(PUMP_TRADE_LOCAL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      console.log("❌ Pumpfun BUY error:", await resp.text());
      return null;
    }

    const buf = new Uint8Array(await resp.arrayBuffer());
    const tx = VersionedTransaction.deserialize(buf);
    tx.sign([wallet]);

    return tx;
  } catch (err) {
    console.log("❌ buildPumpfunBuyTx error:", err.message);
    return null;
  }
}

/**
 * Build Pumpfun SELL-ALL transaction
 */
async function buildPumpfunSellTx({ wallet, mint, priorityFee }) {
  try {
    const body = {
      publicKey: wallet.publicKey.toBase58(),
      action: "sell",
      mint: mint,
      denominatedInSol: "false",
      amount: "100%",             // SELL ALL
      slippage: 10,
      priorityFee: lamportsToSol(priorityFee),
      pool: "pump",
    };

    const resp = await fetch(PUMP_TRADE_LOCAL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      console.log("❌ Pumpfun SELL error:", await resp.text());
      return null;
    }

    const buf = new Uint8Array(await resp.arrayBuffer());
    const tx = VersionedTransaction.deserialize(buf);
    tx.sign([wallet]);

    return tx;
  } catch (err) {
    console.log("❌ buildPumpfunSellTx error:", err.message);
    return null;
  }
}

/* ============================================================================================
   MAIN: BUY BUNDLE (PUMPFUN + JITO)
============================================================================================ */

export async function makePumpfunBuyBundle({
  connection,
  wallets,
  mint,
  lamportsPerWallet,
  priorityFee = 100000,
}) {
  try {
    const amountSol = lamportsToSol(lamportsPerWallet);
    const txs = [];

    for (const wallet of wallets) {
      const tx = await buildPumpfunBuyTx({
        wallet,
        mint,
        amountSol,
        priorityFee,
      });

      if (tx) txs.push(tx);
    }

    if (txs.length === 0)
      return { error: "No BUY transactions created." };

    const sig = await executeJitoTx(txs, wallets[0], "confirmed");

    return {
      success: true,
      txCount: txs.length,
      signature: sig,
    };
  } catch (err) {
    return { error: err.message };
  }
}

/* ============================================================================================
   SELL BUNDLE (SELL ALL TOKENS + SEND AS JITO BUNDLE)
============================================================================================ */

export async function makePumpfunSellAllBundle({
  connection,
  wallets,
  mint,
  priorityFee = 100000,
}) {
  try {
    const txs = [];

    for (const wallet of wallets) {
      const sellTx = await buildPumpfunSellTx({
        wallet,
        mint,
        priorityFee,
      });

      if (sellTx) txs.push(sellTx);
    }

    if (txs.length === 0)
      return { error: "No SELL transactions created." };

    const sig = await executeJitoTx(txs, wallets[0], "confirmed");

    return {
      success: true,
      txCount: txs.length,
      signature: sig,
    };
  } catch (err) {
    return { error: err.message };
  }
}
