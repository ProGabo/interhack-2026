"""Push solver output into Firestore so the frontend reads it live.

Document shape mirrors `seed/seed.py`:

    routes/{driverId}
      driver_id, truck_id, truck_layout {rows, cols},
      points         [{lat, lng, address?}]      ordered route
      pallets        [{row, col, products[]}]    one entry per occupied slot
      deliveries     [{pallet_positions[]}]      aligned with points
      windows        [{start, end}]
      service_times  [number]                    minutes per stop
      delivery_status, status

The Firebase Admin app is initialised lazily so the FastAPI process starts
fine without credentials (e.g. local solver-only dev). When the
`seed/service-account.json` is missing we log a warning and noop on writes.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

_BASE = Path(__file__).resolve().parent
_REPO = _BASE.parent
_DEFAULT_CRED = _REPO / "seed" / "service-account.json"

_db = None
_init_attempted = False


def _try_init() -> None:
    global _db, _init_attempted
    if _init_attempted:
        return
    _init_attempted = True
    cred_path = Path(os.environ.get("FIREBASE_SERVICE_ACCOUNT", _DEFAULT_CRED))
    if not cred_path.exists():
        print(f"[firestore_writer] no service account at {cred_path} — writes disabled")
        return
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore

        if not firebase_admin._apps:
            firebase_admin.initialize_app(credentials.Certificate(str(cred_path)))
        _db = firestore.client()
        print(f"[firestore_writer] initialised from {cred_path}")
    except Exception as exc:  # noqa: BLE001
        print(f"[firestore_writer] init failed: {exc}")


def is_enabled() -> bool:
    _try_init()
    return _db is not None


def _hm(s: int) -> str:
    h, m = divmod(int(s) // 60, 60)
    return f"{h:02d}:{m:02d}"


def _van_layout(van_type: str) -> dict:
    """Pallet floor layout (rows × cols) for the visual grid."""
    return {"6_pallets": {"rows": 2, "cols": 3}, "8_pallets": {"rows": 2, "cols": 4}}.get(
        van_type, {"rows": 2, "cols": 3}
    )


def _compute_cube_layout(
    rows: int, cols: int, deliveries_per_stop: list[tuple[int, list[str]]]
) -> tuple[list[dict], dict]:
    """Run SmartTruckOptimizer3D to place every cube in a (cols·3, rows·3, 1)
    grid. Each cube carries the destination `stop_index` (1-based, matches the
    route doc's `points` index) and a `product_id` (round-robin across the
    stop's units).

    `deliveries_per_stop` is an ordered list of (stop_index, [product_id per
    unit]); the optimizer respects that route order so earlier stops are
    extractable first.
    """
    L = cols * 3
    W = rows * 3
    H = 1

    counts: dict[int, int] = {idx: len(prods) for idx, prods in deliveries_per_stop if prods}
    if not counts:
        return [], {"L": L, "W": W, "H": H}

    capacity = L * W * H
    total = sum(counts.values())
    if total > capacity:
        # The OR-tools capacity model already enforces this; truncate
        # defensively so the optimizer never deadlocks.
        scale = capacity / total
        counts = {k: max(1, int(v * scale)) for k, v in counts.items()}

    route_ids = [idx for idx, _ in deliveries_per_stop if counts.get(idx, 0) > 0]

    # Lazy import keeps the API importable when numpy is missing in tests.
    import numpy as np  # noqa: F401  (used by SmartTruckOptimizer3D)
    from optimize_box import SmartTruckOptimizer3D

    opt = SmartTruckOptimizer3D(L, W, H, route_ids)
    initial = opt.generate_initial_state(counts)
    final, _, _ = opt.optimize(initial, steps=2000)

    product_streams = {idx: list(prods) for idx, prods in deliveries_per_stop}
    consumed = {idx: 0 for idx in counts}

    cubes: list[dict] = []
    for x in range(L):
        for y in range(W):
            for z in range(H):
                stop_idx = int(final[x, y, z])
                if stop_idx == 0:
                    continue
                stream = product_streams.get(stop_idx, [])
                pid = stream[consumed[stop_idx] % len(stream)] if stream else None
                consumed[stop_idx] += 1
                cubes.append({
                    "x": x, "y": y, "z": z,
                    "stop_index": stop_idx,
                    "product_id": pid,
                })
    return cubes, {"L": L, "W": W, "H": H}


def _pallets_for_stop(stop: dict, products: dict, capacity_cells: int = 9) -> list[list[dict]]:
    """Greedy packer: group a stop's deliveries into pallets capped at
    `capacity_cells` cube-units each. One pallet's `products` list is in the
    same shape the frontend already consumes."""
    items: list[tuple[str, int]] = []
    for line in stop.get("deliveries", []):
        pid = line["product_id"]
        cells = (
            products[pid]["length_cells"]
            * products[pid]["width_cells"]
            * products[pid]["height_cells"]
        )
        items.extend([(pid, cells)] * line["qty"])

    pallets: list[list[dict]] = []
    current: dict[str, int] = {}
    used = 0
    for pid, cells in items:
        if used + cells > capacity_cells and current:
            pallets.append([{"product_id": p, "quantity": q} for p, q in current.items()])
            current, used = {}, 0
        current[pid] = current.get(pid, 0) + 1
        used += cells
    if current:
        pallets.append([{"product_id": p, "quantity": q} for p, q in current.items()])
    return pallets


def build_route_doc(
    *,
    driver_id: str,
    truck_id: str,
    van_type: str,
    depot: dict,
    request_stops: list[dict],
    van_plan,
    service_times_s: dict[str, float],
) -> dict:
    """Translate one VanPlan into the Firestore route document shape."""
    layout = _van_layout(van_type)
    rows, cols = layout["rows"], layout["cols"]
    products = {p["id"]: p for p in json.loads((_BASE / "products.json").read_text())["products"]}
    by_id = {s["id"]: s for s in request_stops}

    points: list[dict] = [
        {"lat": depot["coords"]["lat"], "lng": depot["coords"]["lng"], "address": depot.get("id", "Depot")}
    ]
    windows: list[dict] = [{"start": depot["open"], "end": depot["close"]}]
    service_times_min: list[float] = [0]
    pallets: list[dict] = []
    deliveries: list[dict] = [{"pallet_positions": []}]

    next_slot = 0  # row-major fill of the truck floor
    deliveries_per_stop: list[tuple[int, list[str]]] = []

    for stop_idx, sp in enumerate(van_plan.stops, start=1):
        s = by_id[sp.id]
        points.append({
            "lat": s["coords"]["lat"],
            "lng": s["coords"]["lng"],
            "address": s.get("address", s["id"]),
        })
        windows.append({"start": s["time_window"]["open"], "end": s["time_window"]["close"]})
        service_times_min.append(round(service_times_s.get(sp.id, 0) / 60, 1))

        stop_pallets = _pallets_for_stop(s, products)
        positions: list[dict] = []
        for pdata in stop_pallets:
            if next_slot >= rows * cols:
                break
            r, c = divmod(next_slot, cols)
            pallets.append({"row": r, "col": c, "products": pdata})
            positions.append({"row": r, "col": c})
            next_slot += 1
        deliveries.append({"pallet_positions": positions})

        units: list[str] = []
        for line in s.get("deliveries", []):
            units.extend([line["product_id"]] * line["qty"])
        deliveries_per_stop.append((stop_idx, units))

    cubes, cube_grid = _compute_cube_layout(rows, cols, deliveries_per_stop)

    return {
        "driver_id": driver_id,
        "truck_id": truck_id,
        "truck_layout": layout,
        "cube_grid": cube_grid,
        "cubes": cubes,
        "points": points,
        "pallets": pallets,
        "deliveries": deliveries,
        "windows": windows,
        "service_times": service_times_min,
        "delivery_status": ["pending"] * len(points),
        "status": "pending",
    }


def write_routes(docs: list[dict]) -> int:
    """Write a batch of route docs to `routes/{driver_id}`. Returns count
    written; 0 when Firestore is disabled."""
    if not is_enabled():
        return 0
    written = 0
    for doc in docs:
        _db.collection("routes").document(doc["driver_id"]).set(doc)
        written += 1
    return written
