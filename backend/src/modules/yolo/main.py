"""Cow detector for MilkSense — Ultralytics YOLO26 (default yolo26s), COCO-pretrained.

`cow` is COCO class 19, so the stock pretrained weights already recognise cattle —
no custom training needed. Runs detection over images/ (or a path/URL you pass),
keeps only cow boxes, prints the count + confidence, and saves annotated copies.

The weights file (`yolo26s.pt`, a few MB) auto-downloads from Ultralytics on first
run into this folder.

Run: uv run python main.py                 # every image in images/
     uv run python main.py path/to.jpg     # one image, a directory, or a URL
"""
import os
import sys
import cv2
from ultralytics import YOLO

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_NAME = "yolo26s.pt"          # default model; swap for yolo26n/m/l/x to trade speed vs accuracy
IMAGES = os.path.join(HERE, "images")
OUT = os.path.join(HERE, "out")
COW_CLASS = 19                     # COCO id for 'cow'


def _stamp_count(img, n):
    """Write 'Cows: n' in the bottom-right corner, on a dark backdrop so it stays legible."""
    h, w = img.shape[:2]
    scale = max(0.6, w / 1100)                 # scale text to image size
    thick = max(1, round(scale * 2))
    font, text = cv2.FONT_HERSHEY_SIMPLEX, f"Cows: {n}"
    (tw, th), base = cv2.getTextSize(text, font, scale, thick)
    pad, x, y = round(8 * scale), w - 1, h - 1
    x -= tw + 2 * pad; y -= pad
    cv2.rectangle(img, (x - pad, y - th - pad), (w - 1, h - 1), (0, 0, 0), -1)
    cv2.putText(img, text, (x, y + base // 2), font, scale, (0, 255, 0), thick, cv2.LINE_AA)
    return img


def detect(source, conf=0.25):
    os.chdir(HERE)                 # keep weights + outputs inside the module folder
    model = YOLO(MODEL_NAME)
    results = model.predict(source=source, conf=conf, classes=[COW_CLASS], verbose=False)
    out_dir = os.path.join(OUT, "cows")
    os.makedirs(out_dir, exist_ok=True)
    for r in results:
        n = len(r.boxes)
        img = _stamp_count(r.plot(), n)        # r.plot() = boxes drawn; then stamp the count
        cv2.imwrite(os.path.join(out_dir, os.path.basename(r.path)), img)
        confs = [round(float(c), 2) for c in r.boxes.conf]
        print(f"{os.path.basename(r.path):<28} {n} cow(s)  {confs}")
    return results


def demo():
    """Runnable self-check: the default model must recognise a cow in the sample photos."""
    results = detect(IMAGES)
    total = sum(len(r.boxes) for r in results)
    assert results, f"no images found in {IMAGES}"
    assert total >= 1, "no cows detected — model or images problem"
    print(f"\nself-check OK: {total} cow detection(s) across {len(results)} image(s); "
          f"annotated -> {os.path.join(OUT, 'cows')}")


if __name__ == "__main__":
    detect(sys.argv[1]) if len(sys.argv) > 1 else demo()
