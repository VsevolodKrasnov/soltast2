import React, { useEffect, useState } from "react";

export default function ProfitPanel({ selectedWallets, mint }) {
  const [balanceBefore, setBalanceBefore] = useState(null);
  const [balanceAfter, setBalanceAfter] = useState(null);
  const [pnl, setPnl] = useState(null);

  const [estimateNow, setEstimateNow] = useState(null);

  // ----------------------------
  // 1. Считаем баланс до покупки
  // ----------------------------
  const fetchBalanceBefore = async () => {
    if (!selectedWallets.length) return;

    const res = await fetch("/api/wallets/balances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallets: selectedWallets.map((w) => w.publicKey)
      })
    });

    const data = await res.json();
    let total = 0;

    for (const pk in data.balances) {
      if (typeof data.balances[pk] === "number") {
        total += data.balances[pk];
      }
    }

    setBalanceBefore(total);
  };

  // ----------------------------
  // 2. Считаем баланс после SELL ALL
  // backend должен присылать результат
  // ----------------------------
  const fetchBalanceAfter = async () => {
    if (!selectedWallets.length) return;

    const res = await fetch("/api/wallets/balances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallets: selectedWallets.map((w) => w.publicKey)
      })
    });

    const data = await res.json();
    let total = 0;

    for (const pk in data.balances) {
      if (typeof data.balances[pk] === "number") {
        total += data.balances[pk];
      }
    }

    setBalanceAfter(total);

    if (balanceBefore !== null) {
      setPnl(total - balanceBefore);
    }
  };

  // ----------------------------
  // 3. "Если продам сейчас" (Jupiter quote)
  // ----------------------------
  const fetchEstimate = async () => {
    if (!mint || !selectedWallets.length) return;

    // берём средний TOKEN balance
    const res = await fetch("/api/estimate/now", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mint,
        walletSecretKeysBase58: selectedWallets.map((w) => w.secretKey)
      })
    });

    const data = await res.json();
    setEstimateNow(data.estimatedSol || null);
  };

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h2>Profit Panel</h2>

      <button onClick={fetchBalanceBefore}>📊 Save balance BEFORE buy</button>

      <button onClick={fetchBalanceAfter}>💰 Save balance AFTER sell-all</button>

      {balanceBefore !== null && (
        <p>Before buy: <b>{balanceBefore.toFixed(4)} SOL</b></p>
      )}
      {balanceAfter !== null && (
        <p>After sell-all: <b>{balanceAfter.toFixed(4)} SOL</b></p>
      )}
      {pnl !== null && (
        <p style={{ color: pnl >= 0 ? "#4ade80" : "#f87171" }}>
          PnL: <b>{pnl.toFixed(4)} SOL</b> ({((pnl / balanceBefore) * 100).toFixed(2)}%)
        </p>
      )}

      <hr />

      {/* ESTIMATE IF SELL NOW */}
      <button onClick={fetchEstimate}>⏳ Estimate “sell now”</button>

      {estimateNow !== null && (
        <p>
          If sell now: <b>{estimateNow.toFixed(4)} SOL</b>
        </p>
      )}
    </div>
  );
}
