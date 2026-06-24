"""CLI tester for the MilkSense ONNX condition monitors.

Calls are made over a WINDOW of consecutive 5-min collar reports (majority vote), not
row-by-row — one noisy report shouldn't flip the verdict. This checks that the windowed
vote (a) denoises per-row predictions on sustained states and (b) reads a known state right.

Usage:
  uv run python test.py                # test both models
  uv run python test.py health         # just one model (health | behavior)
  uv run python test.py --window 6     # reports per decision (default 6 = 30 min)
"""
import argparse
import os
import sys
from collections import Counter

import numpy as np
import pandas as pd
import onnxruntime as rt
import main   # reuse feature lists + paths

TASKS = {  # name -> (features, label column, dataset, a label with sustained runs to spot-check)
    "behavior": (main.BEHAVIOR_FEATURES, "behavior", "Cow_Behavior_Dataset.csv", "grazing"),
    "health":   (main.HEALTH_FEATURES, "health_status", "Cow_Health_Dataset.csv", "fever"),
}


def load(csv):
    df = pd.read_csv(os.path.join(main.DATA, csv))
    ts = pd.to_datetime(df["timestamp"])
    df["hour"] = ts.dt.hour + ts.dt.minute / 60
    return df.sort_values(["cow_id", "timestamp"]).reset_index(drop=True)


def predict(name, feats, df):
    sess = rt.InferenceSession(os.path.join(main.HERE, f"cow_{name}_model.onnx"),
                               providers=["CPUExecutionProvider"])
    lab, prob = sess.run(None, {sess.get_inputs()[0].name: df[feats].to_numpy(np.float32)})[:2]
    return lab, prob.max(axis=1)


def vote(labs, confs):
    cnt = Counter(labs)
    tied = [l for l, c in cnt.items() if c == max(cnt.values())]
    return tied[0] if len(tied) == 1 else max(tied, key=lambda l: sum(c for lb, c in zip(labs, confs) if lb == l))


def test_task(name, W):
    feats, col, csv, spot = TASKS[name]
    df = load(csv)
    labs, confs = predict(name, feats, df)
    df = df.assign(_p=labs, _c=confs)
    checks = []

    # (a) denoise: on windows where the cow holds one state, window vote vs per-row
    pr_hit = pr_n = wn_hit = wn_n = 0
    sustained = []
    for _cow, g in df.groupby("cow_id"):
        t, p, c = g[col].to_numpy(), g["_p"].to_numpy(), g["_c"].to_numpy()
        for i in range(0, len(g) - W + 1, W):
            if len(set(t[i:i + W])) != 1:
                continue
            pr_hit += int((p[i:i + W] == t[i]).sum()); pr_n += W
            wn_hit += int(vote(p[i:i + W], c[i:i + W]) == t[i]); wn_n += 1
            if t[i] == spot:
                sustained.append((p[i:i + W], c[i:i + W]))
    per_row, windowed = pr_hit / pr_n, wn_hit / wn_n
    checks.append((f"denoise   per-row {per_row:.3f}  window {windowed:.3f}", windowed >= per_row))

    # (b) spot-check: a sustained '<spot>' window must vote '<spot>'
    pred = vote(*sustained[0]) if sustained else "<none found>"
    checks.append((f"sustained {spot} -> {pred}", pred == spot))
    return checks


def main_cli():
    ap = argparse.ArgumentParser(description="Test the MilkSense ONNX condition monitors.")
    ap.add_argument("task", nargs="?", default="all", choices=["all", "behavior", "health"])
    ap.add_argument("--window", type=int, default=6, help="reports per decision (default 6 = 30 min)")
    args = ap.parse_args()

    for f in ("Cow_Health_Dataset.csv",):
        if not os.path.exists(os.path.join(main.DATA, f)):
            sys.exit("datasets missing — run `uv run python make_datasets.py` first")
    for name in TASKS:
        if not os.path.exists(os.path.join(main.HERE, f"cow_{name}_model.onnx")):
            sys.exit("models missing — run `uv run python main.py` first")

    names = list(TASKS) if args.task == "all" else [args.task]
    passed = failed = 0
    for name in names:
        print(f"== {name} ==")
        for label, ok in test_task(name, args.window):
            print(f"  {label:<40} {'PASS' if ok else 'FAIL'}")
            passed += ok; failed += not ok
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main_cli()
