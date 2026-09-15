"""Extract the approved crayon artwork without redrawing or recoloring it."""
from pathlib import Path
import json
import numpy as np
from PIL import Image
from scipy import ndimage

root = Path(__file__).resolve().parents[1]
assets = root / "public/paper-assets/pets"
results = []
for name in ("star-jelly", "mushroom-spirit", "cloud-bunny"):
    with Image.open(assets / f"{name}-crayon-v3.png") as image:
        rgb = np.array(image.convert("RGB"))
    # Dark pencil contours enclose the paper-white body. Fill those interiors
    # instead of making all white pixels transparent (which would erase them).
    ink = rgb.min(axis=2) < 155
    ink = ndimage.binary_closing(ink, iterations=2)
    silhouette = ndimage.binary_fill_holes(ink)
    labels, count = ndimage.label(silhouette)
    sizes = np.bincount(labels.ravel())
    keep = sizes > 300
    keep[0] = False
    silhouette = keep[labels]
    # Include the faint edge pixels immediately outside the graphite contour.
    silhouette = ndimage.binary_dilation(silhouette, iterations=1)
    alpha = np.where(silhouette, 255, 0).astype(np.uint8)
    rgba = np.dstack((rgb, alpha))
    destination = assets / f"{name}-app.png"
    Image.fromarray(rgba).save(destination, optimize=True)
    assert np.array_equal(rgba[:, :, :3], rgb)
    assert not alpha[0].any() and not alpha[-1].any()
    assert not alpha[:, 0].any() and not alpha[:, -1].any()
    assert 0.15 < np.mean(alpha > 0) < 0.8
    results.append({"name": name, "size": list(alpha.shape),
                    "opaque_fraction": float(np.mean(alpha > 0)),
                    "original_rgb_unchanged": True, "transparent_borders": True})
print(json.dumps(results, indent=2))
