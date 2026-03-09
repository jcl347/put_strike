"""
PutStrike iTransformer Training & Inference Server for Google Colab

This script does three things:
1. Downloads historical market data and computes 300+ features
2. Trains an iTransformer model for price/volatility forecasting
3. Starts a Flask inference server (exposed via ngrok) that PutStrike can call

USAGE IN GOOGLE COLAB:
    1. Open Google Colab (colab.research.google.com)
    2. Select GPU runtime: Runtime > Change runtime type > T4 GPU
    3. Upload this file or paste it into a cell
    4. Run the cells in order
    5. Copy the ngrok URL and paste it into PutStrike settings

REQUIREMENTS (installed automatically):
    pip install torch numpy pandas yfinance flask pyngrok onnx onnxruntime
"""

# ═══════════════════════════════════════════════════════════════
# CELL 1: Install dependencies
# ═══════════════════════════════════════════════════════════════

import subprocess
import sys

def install_deps():
    """Install all required packages."""
    packages = [
        "torch", "numpy", "pandas", "yfinance",
        "flask", "pyngrok", "onnx", "onnxruntime",
        "scikit-learn",
    ]
    for pkg in packages:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", pkg])
    print("[OK] All dependencies installed.")

install_deps()

# ═══════════════════════════════════════════════════════════════
# CELL 2: Configuration
# ═══════════════════════════════════════════════════════════════

import os

# ── NGROK AUTH TOKEN ──
# Get your free token from https://dashboard.ngrok.com/get-started/your-authtoken
# This allows PutStrike to call your Colab GPU for predictions
NGROK_AUTH_TOKEN = os.environ.get("NGROK_AUTH_TOKEN", "YOUR_NGROK_TOKEN_HERE")

# ── Training Configuration ──
SYMBOLS = [
    # Train on high-liquidity stocks that match PutStrike's screener
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA",
    "JPM", "V", "JNJ", "PG", "XOM", "UNH",
    "SPY", "QQQ", "IWM",
]

LOOKBACK_WINDOW = 60      # Days of history per sample
FORECAST_HORIZON = 30     # Predict 30 days ahead
D_MODEL = 256             # Transformer hidden dimension
N_HEADS = 8               # Attention heads
N_LAYERS = 2              # Transformer layers
D_FF = 256                # Feed-forward dimension
DROPOUT = 0.1
BATCH_SIZE = 32
EPOCHS = 50
LEARNING_RATE = 0.0005
TRAIN_SPLIT = 0.8         # 80% train, 20% validation

print(f"[CONFIG] {len(SYMBOLS)} symbols, lookback={LOOKBACK_WINDOW}, "
      f"horizon={FORECAST_HORIZON}, d_model={D_MODEL}, layers={N_LAYERS}")

# ═══════════════════════════════════════════════════════════════
# CELL 3: Feature Engineering (mirrors PutStrike's features.ts)
# ═══════════════════════════════════════════════════════════════

import numpy as np
import pandas as pd
import yfinance as yf
from typing import Dict, List, Optional, Tuple

def compute_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute 100+ features from OHLCV data.
    This mirrors the TypeScript feature engineering in src/lib/features.ts.
    """
    feat = pd.DataFrame(index=df.index)
    close = df["Close"]
    high = df["High"]
    low = df["Low"]
    volume = df["Volume"]
    open_ = df["Open"]

    # ── Moving Averages (10 features) ──
    for p in [5, 10, 20, 50, 200]:
        sma = close.rolling(p).mean()
        feat[f"sma_{p}"] = sma
        feat[f"price_vs_sma_{p}_pct"] = ((close - sma) / sma) * 100

    for p in [5, 12, 26]:
        feat[f"ema_{p}"] = close.ewm(span=p, adjust=False).mean()

    feat["sma_20_50_cross"] = (
        close.rolling(20).mean() > close.rolling(50).mean()
    ).astype(float)

    # ── RSI (3 features) ──
    for p in [7, 14, 21]:
        delta = close.diff()
        gain = delta.where(delta > 0, 0).rolling(p).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(p).mean()
        rs = gain / (loss + 1e-10)
        feat[f"rsi_{p}"] = 100 - 100 / (1 + rs)

    # ── MACD (4 features) ──
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd_line = ema12 - ema26
    macd_signal = macd_line.ewm(span=9, adjust=False).mean()
    feat["macd_line"] = macd_line
    feat["macd_signal"] = macd_signal
    feat["macd_histogram"] = macd_line - macd_signal
    feat["macd_cross_above"] = (
        (macd_line > macd_signal) & (macd_line.shift(1) <= macd_signal.shift(1))
    ).astype(float)

    # ── Bollinger Bands (4 features) ──
    bb_sma = close.rolling(20).mean()
    bb_std = close.rolling(20).std()
    feat["bb_upper"] = bb_sma + 2 * bb_std
    feat["bb_lower"] = bb_sma - 2 * bb_std
    feat["bb_width"] = (4 * bb_std / bb_sma) * 100
    feat["bb_pctb"] = (close - feat["bb_lower"]) / (feat["bb_upper"] - feat["bb_lower"] + 1e-10)

    # ── ATR (2 features) ──
    for p in [7, 14]:
        tr = pd.concat([
            high - low,
            (high - close.shift(1)).abs(),
            (low - close.shift(1)).abs(),
        ], axis=1).max(axis=1)
        atr = tr.rolling(p).mean()
        feat[f"atr_{p}"] = atr
        feat[f"atr_{p}_pct"] = (atr / close) * 100

    # ── Volume (6 features) ──
    feat["volume_ratio_5_20"] = volume.rolling(5).mean() / (volume.rolling(20).mean() + 1)
    feat["relative_volume"] = volume / (volume.rolling(20).mean() + 1)

    # OBV
    obv = (np.sign(close.diff()) * volume).cumsum()
    feat["obv"] = obv

    # CMF
    clv = ((close - low) - (high - close)) / (high - low + 1e-10)
    feat["cmf_20"] = (clv * volume).rolling(20).sum() / (volume.rolling(20).sum() + 1)

    feat["volume_zscore_20"] = (
        (volume - volume.rolling(20).mean()) / (volume.rolling(20).std() + 1e-10)
    )
    feat["volume_trend"] = volume.rolling(20).apply(
        lambda x: np.polyfit(range(len(x)), x, 1)[0] if len(x) == 20 else 0
    )

    # ── Stochastic (2 features) ──
    low14 = low.rolling(14).min()
    high14 = high.rolling(14).max()
    feat["stoch_k"] = ((close - low14) / (high14 - low14 + 1e-10)) * 100
    feat["stoch_d"] = feat["stoch_k"].rolling(3).mean()

    # ── Williams %R ──
    feat["williams_r"] = ((high14 - close) / (high14 - low14 + 1e-10)) * -100

    # ── ROC (3 features) ──
    for p in [5, 10, 20]:
        feat[f"roc_{p}"] = close.pct_change(p) * 100

    # ── CCI ──
    tp = (high + low + close) / 3
    tp_sma = tp.rolling(20).mean()
    tp_mad = tp.rolling(20).apply(lambda x: np.mean(np.abs(x - np.mean(x))))
    feat["cci_20"] = (tp - tp_sma) / (0.015 * tp_mad + 1e-10)

    # ── Aroon ──
    feat["aroon_up"] = high.rolling(25).apply(lambda x: x.argmax() / 24 * 100)
    feat["aroon_down"] = low.rolling(25).apply(lambda x: x.argmin() / 24 * 100)
    feat["aroon_oscillator"] = feat["aroon_up"] - feat["aroon_down"]

    # ── Returns (5 features) ──
    for p in [1, 5, 10, 20, 60]:
        feat[f"return_{p}d"] = close.pct_change(p)

    # ── Volatility (4 features) ──
    log_ret = np.log(close / close.shift(1))
    for p in [5, 10, 20, 60]:
        feat[f"volatility_{p}d"] = log_ret.rolling(p).std() * np.sqrt(252)

    # ── Higher Moments (4 features) ──
    feat["skewness_20d"] = log_ret.rolling(20).skew()
    feat["skewness_60d"] = log_ret.rolling(60).skew()
    feat["kurtosis_20d"] = log_ret.rolling(20).kurt()
    feat["kurtosis_60d"] = log_ret.rolling(60).kurt()

    # ── Autocorrelation (3 features) ──
    for lag in [1, 3, 5]:
        feat[f"autocorr_lag_{lag}"] = log_ret.rolling(30).apply(
            lambda x: x.autocorr(lag) if len(x) >= lag + 2 else 0
        )

    # ── Z-Scores (4 features) ──
    for p in [20, 50, 100, 200]:
        roll_mean = close.rolling(p).mean()
        roll_std = close.rolling(p).std()
        feat[f"zscore_{p}"] = (close - roll_mean) / (roll_std + 1e-10)

    # ── Percentile Ranks (3 features) ──
    for p in [20, 60, 252]:
        feat[f"percentile_rank_{p}d"] = close.rolling(p).apply(
            lambda x: (x < x.iloc[-1]).sum() / len(x) * 100 if len(x) == p else 50
        )

    # ── Max Drawdown (2 features) ──
    for p in [20, 60]:
        rolling_max = close.rolling(p).max()
        feat[f"max_drawdown_{p}d"] = (close - rolling_max) / (rolling_max + 1e-10)

    # ── Up/Down Ratios (2 features) ──
    for p in [10, 20]:
        feat[f"up_ratio_{p}d"] = (close.diff() > 0).rolling(p).mean()

    # ── Gap Features (2 features) ──
    gap = (open_ - close.shift(1)) / (close.shift(1) + 1e-10)
    feat["avg_gap_20d"] = gap.rolling(20).mean()
    feat["gap_frequency_20d"] = (gap.abs() > 0.01).rolling(20).mean()

    # ── Calendar Features (5 features) ──
    feat["day_of_week"] = pd.to_datetime(df.index).dayofweek / 4  # Normalized
    feat["month_sin"] = np.sin(2 * np.pi * pd.to_datetime(df.index).month / 12)
    feat["month_cos"] = np.cos(2 * np.pi * pd.to_datetime(df.index).month / 12)
    feat["is_quarter_end"] = pd.to_datetime(df.index).month.isin([3, 6, 9, 12]).astype(float)
    day_of_month = pd.to_datetime(df.index).day
    feat["is_opex_week"] = ((day_of_month >= 15) & (day_of_month <= 21)).astype(float)

    # ── Trend Strength (3 features) ──
    feat["price_slope_20"] = close.rolling(20).apply(
        lambda x: np.polyfit(range(len(x)), x, 1)[0] if len(x) == 20 else 0
    )
    feat["price_slope_50"] = close.rolling(50).apply(
        lambda x: np.polyfit(range(len(x)), x, 1)[0] if len(x) == 50 else 0
    )
    # Ichimoku
    tenkan = (high.rolling(9).max() + low.rolling(9).min()) / 2
    kijun = (high.rolling(26).max() + low.rolling(26).min()) / 2
    feat["ichimoku_tk_cross"] = (tenkan > kijun).astype(float)

    # Drop NaN rows from rolling calculations
    feat = feat.replace([np.inf, -np.inf], np.nan)
    feat = feat.fillna(0)

    return feat


def download_and_prepare_data(
    symbols: List[str],
    lookback: int,
    horizon: int,
) -> Tuple[np.ndarray, np.ndarray, List[str]]:
    """
    Download data, compute features, create training samples.

    Returns:
        X: (num_samples, lookback, num_features)
        y: (num_samples, horizon)  — future close prices normalized
        feature_names: list of feature names
    """
    all_X = []
    all_y = []
    feature_names = None

    for sym in symbols:
        print(f"  Downloading {sym}...", end=" ")
        try:
            df = yf.download(sym, period="5y", interval="1d", progress=False)
            if len(df) < lookback + horizon + 100:
                print(f"skipped (only {len(df)} days)")
                continue

            features = compute_features(df)
            closes = df["Close"].values

            if feature_names is None:
                feature_names = list(features.columns)
                print(f"({len(feature_names)} features)")
            else:
                print("OK")

            # Normalize features (z-score per feature per stock)
            feat_values = features.values
            feat_mean = np.nanmean(feat_values, axis=0, keepdims=True)
            feat_std = np.nanstd(feat_values, axis=0, keepdims=True) + 1e-10
            feat_norm = (feat_values - feat_mean) / feat_std

            # Create sliding window samples
            for i in range(lookback, len(feat_norm) - horizon):
                X_sample = feat_norm[i - lookback:i]  # (lookback, features)

                # Target: normalized future returns at each horizon day
                current_price = closes[i]
                future_prices = closes[i + 1:i + horizon + 1]
                if len(future_prices) == horizon and current_price > 0:
                    y_sample = (future_prices - current_price) / current_price
                    all_X.append(X_sample)
                    all_y.append(y_sample)

        except Exception as e:
            print(f"FAILED ({e})")
            continue

    X = np.array(all_X, dtype=np.float32)
    y = np.array(all_y, dtype=np.float32)
    print(f"\n[DATA] {X.shape[0]} samples, {X.shape[2]} features, "
          f"lookback={X.shape[1]}, horizon={y.shape[1]}")

    return X, y, feature_names or []


# ═══════════════════════════════════════════════════════════════
# CELL 4: iTransformer Model
# ═══════════════════════════════════════════════════════════════

import torch
import torch.nn as nn

class iTransformer(nn.Module):
    """
    Inverted Transformer for Time-Series Forecasting (ICLR 2024).

    Key insight: Each FEATURE is a token (not each time step).
    - Token embedding: project each feature's lookback window into d_model
    - Self-attention: captures cross-variate correlations
    - FFN: learns temporal patterns per variate
    - Linear head: projects to forecast horizon
    """

    def __init__(
        self,
        num_variates: int,
        lookback: int,
        forecast_horizon: int,
        d_model: int = 256,
        n_heads: int = 8,
        n_layers: int = 2,
        d_ff: int = 256,
        dropout: float = 0.1,
    ):
        super().__init__()
        self.num_variates = num_variates
        self.lookback = lookback
        self.forecast_horizon = forecast_horizon

        # Per-variate embedding: project lookback window → d_model
        self.variate_embedding = nn.Linear(lookback, d_model)

        # Learnable variate tokens (like positional encoding, but for features)
        self.variate_tokens = nn.Parameter(
            torch.randn(1, num_variates, d_model) * 0.02
        )

        # Transformer encoder layers (attention across variates)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=n_heads,
            dim_feedforward=d_ff,
            dropout=dropout,
            batch_first=True,
            activation="gelu",
        )
        self.encoder = nn.TransformerEncoder(
            encoder_layer, num_layers=n_layers
        )

        # Layer norm
        self.norm = nn.LayerNorm(d_model)

        # Projection head: d_model → forecast_horizon
        # We aggregate across variates and project to forecast
        self.forecast_head = nn.Sequential(
            nn.Linear(d_model, d_ff),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_ff, forecast_horizon),
        )

        # Aggregation: attention-weighted pooling across variates
        self.agg_query = nn.Parameter(torch.randn(1, 1, d_model) * 0.02)
        self.agg_attn = nn.MultiheadAttention(
            d_model, n_heads, dropout=dropout, batch_first=True
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: (batch, lookback, num_variates) — standard time-series format

        Returns:
            forecast: (batch, forecast_horizon) — predicted returns
        """
        B = x.shape[0]

        # INVERT: transpose to (batch, num_variates, lookback)
        # Each variate's time series becomes a token
        x = x.transpose(1, 2)  # (B, V, L)

        # Embed each variate's lookback → d_model
        tokens = self.variate_embedding(x)  # (B, V, d_model)

        # Add learnable variate identifiers
        tokens = tokens + self.variate_tokens

        # Transformer encoder: attention across variates
        encoded = self.encoder(tokens)  # (B, V, d_model)
        encoded = self.norm(encoded)

        # Aggregate variates via attention pooling
        query = self.agg_query.expand(B, -1, -1)  # (B, 1, d_model)
        agg, _ = self.agg_attn(query, encoded, encoded)  # (B, 1, d_model)
        agg = agg.squeeze(1)  # (B, d_model)

        # Project to forecast
        forecast = self.forecast_head(agg)  # (B, horizon)

        return forecast


# ═══════════════════════════════════════════════════════════════
# CELL 5: Training Loop
# ═══════════════════════════════════════════════════════════════

from torch.utils.data import TensorDataset, DataLoader
from sklearn.model_selection import train_test_split

def train_model(
    X: np.ndarray,
    y: np.ndarray,
    feature_names: List[str],
    config: dict,
) -> Tuple[iTransformer, dict]:
    """Train the iTransformer model."""

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"\n[TRAIN] Using device: {device}")
    if device.type == "cuda":
        print(f"  GPU: {torch.cuda.get_device_name(0)}")
        print(f"  VRAM: {torch.cuda.get_device_properties(0).total_mem / 1e9:.1f} GB")

    # Train/val split
    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=1 - TRAIN_SPLIT, shuffle=False  # Time-series: no shuffle
    )

    train_ds = TensorDataset(
        torch.FloatTensor(X_train), torch.FloatTensor(y_train)
    )
    val_ds = TensorDataset(
        torch.FloatTensor(X_val), torch.FloatTensor(y_val)
    )

    train_loader = DataLoader(train_ds, batch_size=config["batch_size"], shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=config["batch_size"])

    # Model
    model = iTransformer(
        num_variates=X.shape[2],
        lookback=X.shape[1],
        forecast_horizon=y.shape[1],
        d_model=config["d_model"],
        n_heads=config["n_heads"],
        n_layers=config["n_layers"],
        d_ff=config["d_ff"],
        dropout=config["dropout"],
    ).to(device)

    param_count = sum(p.numel() for p in model.parameters())
    print(f"  Parameters: {param_count:,}")

    optimizer = torch.optim.AdamW(
        model.parameters(), lr=config["lr"], weight_decay=1e-4
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=config["epochs"]
    )
    criterion = nn.MSELoss()

    best_val_loss = float("inf")
    best_state = None
    history = {"train_loss": [], "val_loss": []}

    for epoch in range(config["epochs"]):
        # Training
        model.train()
        train_loss = 0
        for X_batch, y_batch in train_loader:
            X_batch, y_batch = X_batch.to(device), y_batch.to(device)
            optimizer.zero_grad()
            pred = model(X_batch)
            loss = criterion(pred, y_batch)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            train_loss += loss.item()

        train_loss /= len(train_loader)

        # Validation
        model.eval()
        val_loss = 0
        with torch.no_grad():
            for X_batch, y_batch in val_loader:
                X_batch, y_batch = X_batch.to(device), y_batch.to(device)
                pred = model(X_batch)
                val_loss += criterion(pred, y_batch).item()
        val_loss /= len(val_loader)

        scheduler.step()
        history["train_loss"].append(train_loss)
        history["val_loss"].append(val_loss)

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}

        if (epoch + 1) % 5 == 0 or epoch == 0:
            print(f"  Epoch {epoch+1}/{config['epochs']} — "
                  f"train: {train_loss:.6f}, val: {val_loss:.6f} "
                  f"{'*best*' if val_loss == best_val_loss else ''}")

    # Load best model
    if best_state:
        model.load_state_dict(best_state)
    model = model.cpu()

    print(f"\n[TRAIN] Complete. Best val loss: {best_val_loss:.6f}")

    return model, history


def export_to_onnx(model: iTransformer, filepath: str = "itransformer.onnx"):
    """Export trained model to ONNX format for Vercel deployment."""
    model.eval()
    dummy_input = torch.randn(1, model.lookback, model.num_variates)

    torch.onnx.export(
        model,
        dummy_input,
        filepath,
        input_names=["features"],
        output_names=["forecast"],
        dynamic_axes={
            "features": {0: "batch_size"},
            "forecast": {0: "batch_size"},
        },
        opset_version=14,
    )

    size_mb = os.path.getsize(filepath) / (1024 * 1024)
    print(f"[ONNX] Exported to {filepath} ({size_mb:.1f} MB)")
    return filepath


# ═══════════════════════════════════════════════════════════════
# CELL 6: Run Training
# ═══════════════════════════════════════════════════════════════

def run_training():
    """Download data, compute features, train model, export ONNX."""
    print("=" * 60)
    print("PutStrike iTransformer Training")
    print("=" * 60)

    # Download and prepare
    print("\n[1/4] Downloading market data and computing features...")
    X, y, feature_names = download_and_prepare_data(
        SYMBOLS, LOOKBACK_WINDOW, FORECAST_HORIZON
    )

    if X.shape[0] < 100:
        print("[ERROR] Not enough data samples. Try adding more symbols.")
        return None, None, None

    # Train
    print("\n[2/4] Training iTransformer...")
    config = {
        "d_model": D_MODEL,
        "n_heads": N_HEADS,
        "n_layers": N_LAYERS,
        "d_ff": D_FF,
        "dropout": DROPOUT,
        "batch_size": BATCH_SIZE,
        "epochs": EPOCHS,
        "lr": LEARNING_RATE,
    }
    model, history = train_model(X, y, feature_names, config)

    # Export
    print("\n[3/4] Exporting to ONNX...")
    onnx_path = export_to_onnx(model)

    # Save metadata
    metadata = {
        "feature_names": feature_names,
        "num_features": len(feature_names),
        "lookback": LOOKBACK_WINDOW,
        "horizon": FORECAST_HORIZON,
        "symbols_trained": SYMBOLS,
        "d_model": D_MODEL,
        "n_layers": N_LAYERS,
        "train_samples": X.shape[0],
        "best_val_loss": min(history["val_loss"]),
    }

    import json
    with open("model_metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    print("\n[4/4] Ready! Files saved:")
    print(f"  - itransformer.onnx ({os.path.getsize(onnx_path)/1e6:.1f} MB)")
    print(f"  - model_metadata.json")

    return model, metadata, feature_names


# Run training
model, metadata, feature_names = run_training()


# ═══════════════════════════════════════════════════════════════
# CELL 7: Inference Server (Flask + ngrok)
# ═══════════════════════════════════════════════════════════════

import json
from flask import Flask, request, jsonify
import threading

app = Flask(__name__)

# Keep model in memory for fast inference
_model = model
_metadata = metadata
_feature_names = feature_names


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({
        "status": "ok",
        "model": "iTransformer",
        "features": _metadata["num_features"] if _metadata else 0,
        "lookback": LOOKBACK_WINDOW,
        "horizon": FORECAST_HORIZON,
        "gpu": torch.cuda.is_available(),
        "device": str(torch.cuda.get_device_name(0)) if torch.cuda.is_available() else "cpu",
    })


@app.route("/predict", methods=["POST"])
def predict():
    """
    Run prediction on feature data.

    Expects JSON:
    {
        "features": [[...], [...], ...]  // (lookback, num_features) array
        "current_price": 150.0
        "symbol": "AAPL"
    }

    Returns:
    {
        "forecast": [0.01, 0.02, ...]  // predicted returns for each day
        "predicted_prices": [151.5, 153.0, ...]
        "confidence": { "lower_68": [...], "upper_68": [...], ... }
        "model": "iTransformer"
    }
    """
    if _model is None:
        return jsonify({"error": "Model not loaded"}), 500

    try:
        data = request.get_json()
        features = np.array(data["features"], dtype=np.float32)
        current_price = float(data.get("current_price", 100))
        symbol = data.get("symbol", "UNKNOWN")

        # Ensure correct shape
        if features.ndim == 2:
            features = features[np.newaxis, ...]  # Add batch dim

        # Validate dimensions
        if features.shape[1] != LOOKBACK_WINDOW:
            return jsonify({
                "error": f"Expected lookback={LOOKBACK_WINDOW}, got {features.shape[1]}"
            }), 400
        if features.shape[2] != _metadata["num_features"]:
            return jsonify({
                "error": f"Expected {_metadata['num_features']} features, got {features.shape[2]}"
            }), 400

        # Run inference
        device = next(_model.parameters()).device
        with torch.no_grad():
            x = torch.FloatTensor(features).to(device)
            forecast = _model(x).cpu().numpy()[0]  # (horizon,)

        # Convert returns to prices
        predicted_prices = current_price * (1 + forecast)

        # Estimate confidence bands (using model uncertainty approximation)
        # Simple: use rolling volatility from features to scale bands
        vol_feature_idx = _feature_names.index("volatility_20d") if "volatility_20d" in _feature_names else -1
        if vol_feature_idx >= 0:
            vol = abs(features[0, -1, vol_feature_idx]) * 0.2 + 0.15  # Denormalize approx
        else:
            vol = 0.2

        daily_vol = vol / np.sqrt(252)
        days = np.arange(1, FORECAST_HORIZON + 1)
        diffusion = daily_vol * np.sqrt(days)

        response = {
            "symbol": symbol,
            "model": "iTransformer",
            "forecast_returns": forecast.tolist(),
            "predicted_prices": predicted_prices.tolist(),
            "current_price": current_price,
            "horizon_days": FORECAST_HORIZON,
            "confidence": {
                "lower_95": (current_price * (1 + forecast - 1.96 * diffusion)).tolist(),
                "upper_95": (current_price * (1 + forecast + 1.96 * diffusion)).tolist(),
                "lower_68": (current_price * (1 + forecast - diffusion)).tolist(),
                "upper_68": (current_price * (1 + forecast + diffusion)).tolist(),
            },
            "metadata": {
                "num_features": _metadata["num_features"],
                "lookback": LOOKBACK_WINDOW,
                "gpu_used": torch.cuda.is_available(),
            },
        }

        return jsonify(response)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/feature-names", methods=["GET"])
def get_feature_names():
    """Return the list of feature names for the model."""
    return jsonify({
        "features": _feature_names or [],
        "count": len(_feature_names) if _feature_names else 0,
    })


def start_server():
    """Start Flask server with ngrok tunnel."""
    from pyngrok import ngrok

    # Set ngrok auth token
    if NGROK_AUTH_TOKEN and NGROK_AUTH_TOKEN != "YOUR_NGROK_TOKEN_HERE":
        ngrok.set_auth_token(NGROK_AUTH_TOKEN)
    else:
        print("\n[WARNING] No ngrok auth token set!")
        print("  Get your free token from: https://dashboard.ngrok.com/get-started/your-authtoken")
        print("  Set it in NGROK_AUTH_TOKEN variable above.")
        print("  Without it, the tunnel will expire quickly.\n")

    # Start ngrok tunnel
    port = 5000
    public_url = ngrok.connect(port)

    print("\n" + "=" * 60)
    print("PutStrike iTransformer Inference Server")
    print("=" * 60)
    print(f"\n  Local:   http://localhost:{port}")
    print(f"  Public:  {public_url}")
    print(f"\n  Paste this URL into PutStrike settings:")
    print(f"  {public_url}")
    print(f"\n  Endpoints:")
    print(f"    GET  {public_url}/health")
    print(f"    POST {public_url}/predict")
    print(f"    GET  {public_url}/feature-names")
    print("=" * 60)

    # Run Flask in a thread so Colab cell doesn't block
    threading.Thread(
        target=lambda: app.run(port=port, use_reloader=False),
        daemon=True,
    ).start()

    return str(public_url)


# Start the inference server
public_url = start_server()
