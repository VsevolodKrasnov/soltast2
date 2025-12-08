// backend/src/server.js
// ПОЛНАЯ ВЕРСИЯ: ВСЯ ОРИГИНАЛЬНАЯ ЛОГИКА + FRESH TRACKER + TOKEN API + PRO TRADING
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import bs58 from 'bs58';
import fetch from 'node-fetch';
import http from 'http';
import { setupFreshTrackerWebSocket } from './fresh-tracker-server.js';
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

const RPC_ENDPOINT =
  process.env.RPC_ENDPOINT ||
  process.env.HELIUS_RPC_URL ||
  'https://api.mainnet-beta.solana.com';

const JITO_BUNDLE_URL =
  process.env.JITO_BUNDLE_URL ||
  'https://mainnet.block-engine.jito.wtf/api/v1/bundles';

const PUMPFUN_TRADE_LOCAL_URL = 'https://pumpportal.fun/api/trade-local';

console.log('🔌 Using RPC:', RPC_ENDPOINT);
console.log('🚀 JITO bundle endpoint:', JITO_BUNDLE_URL);

const connection = new Connection(RPC_ENDPOINT, {
  commitment: 'confirmed',
});

app.use(cors());
app.use(bodyParser.json({ limit: '30mb' }));

let freshTrackerService = null;

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
// WALLET FACTORY
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
// PUMPFUN TX BUILDERS
// =============================

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
      denominatedInSol: true,
      amount: amountSol,
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

async function buildPumpfunSellAllTx({
  walletKp,
  mint,
  priorityFeeLamports,
  slippagePercent = 30,
}) {
  try {
    const priorityFeeSol = lamportsToSol(priorityFeeLamports || 0) || 0.0001;

    const body = {
      publicKey: walletKp.publicKey.toBase58(),
      action: 'sell',
      mint,
      denominatedInSol: false,
      amount: '100%',
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

// Universal builder for buy/sell with percent support
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

// =============================
// API 1: CREATE WALLETS
// =============================

app.post('/api/wallets/create', (req, res) => {
  try {
    const { count } = req.body || {};
    const n = Number(count);
    if (!isFinite(n) || n <= 0 || n > 100) {
      return res.status(400).json({ error: 'count must be 1-100' });
    }

    const wallets = createWallets(n);
    res.json({ status: 'ok', wallets });
  } catch (e) {
    console.error('Create wallets error:', e.message);
    res.status(500).json({ error: 'internal error' });
  }
});

// =============================
// API 2: GET WALLETS BALANCES
// =============================

app.post('/api/wallets/balances', async (req, res) => {
  try {
    const { wallets } = req.body || {};

    if (!Array.isArray(wallets) || wallets.length === 0) {
      return res.status(400).json({ error: 'wallets[] required' });
    }

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
    console.error('Balances error:', e.message);
    res.status(500).json({ error: 'internal error' });
  }
});

// =============================
// API 3: FUND WALLETS
// =============================

app.post('/api/wallets/fund', async (req, res) => {
  try {
    const {
      mainWalletPrivateKey,
      targetWallets,
      amountPerWallet,
      splitEqually,
    } = req.body || {};

    if (!mainWalletPrivateKey) {
      return res.status(400).json({ error: 'mainWalletPrivateKey required' });
    }

    if (!Array.isArray(targetWallets) || targetWallets.length === 0) {
      return res.status(400).json({ error: 'targetWallets[] required' });
    }

    const mainKp = Keypair.fromSecretKey(bs58.decode(mainWalletPrivateKey));
    const sigs = [];

    if (splitEqually) {
      const balance = await connection.getBalance(mainKp.publicKey);
      const availableLamports = balance - 5000 * targetWallets.length - 50000;
      const perWallet = Math.floor(availableLamports / targetWallets.length);

      if (perWallet <= 0) {
        return res.status(400).json({ error: 'Insufficient balance' });
      }

      for (const pkStr of targetWallets) {
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: mainKp.publicKey,
            toPubkey: new PublicKey(pkStr),
            lamports: perWallet,
          })
        );

        try {
          const sig = await sendAndConfirmTransaction(connection, tx, [mainKp]);
          sigs.push({ wallet: pkStr, signature: sig });
        } catch (e) {
          sigs.push({ wallet: pkStr, error: e.message });
        }
      }
    } else {
      const amounts = amountPerWallet || {};

      for (const pkStr of targetWallets) {
        const sol = Number(amounts[pkStr] || 0);
        if (sol <= 0) continue;

        const lamports = solToLamports(sol);
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: mainKp.publicKey,
            toPubkey: new PublicKey(pkStr),
            lamports,
          })
        );

        try {
          const sig = await sendAndConfirmTransaction(connection, tx, [mainKp]);
          sigs.push({ wallet: pkStr, signature: sig });
        } catch (e) {
          sigs.push({ wallet: pkStr, error: e.message });
        }
      }
    }

    res.json({ status: 'ok', signatures: sigs });
  } catch (e) {
    console.error('Fund error:', e.message);
    res.status(500).json({ error: 'internal error', details: e.message });
  }
});

// =============================
// API 4: COLLECT TO MAIN
// =============================

app.post('/api/wallets/collect', async (req, res) => {
  try {
    const { walletSecretKeysBase58, mainWalletAddress } = req.body || {};

    if (!Array.isArray(walletSecretKeysBase58) || walletSecretKeysBase58.length === 0) {
      return res.status(400).json({ error: 'walletSecretKeysBase58[] required' });
    }

    if (!mainWalletAddress) {
      return res.status(400).json({ error: 'mainWalletAddress required' });
    }

    const mainPubkey = new PublicKey(mainWalletAddress);
    const sigs = [];

    for (const sk of walletSecretKeysBase58) {
      try {
        const kp = Keypair.fromSecretKey(bs58.decode(sk));
        const balance = await connection.getBalance(kp.publicKey);
        const fee = 5000;

        if (balance <= fee) continue;

        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: kp.publicKey,
            toPubkey: mainPubkey,
            lamports: balance - fee,
          })
        );

        const sig = await sendAndConfirmTransaction(connection, tx, [kp]);
        sigs.push({ wallet: kp.publicKey.toBase58(), signature: sig });
      } catch (e) {
        sigs.push({ wallet: 'unknown', error: e.message });
      }
    }

    res.json({ status: 'ok', signatures: sigs });
  } catch (e) {
    console.error('Collect error:', e.message);
    res.status(500).json({ error: 'internal error', details: e.message });
  }
});

// =============================
// API 5: BUY (original)
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

    if (!Array.isArray(walletSecretKeysBase58) || walletSecretKeysBase58.length === 0) {
      return res.status(400).json({ error: 'walletSecretKeysBase58[] required' });
    }

    if (!mintAddress) {
      return res.status(400).json({ error: 'mintAddress required' });
    }

    const sol = Number(amountSolPerWallet || 0);
    if (sol <= 0) {
      return res.status(400).json({ error: 'amountSolPerWallet must be > 0' });
    }

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

    if (sigs.length === 0) {
      return res.status(500).json({ error: 'No transactions sent' });
    }

    res.json({ status: 'ok', txCount: sigs.length, signatures: sigs });
  } catch (e) {
    console.error('buy error:', e.message);
    res.status(500).json({ error: 'internal error', details: e.message });
  }
});

// =============================
// API 6: BUY-FAST (with retries - FOR PRO TRADING)
// =============================

app.post('/api/trade/buy-fast', async (req, res) => {
  try {
    const {
      walletSecretKeysBase58,
      mintAddress,
      amountSolPerWallet,
      priorityFeeLamports,
      slippagePercent,
      maxRetries = 3,
    } = req.body || {};

    if (!Array.isArray(walletSecretKeysBase58) || walletSecretKeysBase58.length === 0) {
      return res.status(400).json({ error: 'walletSecretKeysBase58[] required' });
    }

    if (!mintAddress) {
      return res.status(400).json({ error: 'mintAddress required' });
    }

    const sol = Number(amountSolPerWallet || 0);
    if (sol <= 0) {
      return res.status(400).json({ error: 'amountSolPerWallet must be > 0' });
    }

    const slip = Number(slippagePercent);
    const effectiveSlippage = slip > 0 && slip <= 100 ? slip : 20;

    console.log(`🚀 BUY-FAST: ${walletSecretKeysBase58.length} wallets, ${sol} SOL each`);

    const results = [];

    for (const sk of walletSecretKeysBase58) {
      let lastError = null;
      let success = false;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const kp = Keypair.fromSecretKey(bs58.decode(sk));

          const tx = await buildPumpfunBuyTx({
            walletKp: kp,
            mint: mintAddress,
            amountSol: sol,
            priorityFeeLamports,
            slippagePercent: effectiveSlippage,
          });

          if (!tx) {
            throw new Error('Failed to build transaction');
          }

          const sig = await connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: true,
            maxRetries: 0,
          });

          try {
            await connection.confirmTransaction(sig, 'confirmed');
          } catch {}

          results.push({
            wallet: kp.publicKey.toBase58(),
            signature: sig,
            attempt,
          });

          success = true;
          break;
        } catch (e) {
          lastError = e;
          console.error(`Attempt ${attempt}/${maxRetries} failed:`, e.message);
          
          if (attempt < maxRetries) {
            await sleep(1000 * attempt);
          }
        }
      }

      if (!success) {
        results.push({
          wallet: 'unknown',
          error: lastError?.message || 'All retries failed',
        });
      }
    }

    res.json({
      status: 'ok',
      txCount: results.filter(r => r.signature).length,
      signatures: results,
    });
  } catch (e) {
    console.error('buy-fast error:', e.message);
    res.status(500).json({ error: 'internal error', details: e.message });
  }
});

// =============================
// API 7: BUY-REST (proportional buy)
// =============================

app.post('/api/trade/buy-rest', async (req, res) => {
  try {
    const { mintAddress, slippagePercent, perWalletAmounts } = req.body || {};

    if (!mintAddress) {
      return res.status(400).json({ error: 'mintAddress required' });
    }

    if (!Array.isArray(perWalletAmounts) || perWalletAmounts.length === 0) {
      return res.status(400).json({ error: 'perWalletAmounts[] required' });
    }

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
          solUsed: w.solAmount,
        });
      } catch (e) {
        console.error('buy-rest error:', e.message);
      }
    }

    if (sigs.length === 0) {
      return res.status(500).json({ error: 'No buy-rest transactions sent' });
    }

    res.json({ status: 'ok', txCount: sigs.length, signatures: sigs });
  } catch (e) {
    console.error('buy-rest error:', e.message);
    res.status(500).json({ error: 'internal error', details: e.message });
  }
});

// =============================
// API 8: SMART-BUY (random amounts + delays)
// =============================

app.post('/api/trade/smart-buy', async (req, res) => {
  try {
    const {
      mintAddress,
      wallets,
      minBuyPercent,
      maxBuyPercent,
      minBuySol,
      minDelaySec,
      maxDelaySec,
      slippagePercent,
      priorityFeeLamports,
    } = req.body || {};

    if (!mintAddress) {
      return res.status(400).json({ error: 'mintAddress required' });
    }

    if (!Array.isArray(wallets) || wallets.length === 0) {
      return res.status(400).json({ error: 'wallets[] required' });
    }

    let minPct = Number(minBuyPercent);
    let maxPct = Number(maxBuyPercent);

    if (!isFinite(minPct) || !isFinite(maxPct)) {
      return res.status(400).json({ error: 'minBuyPercent/maxBuyPercent required' });
    }

    if (minPct <= 0 || maxPct <= 0 || maxPct < minPct) {
      return res.status(400).json({ error: 'percent ranges invalid' });
    }

    let minBuySolAbs = Number(minBuySol);
    if (!isFinite(minBuySolAbs) || minBuySolAbs < 0.01) {
      minBuySolAbs = 0.01;
    }

    let minDelay = Number(minDelaySec);
    let maxDelay = Number(maxDelaySec);

    if (!isFinite(minDelay) || minDelay < 0.1) minDelay = 0.1;
    if (!isFinite(maxDelay) || maxDelay < minDelay) maxDelay = minDelay;
    if (maxDelay > 10) maxDelay = 10;

    const slip = Number(slippagePercent);
    const effectiveSlippage = slip > 0 && slip <= 100 ? slip : 10;

    const results = [];
    let sentCount = 0;

    for (const w of wallets) {
      const walletPub = w.publicKey;
      const walletSec = w.secretKey;
      const balance = Number(w.solBalance || 0);

      if (!walletPub || !walletSec) {
        results.push({
          wallet: walletPub || 'unknown',
          skipped: true,
          reason: 'missing keys',
        });
        continue;
      }

      if (balance <= 0) {
        results.push({
          wallet: walletPub,
          skipped: true,
          reason: 'zero balance',
        });
        continue;
      }

      const randomPct = randRange(minPct, maxPct);
      let buyAmt = (balance * randomPct) / 100;

      if (buyAmt < minBuySolAbs) {
        buyAmt = minBuySolAbs;
      }

      if (buyAmt > balance - 0.001) {
        buyAmt = balance - 0.001;
      }

      if (buyAmt <= 0) {
        results.push({
          wallet: walletPub,
          skipped: true,
          reason: 'insufficient after min',
        });
        continue;
      }

      const delaySec = randRange(minDelay, maxDelay);
      await sleep(delaySec * 1000);

      try {
        const kp = Keypair.fromSecretKey(bs58.decode(walletSec));

        const tx = await buildPumpfunBuyTx({
          walletKp: kp,
          mint: mintAddress,
          amountSol: buyAmt,
          priorityFeeLamports,
          slippagePercent: effectiveSlippage,
        });

        if (!tx) {
          results.push({
            wallet: walletPub,
            skipped: true,
            reason: 'tx build failed',
          });
          continue;
        }

        const sig = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
          maxRetries: 0,
        });

        try {
          await connection.confirmTransaction(sig, 'confirmed');
        } catch {}

        results.push({
          wallet: walletPub,
          signature: sig,
          solBought: buyAmt,
        });

        sentCount++;
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
// API 9: SELL-FAST (with retries - FOR PRO TRADING)
// =============================

app.post('/api/trade/sell-fast', async (req, res) => {
  try {
    const {
      walletSecretKeysBase58,
      mintAddress,
      sellPercent = 100,
      priorityFeeLamports,
      slippagePercent,
      maxRetries = 3,
    } = req.body || {};

    if (!Array.isArray(walletSecretKeysBase58) || walletSecretKeysBase58.length === 0) {
      return res.status(400).json({ error: 'walletSecretKeysBase58[] required' });
    }

    if (!mintAddress) {
      return res.status(400).json({ error: 'mintAddress required' });
    }

    const percent = Number(sellPercent);
    if (percent <= 0 || percent > 100) {
      return res.status(400).json({ error: 'sellPercent must be 1-100' });
    }

    const slip = Number(slippagePercent);
    const effectiveSlippage = slip > 0 && slip <= 100 ? slip : 20;

    console.log(`🔴 SELL-FAST: ${walletSecretKeysBase58.length} wallets, ${percent}%`);

    const results = [];

    for (const sk of walletSecretKeysBase58) {
      let lastError = null;
      let success = false;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
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

          if (!tx) {
            throw new Error('Failed to build transaction');
          }

          const sig = await connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: true,
            maxRetries: 0,
          });

          try {
            await connection.confirmTransaction(sig, 'confirmed');
          } catch {}

          results.push({
            wallet: kp.publicKey.toBase58(),
            signature: sig,
            attempt,
          });

          success = true;
          break;
        } catch (e) {
          lastError = e;
          console.error(`Attempt ${attempt}/${maxRetries} failed:`, e.message);
          
          if (attempt < maxRetries) {
            await sleep(1000 * attempt);
          }
        }
      }

      if (!success) {
        results.push({
          wallet: 'unknown',
          error: lastError?.message || 'All retries failed',
        });
      }
    }

    res.json({
      status: 'ok',
      txCount: results.filter(r => r.signature).length,
      signatures: results,
    });
  } catch (e) {
    console.error('sell-fast error:', e.message);
    res.status(500).json({ error: 'internal error', details: e.message });
  }
});

// =============================
// API 10: SELL-ALL (JITO bundle + fallback)
// =============================

app.post('/api/trade/sell-all', async (req, res) => {
  try {
    const {
      walletSecretKeysBase58,
      mintAddress,
      priorityFeeLamports,
      slippagePercent,
    } = req.body || {};

    if (!Array.isArray(walletSecretKeysBase58) || walletSecretKeysBase58.length === 0) {
      return res.status(400).json({ error: 'walletSecretKeysBase58[] required' });
    }

    if (!mintAddress) {
      return res.status(400).json({ error: 'mintAddress required' });
    }

    const slip = Number(slippagePercent);
    const effectiveSlippage = slip > 0 && slip <= 100 ? slip : 30;

    const builtTxs = [];

    // Build all sell-all transactions
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
          rawTx: raw,
        });
      } catch (e) {
        console.error('SELL-ALL build error:', e.message);
      }
    }

    if (builtTxs.length === 0) {
      return res.status(500).json({ error: 'No sell-all transactions built' });
    }

    // Try JITO BUNDLE first
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

      if (jitoResp.ok) {
        const sigs = builtTxs.map((tx) => ({
          wallet: tx.wallet,
          signature: '(JITO bundle) – check solscan',
        }));

        return res.json({
          status: 'ok',
          mode: 'jito-bundle',
          txCount: builtTxs.length,
          signatures: sigs,
        });
      }

      console.warn('⚠️ JITO bundle failed, falling back to RPC');
    } catch (e) {
      console.error('❌ JITO bundle error:', e.message);
    }

    // Fallback to regular RPC
    const sigs = [];

    for (const tx of builtTxs) {
      try {
        const sig = await connection.sendRawTransaction(tx.rawTx, {
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
// API 11: SELL-ALL-V2 (alternative JITO implementation)
// =============================

app.post('/api/trade/sell-all-v2', async (req, res) => {
  try {
    const {
      walletSecretKeysBase58,
      mintAddress,
      priorityFeeLamports,
      slippagePercent,
    } = req.body || {};

    if (!Array.isArray(walletSecretKeysBase58) || walletSecretKeysBase58.length === 0) {
      return res.status(400).json({ error: 'walletSecretKeysBase58[] required' });
    }

    if (!mintAddress) {
      return res.status(400).json({ error: 'mintAddress required' });
    }

    const slip = Number(slippagePercent);
    const effectiveSlippage = slip > 0 && slip <= 100 ? slip : 35;

    const built = [];

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

    if (built.length === 0) {
      return res.status(500).json({ error: 'No sell-all transactions built' });
    }

    // Try JITO
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

    // Fallback
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

// =============================
// TOKEN INFO & PRICE APIs (FOR PRO TRADING)
// =============================

app.get('/api/token/info', async (req, res) => {
  try {
    const { mint } = req.query;
    
    if (!mint) {
      return res.status(400).json({ error: 'mint parameter required' });
    }

    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await response.json();

    if (!data.pairs || data.pairs.length === 0) {
      return res.status(404).json({ error: 'Token not found' });
    }

    const mainPair = data.pairs.sort((a, b) => 
      (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
    )[0];

    const tokenInfo = {
      address: mint,
      symbol: mainPair.baseToken.symbol,
      name: mainPair.baseToken.name,
      price: parseFloat(mainPair.priceUsd || 0),
      priceChange24h: parseFloat(mainPair.priceChange?.h24 || 0),
      volume24h: parseFloat(mainPair.volume?.h24 || 0),
      marketCap: parseFloat(mainPair.fdv || 0),
      liquidity: parseFloat(mainPair.liquidity?.usd || 0),
      liquiditySOL: parseFloat(mainPair.liquidity?.base || 0),
      pairAddress: mainPair.pairAddress,
      dexId: mainPair.dexId,
      url: mainPair.url,
    };

    res.json(tokenInfo);
  } catch (e) {
    console.error('Token info error:', e);
    res.status(500).json({ error: 'Failed to fetch token info', details: e.message });
  }
});

app.get('/api/token/price', async (req, res) => {
  try {
    const { mint } = req.query;
    
    if (!mint) {
      return res.status(400).json({ error: 'mint parameter required' });
    }

    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await response.json();

    if (!data.pairs || data.pairs.length === 0) {
      return res.status(404).json({ error: 'Token not found' });
    }

    const mainPair = data.pairs[0];
    const price = parseFloat(mainPair.priceUsd || 0);

    res.json({ 
      price,
      priceNative: parseFloat(mainPair.priceNative || 0),
      timestamp: Date.now()
    });
  } catch (e) {
    console.error('Token price error:', e);
    res.status(500).json({ error: 'Failed to fetch token price', details: e.message });
  }
});

// =============================
// FRESH TRACKER REST API
// =============================

app.get('/api/fresh/trades', (req, res) => {
  if (!freshTrackerService) {
    return res.status(503).json({ error: 'Fresh Tracker not initialized' });
  }
  
  const limit = parseInt(req.query.limit) || 100;
  const trades = freshTrackerService.getRecentTrades().slice(0, limit);
  
  res.json({
    status: 'ok',
    count: trades.length,
    trades: trades
  });
});

app.post('/api/fresh/analyze-wallet', (req, res) => {
  const { walletAddress } = req.body;
  
  if (!walletAddress) {
    return res.status(400).json({ error: 'walletAddress required' });
  }
  
  if (!freshTrackerService) {
    return res.status(503).json({ error: 'Fresh Tracker not initialized' });
  }
  
  freshTrackerService.requestWalletAnalysis(walletAddress);
  
  res.json({
    status: 'ok',
    message: 'Analysis requested'
  });
});

// =============================
// HEALTH CHECK
// =============================

app.get('/api/ping', (_req, res) => {
  res.json({
    status: 'alive',
    rpc: RPC_ENDPOINT,
    jito: JITO_BUNDLE_URL,
    fresh_tracker: !!freshTrackerService,
    time: Date.now(),
  });
});

app.get('/', (_req, res) => {
  res.json({ status: 'ok', message: 'Solana bundler backend alive' });
});

// =============================
// ERROR HANDLERS
// =============================

app.use((err, req, res, next) => {
  console.error('🔥 GLOBAL ERROR:', err.message || err);
  res.status(500).json({
    error: 'Internal server error',
    details: err.message || String(err),
  });
});

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
      '/api/token/info',
      '/api/token/price',
      '/api/fresh/trades',
      '/api/fresh/analyze-wallet',
      '/api/ping',
    ],
  });
});

// =============================
// SERVER START WITH WEBSOCKET
// =============================

const httpServer = http.createServer(app);

// Setup Fresh Tracker WebSocket
freshTrackerService = setupFreshTrackerWebSocket(httpServer);

httpServer.listen(PORT, () => {
  console.log('=======================================================');
  console.log(`🚀 Solana backend running on http://localhost:${PORT}`);
  console.log('📡 RPC:', RPC_ENDPOINT);
  console.log('⚡ JITO:', JITO_BUNDLE_URL);
  console.log('🔴 Fresh Tracker WS: ws://localhost:' + PORT + '/fresh-tracker');
  console.log('=======================================================');
});