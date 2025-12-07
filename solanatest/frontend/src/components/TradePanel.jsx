// src/components/TradePanel.jsx
import React, { useMemo, useState, useEffect } from "react";

export default function TradePanel({
  wallets,
  selectedWallets,
  setSelectedWallets,
  mint,
  setMint,
}) {
  const [mode, setMode] = useState("buy");
  const [amountSol, setAmountSol] = useState(0.01);
  const [percentBuy, setPercentBuy] = useState(100);
  const [priorityFee, setPriorityFee] = useState(0.0001);

  // NEW: SLIPPAGE
  const [slippage, setSlippage] = useState(10);

  const [log, setLog] = useState("");

  const [groups, setGroups] = useState([]);
  const [groupName, setGroupName] = useState("");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem("walletGroupsByRange");
      if (raw) setGroups(JSON.parse(raw));
    } catch {}
  }, []);

  const saveGroups = (next) => {
    setGroups(next);
    try {
      localStorage.setItem("walletGroupsByRange", JSON.stringify(next));
    } catch {}
  };

  const createGroupFromRange = () => {
    const from = Number(rangeFrom);
    const to = Number(rangeTo);

    if (!groupName.trim()) {
      alert("Set group name");
      return;
    }
    if (!from || !to || from < 1 || to < from || to > wallets.length) {
      alert(`Range must be between 1 and ${wallets.length}`);
      return;
    }

    const slice = wallets.slice(from - 1, to);
    const pks = slice.map((w) => w.publicKey);

    if (!pks.length) {
      alert("No wallets in this range");
      return;
    }

    const next = [
      ...groups,
      {
        id: Date.now(),
        name: groupName.trim(),
        from,
        to,
        wallets: pks,
      },
    ];
    saveGroups(next);
    setGroupName("");
  };

  const applyGroup = (g) => {
    if (!g || !g.wallets) return;
    setSelectedWallets(g.wallets);
  };

  const deleteGroup = (id) => {
    const next = groups.filter((g) => g.id !== id);
    saveGroups(next);
  };

  const selectedWalletObjects = useMemo(() => {
    if (!wallets || !wallets.length) return [];
    return wallets.filter((w) => selectedWallets.includes(w.publicKey));
  }, [wallets, selectedWallets]);

  const finalSolPerWallet = useMemo(() => {
    const base = Number(amountSol) || 0;
    return (base * (Number(percentBuy) || 0)) / 100;
  }, [amountSol, percentBuy]);

  const lamportsFromSol = (sol) =>
    Math.floor((Number(sol) || 0) * 1e9);

  const callBackend = async (endpoint, body) => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error);
    setLog(JSON.stringify(data, null, 2));
  };

  // -----------------------
  // BUY ACTION
  // -----------------------
  const handleBuy = async () => {
    if (!mint.trim()) {
      alert("Set token mint");
      return;
    }
    if (!selectedWalletObjects.length) {
      alert("Select wallets first");
      return;
    }
    if (finalSolPerWallet <= 0) {
      alert("Amount must be > 0");
      return;
    }

    try {
      await callBackend("/api/trade/buy", {
        mintAddress: mint.trim(),
        amountSolPerWallet: Number(finalSolPerWallet),
        priorityFeeLamports: lamportsFromSol(priorityFee),
        slippagePercent: slippage,
        walletSecretKeysBase58: selectedWalletObjects.map(
          (w) => w.secretKey
        ),
      });
    } catch (e) {
      alert("BUY error: " + e.message);
    }
  };

  // -----------------------
  // NEW: BUY THE REST  (FIX APPLIED)
  // -----------------------
  const handleBuyTheRest = async () => {
    if (!mint.trim()) {
      alert("Set token mint");
      return;
    }
    if (!selectedWalletObjects.length) {
      alert("No wallets selected");
      return;
    }

    try {
      // FIX: backend requires { wallets: [...] }
      const balancesRes = await fetch("/api/wallets/balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallets: selectedWalletObjects.map((w) => w.publicKey),
        }),
      });

      const balances = await balancesRes.json();
      if (!balances || balances.error) throw new Error("Balance fetch error");

      const perWalletAmounts = selectedWalletObjects
        .map((w) => {
          const sol = balances.balances?.[w.publicKey] || 0;
          const rest = sol - Number(priorityFee || 0);
          if (rest <= 0) return null;

          return {
            secretKey: w.secretKey,
            solAmount: rest,
          };
        })
        .filter(Boolean);

      if (!perWalletAmounts.length) {
        alert("No wallet has enough SOL to buy");
        return;
      }

      await callBackend("/api/trade/buy-rest", {
        mintAddress: mint.trim(),
        slippagePercent: slippage,
        perWalletAmounts,
      });
    } catch (e) {
      alert("BUY THE REST error: " + e.message);
    }
  };

  // -----------------------
  // SELL SELECTED
  // -----------------------
  const handleSellSelected = async () => {
    if (!mint.trim()) {
      alert("Set token mint");
      return;
    }
    if (!selectedWalletObjects.length) {
      alert("No wallets selected");
      return;
    }

    try {
      await callBackend("/api/trade/sell-all", {
        mintAddress: mint.trim(),
        priorityFeeLamports: lamportsFromSol(priorityFee),
        slippagePercent: slippage,
        walletSecretKeysBase58: selectedWalletObjects.map(
          (w) => w.secretKey
        ),
      });
    } catch (e) {
      alert("SELL error: " + e.message);
    }
  };

  // -----------------------
  // SELL ALL WALLETS
  // -----------------------
  const handleSellAllWallets = async () => {
    if (!mint.trim()) {
      alert("Set token mint");
      return;
    }
    if (!wallets.length) {
      alert("No wallets exist");
      return;
    }

    try {
      await callBackend("/api/trade/sell-all", {
        mintAddress: mint.trim(),
        priorityFeeLamports: lamportsFromSol(priorityFee),
        slippagePercent: slippage,
        walletSecretKeysBase58: wallets.map((w) => w.secretKey),
      });
    } catch (e) {
      alert("SELL ALL error: " + e.message);
    }
  };

  return (
    <div className="trade-panel">
      <h2>3. BUY / SELL (Pump.fun)</h2>

      <div className="buy-sell-tabs">
        <div
          className={
            "buy-sell-tab " + (mode === "buy" ? "active-buy" : "")
          }
          onClick={() => setMode("buy")}
        >
          BUY
        </div>
        <div
          className={
            "buy-sell-tab " + (mode === "sell" ? "active-sell" : "")
          }
          onClick={() => setMode("sell")}
        >
          SELL
        </div>
      </div>

      <p className="hint">
        Selected wallets: <b>{selectedWallets.length}</b> / {wallets.length}
      </p>

      <div className="row">
        <button
          type="button"
          className="ghost-btn"
          onClick={() =>
            setSelectedWallets(wallets.map((w) => w.publicKey))
          }
          disabled={!wallets.length}
        >
          Use ALL wallets
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => setSelectedWallets([])}
        >
          Clear selection
        </button>
      </div>

      <label>Token mint (Pump.fun)</label>
      <input
        type="text"
        value={mint}
        onChange={(e) => setMint(e.target.value)}
        placeholder="Paste token mint"
      />

      {mode === "buy" && (
        <>
          <label>SOL per wallet (base)</label>
          <input
            type="number"
            min="0"
            step="0.0001"
            value={amountSol}
            onChange={(e) => setAmountSol(e.target.value)}
          />

          <label>Buy % (allocation)</label>
          <div className="percent-row">
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                type="button"
                className={
                  "percent-btn " + (percentBuy === p ? "active" : "")
                }
                onClick={() => setPercentBuy(p)}
              >
                {p}%
              </button>
            ))}
            <input
              type="number"
              style={{ width: 70 }}
              value={percentBuy}
              onChange={(e) =>
                setPercentBuy(Math.max(1, Number(e.target.value) || 1))
              }
            />
          </div>

          <p className="hint">
            Final amount: <b>{finalSolPerWallet.toFixed(6)} SOL</b>
          </p>
        </>
      )}

      <label>Priority fee (SOL → lamports)</label>
      <input
        type="number"
        min="0"
        step="0.00001"
        value={priorityFee}
        onChange={(e) => setPriorityFee(e.target.value)}
      />

      {/* NEW — slippage */}
      <label style={{ marginTop: 8 }}>Slippage (%)</label>
      <input
        type="number"
        min="0"
        step="0.1"
        value={slippage}
        onChange={(e) => setSlippage(Number(e.target.value))}
        placeholder="10"
      />

      {/* BUY BUTTON */}
      {mode === "buy" ? (
        <>
          <button
            className="main-action-btn"
            onClick={handleBuy}
            disabled={!selectedWalletObjects.length || !mint}
          >
            BUY with selected wallets
          </button>

          {/* NEW: BUY THE REST */}
          <button
            className="main-action-btn"
            onClick={handleBuyTheRest}
            disabled={!selectedWalletObjects.length || !mint}
            style={{
              marginTop: 8,
              background: "linear-gradient(135deg,#34d399,#10b981)",
            }}
          >
            BUY THE REST
          </button>
        </>
      ) : (
        <button
          className="main-action-btn"
          onClick={handleSellSelected}
          disabled={!selectedWalletObjects.length || !mint}
        >
          SELL ALL (selected)
        </button>
      )}

      <button
        onClick={handleSellAllWallets}
        disabled={!wallets.length || !mint}
        style={{
          marginTop: 8,
          width: "100%",
          background: "linear-gradient(135deg,#f97373,#fb7185)",
        }}
      >
        🔥 SELL ALL (ALL WALLETS)
      </button>

      <h3 style={{ marginTop: 14, fontSize: 13 }}>Wallet groups by range</h3>

      <div className="row">
        <input
          type="text"
          placeholder="Group name"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>

      <div className="row">
        <span style={{ fontSize: 12 }}>Range:</span>
        <input
          type="number"
          min={1}
          max={wallets.length || 1}
          value={rangeFrom}
          onChange={(e) => setRangeFrom(e.target.value)}
          style={{ width: 70 }}
        />
        <span>–</span>
        <input
          type="number"
          min={1}
          max={wallets.length || 1}
          value={rangeTo}
          onChange={(e) => setRangeTo(e.target.value)}
          style={{ width: 70 }}
        />
        <button type="button" onClick={createGroupFromRange}>
          Save group
        </button>
      </div>

      {groups.map((g) => (
        <div
          key={g.id}
          className="group-item"
          style={{
            marginTop: 4,
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 6,
            justifyContent: "space-between",
          }}
        >
          <span>
            <b>{g.name}</b> ({g.from}–{g.to}, {g.wallets.length} wallets)
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => applyGroup(g)}
            >
              Apply
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => deleteGroup(g.id)}
            >
              ✕
            </button>
          </div>
        </div>
      ))}

      {log && <pre className="log-box">{log}</pre>}
    </div>
  );
}
