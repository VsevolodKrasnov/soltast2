import React, { useState } from "react";

export default function WalletCreator({
  wallets,
  setWallets,
  setSelectedWallets,
  activeTab,
}) {
  const [count, setCount] = useState(32);
  const [csvUrl, setCsvUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // 🔹 Генерация кошельков через backend
  const handleCreate = async () => {
    try {
      setIsLoading(true);
      const res = await fetch("/api/wallets/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: Number(count) }),
      });
      if (!res.ok) throw new Error("Backend not responding");
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Ожидаем формат: { wallets: [{publicKey, secretKey}], csv: "index,publicKey,secretKeyBase58\n..." }
      setWallets(data.wallets || []);
      if (setSelectedWallets) {
        setSelectedWallets((data.wallets || []).map((w) => w.publicKey));
      }

      if (data.csv) {
        const blob = new Blob([data.csv], {
          type: "text/csv;charset=utf-8;",
        });
        const url = URL.createObjectURL(blob);
        setCsvUrl(url);
      }
    } catch (e) {
      alert("Error creating wallets: " + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  // 🔹 Импорт своих кошельков из CSV
  // Формат ожидаем такой же: index,publicKey,secretKeyBase58
  const handleImportCsv = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) throw new Error("CSV has no data");

      const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
      const idxPK = header.indexOf("publickey");
      const idxSK = header.indexOf("secretkeybase58");

      if (idxPK === -1 || idxSK === -1) {
        throw new Error(
          "CSV must have headers: publicKey, secretKeyBase58 (case-insensitive)"
        );
      }

      const imported = lines.slice(1).map((line, i) => {
        const cols = line.split(",");
        return {
          publicKey: cols[idxPK]?.trim(),
          secretKey: cols[idxSK]?.trim(),
          _source: "imported",
          _index: i + 1,
        };
      });

      const valid = imported.filter(
        (w) => w.publicKey && w.secretKey && w.publicKey.length > 10
      );

      if (!valid.length) throw new Error("No valid wallets in CSV");

      // Заменяем текущий список на импортированный
      setWallets(valid);
      if (setSelectedWallets) {
        setSelectedWallets(valid.map((w) => w.publicKey));
      }
      alert(`Imported ${valid.length} wallets from CSV`);
    } catch (e) {
      alert("Import error: " + e.message);
    } finally {
      // чтобы можно было заново выбрать тот же файл
      event.target.value = "";
    }
  };

  return (
    <div className="pumpfun-wallet-creator">
      <h2>1. Wallets</h2>

      <div className="row" style={{ marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 12, opacity: 0.8 }}>
            Generate new wallets
          </label>
          <div className="row">
            <input
              type="number"
              min={1}
              max={500}
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
            <button onClick={handleCreate} disabled={isLoading}>
              {isLoading ? "Generating..." : "Generate"}
            </button>
          </div>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 12, opacity: 0.8 }}>
            Import wallets from CSV
          </label>
          <div className="row">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleImportCsv}
              style={{ fontSize: 12 }}
            />
          </div>
        </div>
      </div>

      {csvUrl && (
        <div className="row" style={{ marginBottom: 6 }}>
          <a href={csvUrl} download="wallets.csv" className="ghost-btn">
            Download CSV (pub + priv)
          </a>
        </div>
      )}

      <div className="hint" style={{ marginBottom: 6 }}>
        All wallets (scrollable). Left column = index, second = public key.
      </div>

      <div
        className="wallet-table"
        style={{
          maxHeight: 420,
          overflowY: "auto",
        }}
      >
        <div className="wallet-row header">
          <span>#</span>
          <span>Wallet (public)</span>
          <span></span>
        </div>
        {wallets.map((w, idx) => (
          <div key={w.publicKey + idx} className="wallet-row">
            <span>{idx + 1}</span>
            <span className="mono">{w.publicKey}</span>
            <span></span>
          </div>
        ))}
      </div>
    </div>
  );
}
