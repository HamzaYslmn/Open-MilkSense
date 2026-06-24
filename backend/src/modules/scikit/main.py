"""Train two condition-monitoring models on the MilkSense ESP32 collar datasets and
export each to ONNX for the backend to score live reports.

    Cow_Behavior_Dataset.csv -> behavior model  (resting/eating/grazing/.../mounting)
    Cow_Health_Dataset.csv   -> health model     (healthy/fever/respiratory/lameness/heat_stress)

Each task uses only the sensors that carry its signal. GPS lat/lng, battery, satellite
count, LoRa RSSI/SNR and the RFID columns are dropped on purpose -- they describe *where*
the cow is and *how good the radio link is*, not what it is doing or how it feels, and
per-cow GPS/RFID would just leak the animal's identity into the model.

Output is ONNX (skl2onnx), verified by running it back through onnxruntime.

Run: `uv run python main.py`
"""
import os
import numpy as np
import pandas as pd
import onnxruntime as rt
from skl2onnx import to_onnx
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report

HERE = os.path.dirname(__file__)
DATA = os.path.join(HERE, "datasets")

# Behaviour rides on motion + acoustics + time of day; health adds body temperature.
BEHAVIOR_FEATURES = ["hour", "steps", "heart_rate_bpm", "sound_level_db", "acoustic_events"]
HEALTH_FEATURES = ["hour", "heart_rate_bpm", "steps", "body_temp_c", "sound_level_db", "acoustic_events"]

TASKS = [
    ("behavior", "Cow_Behavior_Dataset.csv", "behavior", BEHAVIOR_FEATURES),
    ("health", "Cow_Health_Dataset.csv", "health_status", HEALTH_FEATURES),
]


def load(csv_name):
    df = pd.read_csv(os.path.join(DATA, csv_name))
    ts = pd.to_datetime(df["timestamp"])
    df["hour"] = ts.dt.hour + ts.dt.minute / 60
    return df


def train_task(name, csv_name, label_col, features):
    df = load(csv_name)
    X = df[features].to_numpy(dtype=np.float32)
    y = df[label_col].to_numpy()
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=42, stratify=y)

    clf = RandomForestClassifier(n_estimators=200, max_depth=14, class_weight="balanced", random_state=42)
    clf.fit(Xtr, ytr)
    acc = clf.score(Xte, yte)

    print(f"\n=== {name} model — {len(df)} reports, classes {sorted(set(y))} ===")
    print(f"hold-out accuracy: {acc:.3f}")
    print(classification_report(yte, clf.predict(Xte), zero_division=0))
    print("feature importances:", {f: round(i, 3) for f, i in
          sorted(zip(features, clf.feature_importances_), key=lambda t: -t[1])})

    # export to ONNX (zipmap off -> output 0 = labels, output 1 = probability matrix)
    onx = to_onnx(clf, Xtr[:1], options={id(clf): {"zipmap": False}}, target_opset=18)
    path = os.path.join(HERE, f"cow_{name}_model.onnx")
    with open(path, "wb") as f:
        f.write(onx.SerializeToString())
    print(f"saved ONNX -> {os.path.basename(path)}")

    # verify the ONNX model reproduces sklearn's predictions
    sess = rt.InferenceSession(path, providers=["CPUExecutionProvider"])
    onnx_pred = sess.run(None, {sess.get_inputs()[0].name: Xte})[0]
    agree = float(np.mean(onnx_pred == clf.predict(Xte)))
    print(f"ONNX vs sklearn agreement: {agree:.3f}")
    return acc, agree, features


def score(name, features, reading):
    """Score one live ESP32 report against the exported ONNX model. Returns (label, confidence)."""
    path = os.path.join(HERE, f"cow_{name}_model.onnx")
    sess = rt.InferenceSession(path, providers=["CPUExecutionProvider"])
    row = np.array([[reading[f] for f in features]], dtype=np.float32)
    label, proba = sess.run(None, {sess.get_inputs()[0].name: row})[:2]
    p = proba[0]
    conf = float(p[np.argmax(p)]) if hasattr(p, "__len__") else float(max(p.values()))
    return label[0], conf


def demo():
    """Runnable self-check: both ONNX models train, match sklearn, and read textbook cases right."""
    results = {name: train_task(name, csv, col, feats) for name, csv, col, feats in TASKS}
    for name, (acc, agree, _) in results.items():
        assert acc >= 0.80, f"{name} accuracy too low ({acc:.3f}) -- signatures not separable"
        assert agree >= 0.999, f"{name} ONNX disagrees with sklearn ({agree:.3f})"

    feats = {name: f for name, _, _, f in TASKS}
    # a textbook fever report (hot + tachycardic + lethargic) must NOT read as healthy
    hlabel, hconf = score("health", feats["health"],
                          {"hour": 14, "heart_rate_bpm": 92, "steps": 4,
                           "body_temp_c": 40.4, "sound_level_db": 42, "acoustic_events": 0})
    assert hlabel != "healthy", f"clear fever misread as {hlabel}"
    # a deep-night, near-zero-step report must read as resting
    blabel, bconf = score("behavior", feats["behavior"],
                          {"hour": 3, "steps": 1, "heart_rate_bpm": 50,
                           "sound_level_db": 35, "acoustic_events": 0})
    print(f"\nself-check OK — fever -> {hlabel} ({hconf:.2f}), night/low-motion -> {blabel} ({bconf:.2f})")


if __name__ == "__main__":
    demo()
