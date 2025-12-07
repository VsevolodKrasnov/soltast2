// backend/src/server.js
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import bs58 from 'bs58';
import fetch from 'node-fetch';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// =============================
// RPC + JITO
// =============================

// Основной RPC
const RPC_ENDPOINT =
  process.env.RPC_ENDPOINT ||
  process.env.HELIUS_RPC_URL ||
  'https://api.mainnet-beta.solana.com';

// JITO endpoint (для bundle мгновенных SELL ALL)
const JITO_BUNDLE_URL =
  process.env.JITO_BUNDLE_URL ||
  'https://mainnet.block-engine.jito.wtf/api/v1/bundles';

console.log('🔌 Using RPC:', RPC_ENDPOINT);
console.log('🚀 JITO bundle endpoint:', JITO_BUNDLE_URL);

const connection = new Connection(RPC_ENDPOINT, {
  commitment: 'confirmed',
});

app.use(cors());
app.use(bodyParser.json({ limit: '30mb' }));

// =============================
// HELPERS
// =============================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randRange(min, max) {
  if (!isFinite(min) || !isFinite(max)) return min;
  if (max < min) return min;
  return Math.random() * (max - min) + min;
}

function lamportsToSol(l) {
  return l / 1e9;
}

function solToLamports(sol) {
  return Math.floor(sol * 1e9);
}

// =============================
// WALLET FACTORY (создание кошельков)
// =============================

function createWallets(count) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    const kp = Keypair.generate();
    arr.push({
      publicKey: kp.publicKey.toBase58(),
      secretKey: bs58.encode(kp.secretKey),
    });
  }
  return arr;
}
// =============================
// API: GET WALLETS BALANCES
// =============================
app.post('/api/wallets/balances', async (req, res) => {
  try {
    const { wallets } = req.body || {};

    if (!Array.isArray(wallets) || wallets.length === 0)
      return res.status(400).json({ error: "wallets[] required" });

    const out = {};

    for (const pk of wallets) {
      try {
        const amount = await connection.getBalance(new PublicKey(pk));
        out[pk] = amount / 1e9;
      } catch {
        out[pk] = null;
      }
    }

    res.json({ balances: out });
  } catch (e) {
    console.error("balances error:", e.message);
    res.status(500).json({ error: "internal error" });
  }
});
// =============================
// Pump.fun trade-local (buy/sell builder)
// =============================

const PUMPFUN_TRADE_LOCAL_URL = 'https://pumpportal.fun/api/trade-local';

// --- Build BUY transaction (amountSol в SOL, denominatedInSol=true)
async function buildPumpfunBuyTx({
  walletKp,
  mint,
  amountSol,
  priorityFeeLamports,
  slippagePercent,
}) {
  try {
    const priorityFeeSol = lamportsToSol(priorityFeeLamports || 0) || 0.00001;

    const body = {
      publicKey: walletKp.publicKey.toBase58(),
      action: 'buy',
      mint,
      denominatedInSol: true, // boolean
      amount: amountSol, // number (SOL)
      slippage: slippagePercent ?? 10,
      priorityFee: priorityFeeSol,
      pool: 'pump',
    };

    const resp = await fetch(PUMPFUN_TRADE_LOCAL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const msg = await resp.text();
      console.error('❌ Pumpfun buy error:', resp.status, msg);
      return null;
    }

    const buf = await resp.arrayBuffer();
    const tx = VersionedTransaction.deserialize(new Uint8Array(buf));
    tx.sign([walletKp]);
    return tx;
  } catch (e) {
    console.error('❌ buildPumpfunBuyTx failed:', e.message);
    return null;
  }
}

// --- Build SELL ALL (100%) transaction
async function buildPumpfunSellAllTx({
  walletKp,
  mint,
  priorityFeeLamports,
  slippagePercent = 30, // агрессивный дефолт
}) {
  try {
    const priorityFeeSol = lamportsToSol(priorityFeeLamports || 0) || 0.0001;

    const body = {
      publicKey: walletKp.publicKey.toBase58(),
      action: 'sell',
      mint,
      denominatedInSol: false, // boolean
      amount: '100%', // строка ТОЛЬКО для sell-all
      slippage: slippagePercent,
      priorityFee: priorityFeeSol,
      pool: 'pump',
    };

    const resp = await fetch(PUMPFUN_TRADE_LOCAL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const msg = await resp.text();
      console.error('❌ Pumpfun sell error:', resp.status, msg);
      return null;
    }

    const buf = await resp.arrayBuffer();
    const tx = VersionedTransaction.deserialize(new Uint8Array(buf));
    tx.sign([walletKp]);
    return tx;
  } catch (e) {
    console.error('❌ buildPumpfunSellAllTx failed:', e.message);
    return null;
  }
}

// =============================
// API 1: Create wallets
// =============================

app.post('/api/wallets/create', async (req, res) => {
  try {
    let { count } = req.body || {};
    count = Number(count) || 0;

    if (count < 1 || count > 300)
      return res.status(400).json({ error: 'count must be 1–300' });

    const wallets = createWallets(count);

    const csv =
      'index,publicKey,secretKeyBase58\n' +
      wallets.map((w, i) => `${i + 1},${w.publicKey},${w.secretKey}`).join('\n');

    res.json({ wallets, csv });
  } catch (e) {
    res.status(500).json({ error: 'internal error', details: e.message });
  }
});


// =============================
// API 3: FUND wallets (deposit from main wallet)
// =============================

app.post('/api/wallets/fund', async (req, res) => {
  try {
    const {
      mainPrivateKeyBase58,
      targets,
      mode,
      totalSol,
      perWalletSol,
      useFullBalance,
    } = req.body || {};

    if (!mainPrivateKeyBase58)
      return res.status(400).json({ error: 'mainPrivateKeyBase58 required' });

    if (!Array.isArray(targets) || targets.length === 0)
      return res.status(400).json({ error: 'targets[] required' });

    const mainKp = Keypair.fromSecretKey(bs58.decode(mainPrivateKeyBase58));

    let perWalletLamports;

    if (mode === 'equal') {
      if (useFullBalance) {
        const bal = await connection.getBalance(mainKp.publicKey);
        const safeLamports = Math.max(bal - 0.002 * 1e9, 0);
        perWalletLamports = Math.floor(safeLamports / targets.length);
      } else {
        const total = Number(totalSol || 0);
        if (total <= 0)
          return res.status(400).json({ error: 'totalSol must be > 0' });
        perWalletLamports = Math.floor((total * 1e9) / targets.length);
      }
    } else if (mode === 'perWallet') {
      const v = Number(perWalletSol || 0);
      if (v <= 0)
        return res.status(400).json({ error: 'perWalletSol must be > 0' });
      perWalletLamports = Math.floor(v * 1e9);
    } else {
      return res.status(400).json({ error: 'mode must be equal | perWallet' });
    }

    const signatures = [];
    const blockhash = await connection.getLatestBlockhash();

    for (const pk of targets) {
      try {
        const toPubkey = new PublicKey(pk);

        const ix = SystemProgram.transfer({
          fromPubkey: mainKp.publicKey,
          toPubkey,
          lamports: perWalletLamports,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = mainKp.publicKey;
        tx.recentBlockhash = blockhash.blockhash;

        const sig = await sendAndConfirmTransaction(connection, tx, [mainKp], {
          commitment: 'confirmed',
        });

        signatures.push({ to: pk, signature: sig });
      } catch (e) {
        console.error('fund wallet error:', e.message);
      }
    }

    res.json({ signatures });
  } catch (e) {
    console.error('fund error:', e.message);
    res.status(500).json({ error: 'internal error', details: e.message });
  }
});

// =============================
// API 4: COLLECT wallets (send all SOL back to main)
// =============================

app.post('/api/wallets/collect', async (req, res) => {
  try {
    const { mainPrivateKeyBase58, wallets } = req.body || {};

    if (!mainPrivateKeyBase58)
      return res.status(400).json({ error: 'mainPrivateKeyBase58 required' });

    if (!Array.isArray(wallets) || wallets.length === 0)
      return res.status(400).json({ error: 'wallets[] required' });

    const mainKp = Keypair.fromSecretKey(bs58.decode(mainPrivateKeyBase58));
    const blockhash = await connection.getLatestBlockhash();
    const results = [];

    for (const sk of wallets) {
      try {
        const kp = Keypair.fromSecretKey(bs58.decode(sk));
        const bal = await connection.getBalance(kp.publicKey);

        if (bal === 0) {
          results.push({ from: kp.publicKey.toBase58(), skipped: true });
          continue;
        }

        const ix = SystemProgram.transfer({
          fromPubkey: kp.publicKey,
          toPubkey: mainKp.publicKey,
          lamports: Math.max(bal - 5000, 0),
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = kp.publicKey;
        tx.recentBlockhash = blockhash.blockhash;

        const sig = await sendAndConfirmTransaction(connection, tx, [kp], {
          commitment: 'confirmed',
        });

        results.push({ from: kp.publicKey.toBase58(), signature: sig });
      } catch (e) {
        console.error('collect error:', e.message);
        results.push({ error: e.message });
      }
    }

    res.json({ signatures: results });
  } catch (e) {
    console.error('collect error:', e.message);
    res.status(500).json({ error: 'internal error', details: e.message });
  }
});

// =============================
// API 5: BUY (standard, 1 wallet = 1 tx)
// =============================

app.post('/api/trade/buy', async (req, res) => {
  try {
    const {
      walletSecretKeysBase58,
      mintAddress,
      amountSolPerWallet,
      priorityFeeLamports,
      slippagePercent,
    } = req.body || {};

    if (
      !Array.isArray(walletSecretKeysBase58) ||
      walletSecretKeysBase58.length === 0
    )
      return res
        .status(400)
        .json({ error: 'walletSecretKeysBase58[] required' });

    if (!mintAddress)
      return res.status(400).json({ error: 'mintAddress required' });

    const sol = Number(amountSolPerWallet || 0);
    if (sol <= 0)
      return res
        .status(400)
        .json({ error: 'amountSolPerWallet must be > 0' });

    const slip = Number(slippagePercent);
    const effectiveSlippage = slip > 0 && slip <= 100 ? slip : 10;

    const sigs = [];

    for (const sk of walletSecretKeysBase58) {
      try {
        const kp = Keypair.fromSecretKey(bs58.decode(sk));

        const tx = await buildPumpfunBuyTx({
          walletKp: kp,
          mint: mintAddress,
          amountSol: sol,
          priorityFeeLamports,
          slippagePercent: effectiveSlippage,
        });

        if (!tx) continue;

        const raw = tx.serialize();

        const sig = await connection.sendRawTransaction(raw, {
          skipPreflight: true,
          maxRetries: 0,
        });

        try {
          await connection.confirmTransaction(sig, 'confirmed');
        } catch {}

        sigs.push({
          wallet: kp.publicKey.toBase58(),
          signature: sig,
        });
      } catch (e) {
        console.error('BUY error:', e.message);
      }
    }

    if (sigs.length === 0)
      return res.status(500).json({ error: 'No buy transactions sent' });

    res.json({ status: 'ok', txCount: sigs.length, signatures: sigs });
  } catch (e) {
    console.error('buy error:', e.message);
    res.status(500).json({ error: 'internal error', details: e.message });
  }
});

// =============================
// API 6: SELL ALL (100%) — instant mode ("палка в пол")
// =============================

app.post('/api/trade/sell-all', async (req, res) => {
  try {
    const {
      walletSecretKeysBase58,
      mintAddress,
      priorityFeeLamports,
      slippagePercent,
    } = req.body || {};

    if (
      !Array.isArray(walletSecretKeysBase58) ||
      walletSecretKeysBase58.length === 0
    )
      return res
        .status(400)
        .json({ error: 'walletSecretKeysBase58[] required' });

    if (!mintAddress)
      return res.status(400).json({ error: 'mintAddress required' });

    const slip = Number(slippagePercent);
    const effectiveSlippage = slip > 0 && slip <= 100 ? slip : 30; // агрессивный дефолт

    const builtTxs = [];
    const sigs = [];

    // 1) строим все sell-all tx
    for (const sk of walletSecretKeysBase58) {
      try {
        const kp = Keypair.fromSecretKey(bs58.decode(sk));

        const tx = await buildPumpfunSellAllTx({
          walletKp: kp,
          mint: mintAddress,
          priorityFeeLamports,
          slippagePercent: effectiveSlippage,
        });

        if (!tx) continue;

        const raw = tx.serialize();
        const base58Tx = bs58.encode(raw);

        builtTxs.push({
          signedTx: base58Tx,
          wallet: kp.publicKey.toBase58(),
        });
      } catch (e) {
        console.error('SELL-ALL build error:', e.message);
      }
    }

    if (builtTxs.length === 0)
      return res
        .status(500)
        .json({ error: 'No sell-all transactions built' });

    // 2) JITO BUNDLE
    if (builtTxs.length > 0) {
      try {
        const bundleTxs = builtTxs.map((tx) => tx.signedTx);

        const jitoBody = {
          jsonrpc: '2.0',
          id: 1,
          method: 'sendBundle',
          params: [bundleTxs],
        };

        const jitoResp = await fetch(JITO_BUNDLE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(jitoBody),
        });

        const jitoData = await jitoResp.text().catch(() => '');

        console.log('📦 JITO BUNDLE RESULT:', jitoData);

        for (const tx of builtTxs) {
          sigs.push({
            wallet: tx.wallet,
            signature: '(JITO bundle) – check solscan for bundle',
          });
        }

        return res.json({
          status: 'ok',
          mode: 'jito-bundle',
          txCount: builtTxs.length,
          signatures: sigs,
        });
      } catch (e) {
        console.error('❌ JITO bundle error:', e.message);
        // fallback ниже
      }
    }

    // 3) FALLBACK — обычная отправка если JITO не работает
    for (const tx of builtTxs) {
      try {
        const raw = bs58.decode(tx.signedTx);

        const sig = await connection.sendRawTransaction(raw, {
          skipPreflight: true,
          maxRetries: 0,
        });

        try {
          await connection.confirmTransaction(sig, 'confirmed');
        } catch {}

        sigs.push({
          wallet: tx.wallet,
          signature: sig,
        });
      } catch (e) {
        sigs.push({
          wallet: tx.wallet,
          error: e.message,
        });
      }
    }

    res.json({
      status: 'ok',
      mode: 'fallback',
      txCount: sigs.length,
      signatures: sigs,
    });
  } catch (e) {
    console.error('sell-all error:', e.message);
    res.status(500).json({
      error: 'internal error',
      details: e.message,
    });
  }
});

// =============================
// API 7: BUY-REST
// =============================

app.post('/api/trade/buy-rest', async (req, res) => {
  try {
    const { mintAddress, slippagePercent, perWalletAmounts } = req.body || {};

    if (!mintAddress)
      return res.status(400).json({ error: 'mintAddress required' });

    if (!Array.isArray(perWalletAmounts) || perWalletAmounts.length === 0)
      return res
        .status(400)
        .json({ error: 'perWalletAmounts[] required' });

    const slip = Number(slippagePercent);
    const effectiveSlippage = slip > 0 && slip <= 100 ? slip : 10;

    const sigs = [];

    for (const w of perWalletAmounts) {
      try {
        const kp = Keypair.fromSecretKey(bs58.decode(w.secretKey));

        const tx = await buildPumpfunBuyTx({
          walletKp: kp,
          mint: mintAddress,
          amountSol: Number(w.solAmount),
          priorityFeeLamports: 0,
          slippagePercent: effectiveSlippage,
        });

        if (!tx) continue;

        const raw = tx.serialize();
        const sig = await connection.sendRawTransaction(raw, {
          skipPreflight: true,
          maxRetries: 0,
        });

        try {
          await connection.confirmTransaction(sig, 'confirmed');
        } catch {}

        sigs.push({
          wallet: kp.publicKey.toBase58(),
          signature: sig,
          solUsed: w.solAmount,
        });
      } catch (e) {
        console.error('buy-rest error:', e.message);
      }
    }

    if (sigs.length === 0)
      return res.status(500).json({ error: 'No buy-rest transactions sent' });

    res.json({ status: 'ok', txCount: sigs.length, signatures: sigs });
  } catch (e) {
    console.error('buy-rest error:', e.message);
    res.status(500).json({ error: 'internal error', details: e.message });
  }
});

// =============================
// API 8: SMART BUY (percentage + minSol + random delay)
// =============================

app.post('/api/trade/smart-buy', async (req, res) => {
  try {
    const {
      mintAddress,
      wallets, // [{ publicKey, secretKey, solBalance }]
      minBuyPercent,
      maxBuyPercent,
      minBuySol,
      minDelaySec,
      maxDelaySec,
      slippagePercent,
      priorityFeeLamports,
    } = req.body || {};

    if (!mintAddress)
      return res.status(400).json({ error: 'mintAddress required' });

    if (!Array.isArray(wallets) || wallets.length === 0)
      return res.status(400).json({ error: 'wallets[] required' });

    let minPct = Number(minBuyPercent);
    let maxPct = Number(maxBuyPercent);

    if (!isFinite(minPct) || !isFinite(maxPct))
      return res
        .status(400)
        .json({ error: 'minBuyPercent/maxBuyPercent required' });

    if (minPct <= 0 || maxPct <= 0 || maxPct < minPct)
      return res.status(400).json({ error: 'percent ranges invalid' });

    // Absolute minimum SOL per tx
    let minBuySolAbs = Number(minBuySol);
    if (!isFinite(minBuySolAbs) || minBuySolAbs < 0.01) {
      minBuySolAbs = 0.01;
    }

    // Delay range
    let minDelay = Number(minDelaySec);
    let maxDelay = Number(maxDelaySec);

    if (!isFinite(minDelay) || minDelay < 0.1) minDelay = 0.1;
    if (!isFinite(maxDelay) || maxDelay < minDelay) maxDelay = minDelay;
    if (maxDelay > 10) maxDelay = 10;

    const slip = Number(slippagePercent);
    const effectiveSlippage = slip > 0 && slip <= 100 ? slip : 10;

    const priorityLamports = Number(priorityFeeLamports) || 0;

    const results = [];
    let sentCount = 0;

    for (const w of wallets) {
      const walletPub = w.publicKey;
      const walletSecret = w.secretKey;
      const solBalance = Number(w.solBalance || 0);

      if (!walletPub || !walletSecret) {
        results.push({
          wallet: walletPub,
          skipped: true,
          reason: 'invalid wallet data',
        });
        continue;
      }

      if (!isFinite(solBalance) || solBalance <= 0) {
        results.push({
          wallet: walletPub,
          skipped: true,
          reason: 'zero or invalid balance',
          solBalance,
        });
        continue;
      }

      // минимум 0.002 SOL на комиссии
      const safeBal = Math.max(solBalance - 0.002, 0);

      if (safeBal < minBuySolAbs) {
        results.push({
          wallet: walletPub,
          skipped: true,
          reason: 'balance < minBuySolAbs',
          solBalance,
        });
        continue;
      }

      const minAmtFromPct = (safeBal * minPct) / 100;
      const maxAmtFromPct = (safeBal * maxPct) / 100;

      if (maxAmtFromPct < minBuySolAbs) {
        results.push({
          wallet: walletPub,
          skipped: true,
          reason: 'maxPct * balance < minBuySolAbs',
          solBalance,
        });
        continue;
      }

      let rawAmountSol = randRange(minAmtFromPct, maxAmtFromPct);
      rawAmountSol = Math.max(rawAmountSol, minBuySolAbs);
      rawAmountSol = Math.min(rawAmountSol, safeBal);

      if (rawAmountSol < minBuySolAbs || rawAmountSol <= 0) {
        results.push({
          wallet: walletPub,
          skipped: true,
          reason: 'calculated amount < minBuySolAbs',
          solBalance,
        });
        continue;
      }

      const dSec = randRange(minDelay, maxDelay);
      const dMs = Math.floor(dSec * 1000);

      const walletKp = Keypair.fromSecretKey(bs58.decode(walletSecret));

      if (dMs > 0) await sleep(dMs);

      try {
        const tx = await buildPumpfunBuyTx({
          walletKp,
          mint: mintAddress,
          amountSol: rawAmountSol,
          priorityFeeLamports: priorityLamports,
          slippagePercent: effectiveSlippage,
        });

        if (!tx) {
          results.push({
            wallet: walletPub,
            skipped: true,
            reason: 'failed to build buy tx',
            solBalance,
            dSec,
            rawAmountSol,
          });
          continue;
        }

        const raw = tx.serialize();

        const sig = await connection.sendRawTransaction(raw, {
          skipPreflight: true,
          maxRetries: 0,
        });

        try {
          await connection.confirmTransaction(sig, 'confirmed');
        } catch {}

        sentCount++;

        results.push({
          wallet: walletPub,
          skipped: false,
          signature: sig,
          solBalance,
          dSec,
          rawAmountSol,
        });
      } catch (e) {
        console.error('smart-buy wallet error:', walletPub, e.message);
        results.push({
          wallet: walletPub,
          skipped: true,
          reason: 'exception',
          error: e.message,
        });
      }
    }

    if (sentCount === 0) {
      return res.status(500).json({
        error: 'No smart-buy transactions sent',
        results,
      });
    }

    res.json({
      status: 'ok',
      txCount: sentCount,
      results,
    });
  } catch (e) {
    console.error('smart-buy error:', e.message);
    res.status(500).json({ error: 'internal error', details: e.message });
  }
});

// =============================
// API 9: ROOT
// =============================

app.get('/', (_req, res) => {
  res.json({ status: 'ok', message: 'Solana bundler backend alive' });
});

// ========================================================
// SELL ALL — НОВАЯ ВЕРСИЯ v2 (JITO + fallback)
// ========================================================

app.post('/api/trade/sell-all-v2', async (req, res) => {
  try {
    const {
      walletSecretKeysBase58,
      mintAddress,
      priorityFeeLamports,
      slippagePercent,
    } = req.body || {};

    if (
      !Array.isArray(walletSecretKeysBase58) ||
      walletSecretKeysBase58.length === 0
    )
      return res
        .status(400)
        .json({ error: 'walletSecretKeysBase58[] required' });

    if (!mintAddress)
      return res.status(400).json({ error: 'mintAddress required' });

    const slip = Number(slippagePercent);
    const effectiveSlippage = slip > 0 && slip <= 100 ? slip : 35;

    const built = [];

    // 1) build всех sell-all
    for (const sk of walletSecretKeysBase58) {
      try {
        const kp = Keypair.fromSecretKey(bs58.decode(sk));

        const tx = await buildPumpfunSellAllTx({
          walletKp: kp,
          mint: mintAddress,
          priorityFeeLamports,
          slippagePercent: effectiveSlippage,
        });

        if (!tx) continue;

        const raw = tx.serialize();
        built.push({
          wallet: kp.publicKey.toBase58(),
          rawTx: raw,
          rawTxBase58: bs58.encode(raw),
        });
      } catch (e) {
        console.error('Sell-all-v2 build error:', e.message);
      }
    }

    if (built.length === 0)
      return res
        .status(500)
        .json({ error: 'No sell-all transactions built' });

    // 2) JITO bundle
    try {
      const jitoBundle = built.map((b) => b.rawTxBase58);

      const jitoPayload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [jitoBundle],
      };

      const jitoResp = await fetch(JITO_BUNDLE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jitoPayload),
      });

      const jitoText = await jitoResp.text();
      console.log('🔥 JITO BUNDLE RESPONSE:', jitoText);

      if (jitoResp.ok) {
        return res.json({
          status: 'ok',
          mode: 'jito-bundle',
          txCount: built.length,
          result: jitoText,
        });
      }

      console.warn('⚠️ JITO returned non-OK:', jitoText);
    } catch (e) {
      console.error('❌ JITO bundle error:', e.message);
    }

    // 3) fallback по RPC
    const sigs = [];

    for (const b of built) {
      try {
        const sig = await connection.sendRawTransaction(b.rawTx, {
          skipPreflight: true,
          maxRetries: 0,
        });

        try {
          await connection.confirmTransaction(sig, 'confirmed');
        } catch {}

        sigs.push({
          wallet: b.wallet,
          signature: sig,
        });
      } catch (e) {
        sigs.push({
          wallet: b.wallet,
          error: e.message,
        });
      }
    }

    return res.json({
      status: 'ok',
      mode: 'fallback',
      txCount: sigs.length,
      signatures: sigs,
    });
  } catch (e) {
    console.error('sell-all-v2 error:', e.message);
    return res.status(500).json({
      error: 'internal error',
      details: e.message,
    });
  }
});

// ========================================================
// BUY/SELL universal builder v2
// ========================================================

async function buildPumpfunTx({
  walletKp,
  mint,
  amountSol,
  action,
  slippagePercent,
  priorityFeeLamports,
}) {
  try {
    const priorityFeeSol = lamportsToSol(priorityFeeLamports || 0) || 0.00001;

    const isSellAll = action === 'sell' && amountSol === '100%';
    const isSellPercent =
      action === 'sell' && typeof amountSol === 'string' && amountSol.endsWith('%');

    const body = {
      publicKey: walletKp.publicKey.toBase58(),
      action,
      mint,
      denominatedInSol: action === 'buy' ? true : false,
      amount: action === 'buy' ? Number(amountSol) : amountSol,
      slippage: slippagePercent ?? 10,
      priorityFee: priorityFeeSol,
      pool: 'pump',
    };

    const resp = await fetch(PUMPFUN_TRADE_LOCAL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const msg = await resp.text();
      console.error(`❌ Pump.fun ${action} error:`, resp.status, msg);
      return null;
    }

    const buf = await resp.arrayBuffer();
    const tx = VersionedTransaction.deserialize(new Uint8Array(buf));
    tx.sign([walletKp]);
    return tx;
  } catch (e) {
    console.error(`❌ buildPumpfunTx(${action}) failed:`, e.message);
    return null;
  }
}

// ========================================================
// FAST BUY endpoint — единая универсальная покупка
// ========================================================

app.post('/api/trade/buy-fast', async (req, res) => {
  try {
    const {
      walletSecretKeysBase58,
      mintAddress,
      amountSol,
      slippagePercent,
      priorityFeeLamports,
    } = req.body || {};

    if (
      !Array.isArray(walletSecretKeysBase58) ||
      walletSecretKeysBase58.length === 0
    )
      return res
        .status(400)
        .json({ error: 'walletSecretKeysBase58[] required' });

    if (!mintAddress) return res.status(400).json({ error: 'mintAddress required' });
    if (!amountSol) return res.status(400).json({ error: 'amountSol required' });

    const slip = Number(slippagePercent);
    const effectiveSlippage = slip > 0 && slip <= 100 ? slip : 10;

    const sigs = [];

    for (const sk of walletSecretKeysBase58) {
      try {
        const kp = Keypair.fromSecretKey(bs58.decode(sk));

        const tx = await buildPumpfunTx({
          walletKp: kp,
          mint: mintAddress,
          amountSol,
          action: 'buy',
          slippagePercent: effectiveSlippage,
          priorityFeeLamports,
        });

        if (!tx) continue;

        const sig = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
          maxRetries: 0,
        });

        try {
          await connection.confirmTransaction(sig, 'confirmed');
        } catch {}

        sigs.push({
          wallet: kp.publicKey.toBase58(),
          signature: sig,
        });
      } catch (e) {
        sigs.push({
          wallet: 'unknown',
          error: e.message,
        });
      }
    }

    if (sigs.length === 0)
      return res.status(500).json({ error: 'No transactions sent' });

    res.json({ status: 'ok', signatures: sigs });
  } catch (e) {
    console.error('buy-fast error:', e.message);
    res.status(500).json({ error: 'internal error', details: e.message });
  }
});

// ========================================================
// SELL FAST (частичный sell %)
// ========================================================

app.post('/api/trade/sell-fast', async (req, res) => {
  try {
    const {
      walletSecretKeysBase58,
      mintAddress,
      sellPercent,
      slippagePercent,
      priorityFeeLamports,
    } = req.body || {};

    if (
      !Array.isArray(walletSecretKeysBase58) ||
      walletSecretKeysBase58.length === 0
    )
      return res
        .status(400)
        .json({ error: 'walletSecretKeysBase58[] required' });

    if (!mintAddress) return res.status(400).json({ error: 'mintAddress required' });

    const percent = Number(sellPercent);
    if (!isFinite(percent) || percent <= 0 || percent > 100)
      return res.status(400).json({ error: 'sellPercent must be 1–100' });

    const slip = Number(slippagePercent);
    const effectiveSlippage = slip > 0 && slip <= 100 ? slip : 20;

    const sigs = [];

    for (const sk of walletSecretKeysBase58) {
      try {
        const kp = Keypair.fromSecretKey(bs58.decode(sk));

        const tx = await buildPumpfunTx({
          walletKp: kp,
          mint: mintAddress,
          action: 'sell',
          amountSol: `${percent}%`,
          slippagePercent: effectiveSlippage,
          priorityFeeLamports,
        });

        if (!tx) continue;

        const sig = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
          maxRetries: 0,
        });

        try {
          await connection.confirmTransaction(sig, 'confirmed');
        } catch {}

        sigs.push({
          wallet: kp.publicKey.toBase58(),
          signature: sig,
        });
      } catch (e) {
        sigs.push({
          wallet: 'unknown',
          error: e.message,
        });
      }
    }

    if (sigs.length === 0)
      return res.status(500).json({ error: 'No sell transactions sent' });

    res.json({
      status: 'ok',
      txCount: sigs.length,
      signatures: sigs,
    });
  } catch (e) {
    console.error('sell-fast error:', e.message);
    res.status(500).json({ error: 'internal error', details: e.message });
  }
});

// ========================================================
// HEALTH CHECK + PING
// ========================================================

app.get('/api/ping', (_req, res) => {
  res.json({
    status: 'alive',
    rpc: RPC_ENDPOINT,
    jito: JITO_BUNDLE_URL,
    time: Date.now(),
  });
});

// ========================================================
// GLOBAL ERROR HANDLER
// ========================================================



app.use((err, req, res, next) => {
  console.error('🔥 GLOBAL ERROR:', err.message || err);
  res.status(500).json({
    error: 'Internal server error',
    details: err.message || String(err),
  });
});

// ========================================================
// FINAL CATCH-ALL ROUTE
// ========================================================

app.get('*', (_req, res) => {
  res.json({
    status: 'ok',
    info: 'Solana Pump.fun Bundler backend running',
    endpoints: [
      '/api/wallets/create',
      '/api/wallets/balances',
      '/api/wallets/fund',
      '/api/wallets/collect',
      '/api/trade/buy',
      '/api/trade/buy-fast',
      '/api/trade/buy-rest',
      '/api/trade/smart-buy',
      '/api/trade/sell-fast',
      '/api/trade/sell-all',
      '/api/trade/sell-all-v2',
      '/api/ping',
    ],
  });
});

// ========================================================
// SERVER START
// ========================================================

app.listen(PORT, () => {
  console.log('=======================================================');
  console.log(`🚀 Solana backend running on http://localhost:${PORT}`);
  console.log('📡 RPC:', RPC_ENDPOINT);
 console.log('⚡ JITO:', JITO_BUNDLE_URL);
  console.log('=======================================================');
});
