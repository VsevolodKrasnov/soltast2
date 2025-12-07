import React, { useState } from 'react';

export default function TotalCalculator({ wallets, selectedWallets }) {
  const [total, setTotal] = useState(null);
  const [perWallet, setPerWallet] = useState({});

  const handleCalculate = async () => {
    try {
      const res = await fetch('/api/calculate-total-sol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallets: wallets
            .filter((w) => selectedWallets.includes(w.publicKey))
            .map((w) => w.publicKey),
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setTotal(data.totalSol);
      setPerWallet(data.perWallet || {});
    } catch (e) {
      alert('Calc error: ' + e.message);
    }
  };

  return (
    <div className="card">
      <h2>Calculate Sell‑All result</h2>
      <button onClick={handleCalculate} disabled={selectedWallets.length === 0}>
        Calculate total SOL
      </button>
      {total !== null && (
        <>
          <p className="big-number">{total.toFixed(4)} SOL</p>
          <div className="wallet-table small">
            <div className="wallet-row header">
              <span>Wallet</span>
              <span>SOL</span>
            </div>
            {Object.entries(perWallet).map(([pk, bal]) => (
              <div key={pk} className="wallet-row">
                <span className="mono">{pk}</span>
                <span>{bal === null ? 'err' : bal.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}