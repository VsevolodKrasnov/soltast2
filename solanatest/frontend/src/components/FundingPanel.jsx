// src/components/FundingPanel.jsx
import React, { useEffect, useMemo, useState } from "react";

export default function FundingPanel({
  wallets,
  selectedWallets,
  setSelectedWallets,
  mint,
  setMint,
}) {
  const [mainPk, setMainPk] = useState("");
  const [mode, setMode] = useState("perWallet"); // 'perWallet' | 'equal'
  const [totalSol, setTotalSol] = useState(1);
  const [perWalletSol, setPerWalletSol] = useState(0.01);
  const [useFullBalance, setUseFullBalance] = useState(true);

  const [balances, setBalances] = useState({});
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [txInfo, setTxInfo] = useState(null);
  const [sending, setSending] = useState(false);

  // диапазон выбора по индексам
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  // 🔥 новые фильтры
  // all        — все кошельки
  // noSol      — баланc SOL == 0
  // solGt      — баланс SOL > solThreshold
  // hasToken   — кошельки, у которых wallet.hasToken === true (проставишь позже из backend)
  const [filter, setFilter] = useState("all");
  const [solThreshold, setSolThreshold] = useState(0.1);

  const allPks = useMemo(
    () => (wallets || []).map((w) => w.publicKey),
    [wallets]
  );

  // ============================
  // BALANCES
  // ============================
  const refreshBalances = async () => {
    if (!wallets || !wallets.length) return;
    try {
      setLoadingBalances(true);
      const res = await fetch("/api/wallets/balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallets: allPks }), // ВАЖНО: wallets
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
      alert("Balances error: " + e.message);
    } finally {
      setLoadingBalances(false);
    }
  };

  useEffect(() => {
    if (wallets && wallets.length) {
      refreshBalances();
    } else {
      setBalances({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets.length]);

  const totalSolOnWallets = useMemo(
    () =>
      Object.values(balances).reduce(
        (acc, v) => (typeof v === "number" ? acc + v : acc),
        0
      ),
    [balances]
  );

  // ============================
  // FILTERED VIEW
  // ============================
  const filteredWallets = useMemo(() => {
    if (!wallets || !wallets.length) return [];

    return wallets.filter((w) => {
      const bal = balances[w.publicKey];
      const numBal = typeof bal === "number" ? bal : 0;

      if (filter === "noSol") {
        return numBal === 0;
      }
      if (filter === "solGt") {
        return numBal > solThreshold;
      }
      if (filter === "hasToken") {
        // ждёт, что ты проставишь флаг hasToken при загрузке кошельков
        return !!w.hasToken;
      }
      return true; // "all"
    });
  }, [wallets, balances, filter, solThreshold]);

  // ============================
  // SELECTION HELPERS
  // ============================
  const handleSelectAll = () => {
    // выделяем только отфильтрованные кошельки
    setSelectedWallets(filteredWallets.map((w) => w.publicKey));
  };

  const handleClearSelection = () => {
    setSelectedWallets([]);
  };

  const handleSelectRange = () => {
    const from = Number(rangeFrom);
    const to = Number(rangeTo);
    if (!from || !to || from < 1 || to < from || to > wallets.length) {
      alert(`Range must be from 1 to ${wallets.length}`);
      return;
    }
    const rangeWallets = wallets.slice(from - 1, to).map((w) => w.publicKey);
    setSelectedWallets(rangeWallets);
  };

  const toggleWallet = (pk) => {
    if (selectedWallets.includes(pk)) {
      setSelectedWallets(selectedWallets.filter((x) => x !== pk));
    } else {
      setSelectedWallets([...selectedWallets, pk]);
    }
  };

  // ============================
  // FUND / CLAIM
  // ============================
  const handleFund = async () => {
    try {
      setSending(true);
      const body = {
        mainPrivateKeyBase58: mainPk.trim(),
        targets: selectedWallets,
        mode,
        useFullBalance,
      };
      if (!useFullBalance) {
        if (mode === "equal") body.totalSol = Number(totalSol);
        else body.perWalletSol = Number(perWalletSol);
      }

      const res = await fetch("/api/wallets/fund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error("Invalid JSON from /api/wallets/fund");
      }

      if (data.error) throw new Error(data.error);
      const count = data.signatures?.length || 0;
      setTxInfo({ type: "fund", count });
      await refreshBalances();
    } catch (e) {
      alert("Fund error: " + e.message);
    } finally {
      setSending(false);
    }
  };

  const handleClaimAll = async () => {
    try {
      setSending(true);
      const secretKeys = (wallets || []).map((w) => w.secretKey);
      const res = await fetch("/api/wallets/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mainPrivateKeyBase58: mainPk.trim(),
          wallets: secretKeys,
        }),
      });

      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error("Invalid JSON from /api/wallets/collect");
      }

      if (data.error) throw new Error(data.error);
      const count = data.signatures?.length || 0;
      setTxInfo({ type: "claim", count });
      await refreshBalances();
    } catch (e) {
      alert("Claim error: " + e.message);
    } finally {
      setSending(false);
    }
  };

  // ============================
  // RENDER
  // ============================
  return (
    <div className="pumpfun-funding-panel">
      <h2>2. SOL distribution</h2>

      <label style={{ fontSize: 12, opacity: 0.8 }}>
        Pump.fun mint / token address
      </label>
      <input
        type="text"
        value={mint}
        onChange={(e) => setMint(e.target.value)}
        placeholder="Paste token mint (center column = token context)"
      />

      <label style={{ fontSize: 12, opacity: 0.8, marginTop: 8 }}>
        Main wallet private key (base58)
      </label>
      <input
        type="text"
        value={mainPk}
        onChange={(e) => setMainPk(e.target.value)}
        placeholder="Private key of main wallet"
      />

      <div className="row" style={{ marginTop: 6 }}>
        <label style={{ fontSize: 12 }}>
          <input
            type="radio"
            value="perWallet"
            checked={mode === "perWallet"}
            onChange={() => setMode("perWallet")}
          />{" "}
          Per wallet
        </label>
        <label style={{ fontSize: 12 }}>
          <input
            type="radio"
            value="equal"
            checked={mode === "equal"}
            onChange={() => setMode("equal")}
          />{" "}
          Split equally
        </label>
        <label style={{ fontSize: 12 }}>
          <input
            type="checkbox"
            checked={useFullBalance}
            onChange={(e) => setUseFullBalance(e.target.checked)}
          />{" "}
          Use full main wallet balance (leave ~0.002 SOL)
        </label>
      </div>

      {!useFullBalance && mode === "perWallet" && (
        <div className="row">
          <span style={{ fontSize: 12 }}>SOL per wallet</span>
          <input
            type="number"
            min="0"
            step="0.001"
            value={perWalletSol}
            onChange={(e) => setPerWalletSol(e.target.value)}
          />
        </div>
      )}

      {!useFullBalance && mode === "equal" && (
        <div className="row">
          <span style={{ fontSize: 12 }}>Total SOL to distribute</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={totalSol}
            onChange={(e) => setTotalSol(e.target.value)}
          />
        </div>
      )}

      <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 6 }}>
        <button
          onClick={handleFund}
          disabled={!mainPk || !selectedWallets.length || sending}
        >
          Distribute SOL
        </button>
        <button
          onClick={handleClaimAll}
          disabled={!mainPk || !wallets.length || sending}
        >
          Claim all to main
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={refreshBalances}
          disabled={!wallets.length || loadingBalances}
        >
          {loadingBalances ? "Refreshing..." : "Refresh balances"}
        </button>
      </div>

      {txInfo && (
        <p className="hint">
          Last action: <b>{txInfo.type}</b> — tx count: {txInfo.count}
        </p>
      )}

      <p className="hint" style={{ marginTop: 4 }}>
        Total on wallets: <b>{totalSolOnWallets.toFixed(4)} SOL</b>
      </p>

      {/* ====== Блок управления выбором + фильтры ====== */}
      <div
        className="row"
        style={{
          marginTop: 8,
          alignItems: "flex-end",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={handleSelectAll}>
            Select all (filtered)
          </button>
          <button type="button" onClick={handleClearSelection}>
            Clear
          </button>
        </div>

        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            fontSize: 12,
          }}
        >
          <span>Range:</span>
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
          <button type="button" onClick={handleSelectRange}>
            Apply range
          </button>
        </div>
      </div>

      {/* Фильтры по балансу / токенам */}
      <div
        className="row"
        style={{
          marginTop: 6,
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          fontSize: 12,
        }}
      >
        <span>Filter wallets:</span>
        <button
          type="button"
          className={filter === "all" ? "ghost-btn active" : "ghost-btn"}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        <button
          type="button"
          className={filter === "noSol" ? "ghost-btn active" : "ghost-btn"}
          onClick={() => setFilter("noSol")}
        >
          No SOL
        </button>
        <button
          type="button"
          className={filter === "solGt" ? "ghost-btn active" : "ghost-btn"}
          onClick={() => setFilter("solGt")}
        >
          &gt; {solThreshold} SOL
        </button>
        <input
          type="number"
          step="0.01"
          min="0"
          value={solThreshold}
          onChange={(e) => setSolThreshold(Number(e.target.value || 0))}
          style={{ width: 70 }}
        />
        <button
          type="button"
          className={filter === "hasToken" ? "ghost-btn active" : "ghost-btn"}
          onClick={() => setFilter("hasToken")}
        >
          Has token
        </button>
        <span style={{ opacity: 0.7 }}>
          (requires <code>wallet.hasToken</code> from backend)
        </span>
      </div>

      <div className="hint" style={{ marginTop: 4 }}>
        Scrollable list below — shows{" "}
        <b>{filteredWallets.length}</b> wallets after filters.
      </div>

      <div
        className="wallet-table"
        style={{
          maxHeight: 420,
          overflowY: "auto",
          marginTop: 6,
        }}
      >
        <div className="wallet-row header">
          <span>#</span>
          <span>Wallet / balance</span>
          <span>Select</span>
        </div>
        {filteredWallets.map((w, idx) => {
          const bal = balances[w.publicKey];
          const isSelected = selectedWallets.includes(w.publicKey);
          const globalIndex =
            (wallets || []).findIndex(
              (orig) => orig.publicKey === w.publicKey
            ) + 1;

          return (
            <div key={w.publicKey + idx} className="wallet-row">
              <span>{globalIndex || idx + 1}</span>
              <span className="mono">
                {w.publicKey}{" "}
                {typeof bal === "number" && (
                  <span style={{ opacity: 0.8 }}>
                    — {bal.toFixed(4)} SOL
                  </span>
                )}
              </span>
              <span>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleWallet(w.publicKey)}
                />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
