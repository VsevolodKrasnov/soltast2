// src/components/SmartBuyPanel.jsx
import React, { useState, useEffect, useMemo } from "react";

export default function SmartBuyPanel({
  wallets,
  selectedWallets,
  selectedWalletObjects,
  mint,
  priorityFee,
  slippage,
  lamportsFromSol,
  callBackend,
}) {
  const [mode, setMode] = useState("buy"); // 'buy' | 'sell'

  // ----- BUY RANGE -----
  const [buyFromSol, setBuyFromSol] = useState("0.01");
  const [buyToSol, setBuyToSol] = useState("0.05");

  // ----- SELL RANGE -----
  const [sellFromPercent, setSellFromPercent] = useState("50");
  const [sellToPercent, setSellToPercent] = useState("100");

  const [localPriorityFee, setLocalPriorityFee] = useState(
    priorityFee || 0.0001
  );
  const [localSlippage, setLocalSlippage] = useState(slippage || 10);
  const [maxDelaySec, setMaxDelaySec] = useState("0.3"); // max random delay between tx

  const [log, setLog] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  // BALANCES выбранных кошельков
  const [balances, setBalances] = useState({});
  const [loadingBalances, setLoadingBalances] = useState(false);

  const selectedCount = selectedWalletObjects.length;

  const parseNumberSafe = (v, def = 0) => {
    if (v === "" || v == null) return def;
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : def;
  };

  const appendLog = (line) => {
    setLog((prev) => (prev ? `${prev}\n${line}` : line));
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // =========================
  // BALANCES (selected only)
  // =========================
  const refreshSelectedBalances = async () => {
    if (!selectedWalletObjects.length) {
      setBalances({});
      return;
    }
    try {
      setLoadingBalances(true);
      const res = await fetch("/api/wallets/balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // ВАЖНО: backend ждёт { wallets: [...] }
          wallets: selectedWalletObjects.map((w) => w.publicKey),
        }),
      });

      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error("Invalid JSON from /api/wallets/balances");
      }

      if (data.error) throw new Error(data.error);
      setBalances(data.balances || {});
    } catch (e) {
      appendLog(`⚠️ Balances error: ${e.message}`);
    } finally {
      setLoadingBalances(false);
    }
  };

  // автообновление, когда меняется набор выбранных
  useEffect(() => {
    if (selectedWalletObjects.length) {
      refreshSelectedBalances();
    } else {
      setBalances({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWalletObjects.map((w) => w.publicKey).join(",")]);

  const totalSelectedSol = useMemo(() => {
    if (!selectedWalletObjects.length) return 0;
    return selectedWalletObjects.reduce((sum, w) => {
      const bal = balances[w.publicKey];
      return sum + (typeof bal === "number" ? bal : 0);
    }, 0);
  }, [selectedWalletObjects, balances]);

  // =========================
  // VALIDATION + ESTIMATES
  // =========================
  const minBuy = Math.max(parseNumberSafe(buyFromSol, 0), 0.01);
  const maxBuy = Math.max(parseNumberSafe(buyToSol, 0), minBuy);
  const buyRangeValid = minBuy >= 0.01 && maxBuy >= minBuy;

  const avgBuyPerWallet = useMemo(() => {
    if (!buyRangeValid) return 0;
    return (minBuy + maxBuy) / 2;
  }, [minBuy, maxBuy, buyRangeValid]);

  const estimatedTotalBuy = useMemo(() => {
    if (!buyRangeValid || !selectedCount) return 0;
    return avgBuyPerWallet * selectedCount;
  }, [avgBuyPerWallet, selectedCount, buyRangeValid]);

  const sellFrom = Math.max(parseNumberSafe(sellFromPercent, 0), 0);
  const sellTo = Math.min(
    100,
    Math.max(parseNumberSafe(sellToPercent, 0), sellFrom)
  );
  const sellRangeValid =
    sellFrom >= 0 && sellTo <= 100 && sellTo >= sellFrom && sellTo > 0;

  const avgSellPercent = useMemo(() => {
    if (!sellRangeValid) return 0;
    return (sellFrom + sellTo) / 2;
  }, [sellFrom, sellTo, sellRangeValid]);

  const canRunBuy = !!mint && selectedCount > 0 && buyRangeValid;
  const canRunSell = !!mint && selectedCount > 0 && sellRangeValid;
  const canSellAll = !!mint && wallets.length > 0;

  const short = (pk) =>
    pk && pk.length > 8 ? `${pk.slice(0, 4)}…${pk.slice(-4)}` : pk;

  // =========================
  // SMART BUY (RANGE)
  // =========================
  const handleSmartBuy = async () => {
    if (!canRunBuy) {
      appendLog(
        "⚠️ Smart buy: проверь mint, выбранные кошельки и диапазон Amount per wallet."
      );
      return;
    }

    const delayMax = Math.max(0, parseNumberSafe(maxDelaySec, 0));
    const pf = parseNumberSafe(localPriorityFee, 0);
    const sl = parseNumberSafe(localSlippage, 10);

    setIsRunning(true);
    appendLog(
      `▶️ Smart buy: ${selectedCount} wallets, random ${minBuy.toFixed(
        4
      )}–${maxBuy.toFixed(4)} SOL per wallet, slippage ${sl}%, priority fee ${pf} SOL`
    );

    try {
      const walletQueue = [...selectedWalletObjects];

      for (const w of walletQueue) {
        const delaySec = delayMax > 0 ? Math.random() * delayMax : 0;
        if (delaySec > 0) {
          appendLog(
            `⏱ Waiting ${delaySec.toFixed(
              2
            )}s before buy for ${short(w.publicKey)}...`
          );
          await sleep(delaySec * 1000);
        }

        // рандом для этого кошелька
        const randSol =
          minBuy + Math.random() * Math.max(maxBuy - minBuy, 0);

        appendLog(
          `🟢 Buying ~${randSol.toFixed(4)} SOL from ${short(
            w.publicKey
          )}...`
        );
        try {
          const res = await callBackend("/api/trade/buy", {
            mintAddress: mint,
            walletSecretKeysBase58: [w.secretKey],
            amountSolPerWallet: randSol, // backend ждёт SOL, не лампорты
            priorityFeeLamports: Math.floor(pf * 1e9),
            slippagePercent: sl,
          });

          appendLog(
            `✅ Buy ok (${short(w.publicKey)}): tx = ${
              res?.signature ||
              res?.txSignature ||
              res?.sigs?.[0]?.signature ||
              "unknown"
            }`
          );
        } catch (err) {
          appendLog(
            `❌ Buy failed (${short(w.publicKey)}): ${
              err?.message || String(err)
            }`
          );
        }
      }

      appendLog("✅ Smart buy finished.");
    } catch (err) {
      appendLog(`💥 Smart buy error: ${err?.message || String(err)}`);
    } finally {
      setIsRunning(false);
    }
  };

  // =========================
  // BUY THE REST (proportional)
  // =========================
  const handleBuyTheRest = async () => {
    if (!mint || !selectedCount) {
      appendLog("⚠️ BUY THE REST: нужен mint и выбранные кошельки.");
      return;
    }

    // если балансы ещё не загружены — подтянем
    if (!Object.keys(balances).length) {
      await refreshSelectedBalances();
    }

    const totalSol = totalSelectedSol;
    if (!totalSol || totalSol <= 0) {
      appendLog("⚠️ BUY THE REST: на выбранных кошельках 0 SOL.");
      return;
    }

    const pf = parseNumberSafe(localPriorityFee, 0);
    const sl = parseNumberSafe(localSlippage, 10);

    const feePerTx = pf + 0.0005; // priority + примерная сеть
    const totalFees = feePerTx * selectedCount;
    const available = totalSol - totalFees;

    if (available <= 0) {
      appendLog(
        `⚠️ BUY THE REST: после вычета комиссий SOL не остаётся (total=${totalSol.toFixed(
          4
        )}, fees≈${totalFees.toFixed(4)}).`
      );
      return;
    }

    appendLog(
      `▶️ BUY THE REST: total SOL on selected ≈ ${totalSol.toFixed(
        4
      )}, available for buy ≈ ${available.toFixed(
        4
      )} (after fees), wallets: ${selectedCount}`
    );

    setIsRunning(true);

    try {
      for (const w of selectedWalletObjects) {
        const bal =
          typeof balances[w.publicKey] === "number"
            ? balances[w.publicKey]
            : 0;

        if (bal <= 0) {
          appendLog(`⏭ Skip ${short(w.publicKey)} (0 SOL).`);
          continue;
        }

        const share = bal / totalSol;
        const walletSol = available * share;
        if (walletSol <= 0) {
          appendLog(`⏭ Skip ${short(w.publicKey)} (share too small).`);
          continue;
        }

        appendLog(
          `🟢 BUY THE REST for ${short(
            w.publicKey
          )}: ~${walletSol.toFixed(4)} SOL (share ${(share * 100).toFixed(
            1
          )}%)`
        );

        try {
          const res = await callBackend("/api/trade/buy", {
            mintAddress: mint,
            walletSecretKeysBase58: [w.secretKey],
            amountSolPerWallet: walletSol,
            priorityFeeLamports: Math.floor(pf * 1e9),
            slippagePercent: sl,
          });

          appendLog(
            `✅ Buy ok (${short(w.publicKey)}): tx = ${
              res?.signature ||
              res?.txSignature ||
              res?.sigs?.[0]?.signature ||
              "unknown"
            }`
          );
        } catch (err) {
          appendLog(
            `❌ Buy failed (${short(w.publicKey)}): ${
              err?.message || String(err)
            }`
          );
        }
      }

      appendLog("✅ BUY THE REST finished.");
    } catch (err) {
      appendLog(`💥 BUY THE REST error: ${err?.message || String(err)}`);
    } finally {
      setIsRunning(false);
    }
  };

  // =========================
  // SMART SELL (RANGE)
  // =========================
  const handleSmartSell = async () => {
    if (!canRunSell) {
      appendLog(
        "⚠️ Smart sell: нужен mint, выбранные кошельки и корректный диапазон процента."
      );
      return;
    }

    const delayMax = Math.max(0, parseNumberSafe(maxDelaySec, 0));
    const pf = parseNumberSafe(localPriorityFee, 0);
    const sl = parseNumberSafe(localSlippage, 10);

    appendLog(
      `▶️ Smart sell: ${selectedCount} wallets, random ${sellFrom.toFixed(
        1
      )}–${sellTo.toFixed(1)}% per wallet, slippage ${sl}%, priority fee ${pf} SOL`
    );

    setIsRunning(true);

    try {
      for (const w of selectedWalletObjects) {
        const delaySec = delayMax > 0 ? Math.random() * delayMax : 0;
        if (delaySec > 0) {
          appendLog(
            `⏱ Waiting ${delaySec.toFixed(
              2
            )}s before sell for ${short(w.publicKey)}...`
          );
          await sleep(delaySec * 1000);
        }

        const percent =
          sellFrom + Math.random() * Math.max(sellTo - sellFrom, 0);

        appendLog(
          `🔻 Selling ~${percent.toFixed(1)}% from ${short(
            w.publicKey
          )}...`
        );
        try {
          const res = await callBackend("/api/smart-sell", {
            mint,
            walletPublicKey: w.publicKey,
            walletSecretKey: w.secretKey,
            sellPercent: percent,
            priorityFee: pf,
            slippage: sl,
          });

          appendLog(
            `✅ Sell ok (${short(w.publicKey)}): tx = ${
              res?.txSignature || "unknown"
            }`
          );
        } catch (err) {
          appendLog(
            `❌ Sell failed (${short(w.publicKey)}): ${
              err?.message || String(err)
            }`
          );
        }
      }

      appendLog("✅ Smart sell finished.");
    } catch (err) {
      appendLog(`💥 Smart sell error: ${err?.message || String(err)}`);
    } finally {
      setIsRunning(false);
    }
  };

  // =========================
  // SELL ALL (all wallets)
  // =========================
  const handleSellAll = async () => {
    if (!canSellAll) {
      appendLog("⚠️ Sell all: нет кошельков или не указан mint.");
      return;
    }

    const pf = parseNumberSafe(localPriorityFee, 0);
    const sl = parseNumberSafe(localSlippage, 10);

    setIsRunning(true);
    appendLog(
      `▶️ SELL ALL: ${wallets.length} wallets, 100% from each, slippage ${sl}%, priority fee ${pf} SOL`
    );

    try {
      for (const w of wallets) {
        appendLog(`🟥 SELL ALL from ${short(w.publicKey)}...`);
        try {
          const res = await callBackend("/api/sell-all", {
            mint,
            walletPublicKey: w.publicKey,
            walletSecretKey: w.secretKey,
            priorityFee: pf,
            slippage: sl,
          });

          appendLog(
            `✅ Sell all ok (${short(w.publicKey)}): tx = ${
              res?.txSignature || "unknown"
            }`
          );
        } catch (err) {
          appendLog(
            `❌ Sell all failed (${short(w.publicKey)}): ${
              err?.message || String(err)
            }`
          );
        }
      }

      appendLog("✅ SELL ALL finished.");
    } catch (err) {
      appendLog(`💥 SELL ALL error: ${err?.message || String(err)}`);
    } finally {
      setIsRunning(false);
    }
  };

  // =========================
  // JSX
  // =========================
  return (
    <div>
      <h2>Smart buy</h2>

      {/* Mint */}
      <label>Mint (pump.fun)</label>
      <div className="row">
        <input
          type="text"
          value={mint}
          readOnly
          placeholder="Mint is set in main panel"
        />
      </div>

      {/* INFO: selected + total SOL */}
      <p className="hint" style={{ marginTop: 8 }}>
        Selected wallets: <b>{selectedCount}</b> / {wallets.length}{" "}
        {loadingBalances
          ? "(loading balances...)"
          : totalSelectedSol > 0
          ? `• Total: ~${totalSelectedSol.toFixed(4)} SOL`
          : ""}
      </p>

      {/* Tabs: BUY / SELL */}
      <div className="buy-sell-tabs">
        <div
          className={
            "buy-sell-tab " + (mode === "buy" ? "active-buy" : "")
          }
          onClick={() => setMode("buy")}
        >
          Smart buy
        </div>
        <div
          className={
            "buy-sell-tab " + (mode === "sell" ? "active-sell" : "")
          }
          onClick={() => setMode("sell")}
        >
          Smart sell
        </div>
      </div>

      {/* Global settings */}
      <div className="row">
        <div style={{ flex: 1 }}>
          <label>Slippage (%)</label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={localSlippage}
            onChange={(e) => setLocalSlippage(e.target.value)}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label>Priority fee (SOL)</label>
          <input
            type="number"
            min="0"
            step="0.000001"
            value={localPriorityFee}
            onChange={(e) => setLocalPriorityFee(e.target.value)}
          />
        </div>
      </div>

      <div className="row">
        <div style={{ flex: 1 }}>
          <label>Max random delay between tx (sec)</label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={maxDelaySec}
            onChange={(e) => setMaxDelaySec(e.target.value)}
          />
        </div>
      </div>

      {/* ================= BUY MODE ================= */}
      {mode === "buy" && (
        <>
          <label>Amount per wallet (SOL)</label>
          <div className="row">
            <input
              type="number"
              min="0.01"
              step="0.001"
              value={buyFromSol}
              onChange={(e) => setBuyFromSol(e.target.value)}
              placeholder="From"
            />
            <span style={{ padding: "0 8px", alignSelf: "center" }}>
              to
            </span>
            <input
              type="number"
              min="0.01"
              step="0.001"
              value={buyToSol}
              onChange={(e) => setBuyToSol(e.target.value)}
              placeholder="To"
            />
          </div>

          <p className="hint" style={{ marginTop: 6 }}>
            Random per wallet: ~
            <b>{avgBuyPerWallet.toFixed(4)} SOL</b>. Estimated total buy: ~
            <b> {estimatedTotalBuy.toFixed(4)} SOL</b>.
          </p>

          <div className="row" style={{ marginTop: 10 }}>
            <button
              onClick={handleSmartBuy}
              disabled={!canRunBuy || isRunning}
            >
              Smart buy
            </button>

            <button
              className="ghost-btn"
              type="button"
              onClick={handleBuyTheRest}
              disabled={!selectedCount || isRunning}
              style={{ marginLeft: 8 }}
            >
              BUY THE REST
            </button>

            <a
              className="ghost-btn"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setLog("");
              }}
              style={{ marginLeft: 8 }}
            >
              Clear log
            </a>
          </div>
        </>
      )}

      {/* ================= SELL MODE ================= */}
      {mode === "sell" && (
        <>
          <label>Sell percent range (%)</label>
          <div className="row">
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={sellFromPercent}
              onChange={(e) => setSellFromPercent(e.target.value)}
              placeholder="From %"
            />
            <span style={{ padding: "0 8px", alignSelf: "center" }}>
              to
            </span>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={sellToPercent}
              onChange={(e) => setSellToPercent(e.target.value)}
              placeholder="To %"
            />
          </div>

          <p className="hint" style={{ marginTop: 6 }}>
            Random sell per wallet: ~
            <b>{avgSellPercent.toFixed(1)}%</b>.
          </p>

          <div className="row" style={{ marginTop: 10 }}>
            <button
              onClick={handleSmartSell}
              disabled={!canRunSell || isRunning}
            >
              Smart sell
            </button>
            <button
              onClick={handleSellAll}
              disabled={!canSellAll || isRunning}
              style={{ marginLeft: 8 }}
            >
              Sell all
            </button>
          </div>
        </>
      )}

      {/* LOGS */}
      <div className="log-box" style={{ marginTop: 16 }}>
        {log || "No log yet."}
      </div>
    </div>
  );
}
