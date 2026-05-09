"""All-pairs travel time matrix between coords.csv points (+ depot).

Snaps every (lat, lng) to its nearest road node, runs one Dijkstra per source
on the directed graph (so one-way streets are respected), and caches the
result to disk. After this runs once, SA / clustering / feasibility checks
read travel times as O(1) numpy lookups.
"""

from __future__ import annotations

import csv
import json
import time
from dataclasses import dataclass
from pathlib import Path

import networkx as nx
import numpy as np
import osmnx as ox
import pyproj

from graph_manager import DEFAULT_COORDS_PATH, get_or_build_graph

DEFAULT_MATRIX_PATH = Path(__file__).with_name("travel_time.npz")


@dataclass
class TravelMatrix:
    """All-pairs travel times in seconds and road distances in metres.

    `point_ids[i]` is the original coords.csv id (or "DEPOT") for row/col i.
    `node_ids[i]` is the OSM node it was snapped to.
    `time_s[i, j]` is travel time from i to j (asymmetric — one-ways).
    `dist_m[i, j]` is road distance from i to j.
    Unreachable pairs are stored as `np.inf`.
    """

    point_ids: list[str]
    node_ids: list[int]
    time_s: np.ndarray
    dist_m: np.ndarray

    def index_of(self, point_id: str) -> int:
        return self.point_ids.index(point_id)


def _snap_points_to_nodes(
    graph: nx.MultiDiGraph,
    points: list[tuple[float, float]],
) -> list[int]:
    """Snap each (lat, lng) to the nearest road node, working in a metric CRS."""
    proj = ox.projection.project_graph(graph)
    transformer = pyproj.Transformer.from_crs(
        graph.graph["crs"], proj.graph["crs"], always_xy=True
    )
    lats = [p[0] for p in points]
    lngs = [p[1] for p in points]
    proj_xs, proj_ys = transformer.transform(lngs, lats)
    nodes = ox.distance.nearest_nodes(proj, X=list(proj_xs), Y=list(proj_ys))
    return list(nodes)


def build_matrix(
    graph: nx.MultiDiGraph,
    points: list[tuple[str, float, float]],
) -> TravelMatrix:
    """Build an all-pairs travel-time + distance matrix.

    `points` is a list of `(point_id, lat, lng)`.
    """
    point_ids = [p[0] for p in points]
    coords = [(p[1], p[2]) for p in points]
    node_ids = _snap_points_to_nodes(graph, coords)

    n = len(points)
    time_s = np.full((n, n), np.inf, dtype=np.float32)
    dist_m = np.full((n, n), np.inf, dtype=np.float32)

    # Map snapped node -> list of row indices that share it (duplicates are fine).
    node_to_rows: dict[int, list[int]] = {}
    for i, nd in enumerate(node_ids):
        node_to_rows.setdefault(nd, []).append(i)

    target_nodes = set(node_ids)

    t0 = time.perf_counter()
    for src_node, src_rows in node_to_rows.items():
        # Single-source Dijkstra to every reachable node, twice — once for
        # travel_time, once for length. Both are cheap on a 1.7k-node graph.
        time_to = nx.single_source_dijkstra_path_length(
            graph, src_node, weight="travel_time"
        )
        dist_to = nx.single_source_dijkstra_path_length(
            graph, src_node, weight="length"
        )
        for tgt_node in target_nodes:
            t = time_to.get(tgt_node, np.inf)
            d = dist_to.get(tgt_node, np.inf)
            for j_row in node_to_rows[tgt_node]:
                for i_row in src_rows:
                    time_s[i_row, j_row] = t
                    dist_m[i_row, j_row] = d
    np.fill_diagonal(time_s, 0.0)
    np.fill_diagonal(dist_m, 0.0)
    elapsed = time.perf_counter() - t0
    print(
        f"built {n}x{n} travel matrix in {elapsed:.1f}s "
        f"(unreachable pairs: {int(np.isinf(time_s).sum() - 0)})"
    )
    return TravelMatrix(point_ids, node_ids, time_s, dist_m)


def save_matrix(m: TravelMatrix, path: Path | str = DEFAULT_MATRIX_PATH) -> Path:
    path = Path(path)
    np.savez_compressed(
        path,
        time_s=m.time_s,
        dist_m=m.dist_m,
        node_ids=np.array(m.node_ids, dtype=np.int64),
        point_ids=np.array(m.point_ids, dtype=object),
    )
    return path


def load_matrix(path: Path | str = DEFAULT_MATRIX_PATH) -> TravelMatrix:
    data = np.load(Path(path), allow_pickle=True)
    return TravelMatrix(
        point_ids=list(data["point_ids"]),
        node_ids=[int(x) for x in data["node_ids"]],
        time_s=data["time_s"],
        dist_m=data["dist_m"],
    )


def get_or_build_matrix(
    points: list[tuple[str, float, float]] | None = None,
    path: Path | str = DEFAULT_MATRIX_PATH,
    rebuild: bool = False,
) -> TravelMatrix:
    """Load the cached matrix if it covers `points`, otherwise rebuild."""
    path = Path(path)
    if path.exists() and not rebuild:
        cached = load_matrix(path)
        if points is None or [p[0] for p in points] == cached.point_ids:
            return cached
        print("cached matrix doesn't match requested points — rebuilding")
    if points is None:
        points = _load_points_from_coords()
    graph = get_or_build_graph()
    matrix = build_matrix(graph, points)
    save_matrix(matrix, path)
    return matrix


def _load_points_from_coords(
    coords_path: Path | str = DEFAULT_COORDS_PATH,
) -> list[tuple[str, float, float]]:
    """Read coords.csv and return [(id, lat, lng), ...]."""
    points: list[tuple[str, float, float]] = []
    with open(coords_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            points.append((row["id"], float(row["y"]), float(row["x"])))
    return points


def sanity_summary(m: TravelMatrix) -> dict:
    """Print and return min/median/max travel times and any unreachable pairs."""
    finite = m.time_s[np.isfinite(m.time_s) & (m.time_s > 0)]
    n_inf = int(np.isinf(m.time_s).sum())
    summary = {
        "n_points": len(m.point_ids),
        "min_time_s": float(finite.min()) if finite.size else None,
        "median_time_s": float(np.median(finite)) if finite.size else None,
        "max_time_s": float(finite.max()) if finite.size else None,
        "unreachable_pairs": n_inf,
    }
    print(json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    points = _load_points_from_coords()
    print(f"loaded {len(points)} points from {DEFAULT_COORDS_PATH.name}")
    matrix = get_or_build_matrix(points, rebuild=True)
    sanity_summary(matrix)
    print(f"saved matrix to {DEFAULT_MATRIX_PATH.name}")
