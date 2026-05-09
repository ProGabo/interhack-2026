"""Travel-time / distance / route service over the OSMnx city graph.

This is the only module in the optimizer that knows about OSMnx, NetworkX,
or graph internals. Everything else works in `Coordinates` space and asks
this class for travel times, distance matrices, or route polylines.

Design: deep module. The public interface is small — snap, travel_time,
travel_distance, matrix, route — and hides graph loading, edge enrichment
(speeds + travel times), nearest-node snapping, and Dijkstra caching.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal, Sequence

import networkx as nx
import numpy as np
import osmnx as ox

from .domain import Coordinates

Metric = Literal["time", "distance"]

_WEIGHT_BY_METRIC: dict[Metric, str] = {
    "time": "travel_time",   # seconds
    "distance": "length",    # meters
}


class RoadNetwork:
    """Wrap a road graph and expose travel queries in `Coordinates` space.

    The graph is enriched on construction so every edge has a `travel_time`
    (seconds) and `length` (meters). Snapped node ids and pairwise shortest
    paths are cached, so repeat lookups in a solve loop are cheap.
    """

    def __init__(self, graph: nx.MultiDiGraph):
        if not _has_edge_attribute(graph, "travel_time"):
            graph = ox.routing.add_edge_speeds(graph)
            graph = ox.routing.add_edge_travel_times(graph)
        self._graph = graph
        self._snap_cache: dict[Coordinates, int] = {}
        self._pair_cache: dict[tuple[Metric, int, int], float] = {}

    @classmethod
    def load(cls, path: Path | str) -> "RoadNetwork":
        return cls(ox.load_graphml(Path(path)))

    @property
    def graph(self) -> nx.MultiDiGraph:
        return self._graph

    # ------------------------------------------------------------------ snap

    def snap(self, point: Coordinates) -> int:
        """Return the id of the graph node closest to `point`."""
        cached = self._snap_cache.get(point)
        if cached is not None:
            return cached
        node_id = int(
            ox.distance.nearest_nodes(self._graph, X=point.lng, Y=point.lat)
        )
        self._snap_cache[point] = node_id
        return node_id

    def snap_many(self, points: Sequence[Coordinates]) -> list[int]:
        """Snap many points at once (single OSMnx call when nothing is cached)."""
        out: list[int | None] = [None] * len(points)
        missing_idx: list[int] = []
        missing_pts: list[Coordinates] = []
        for i, p in enumerate(points):
            cached = self._snap_cache.get(p)
            if cached is None:
                missing_idx.append(i)
                missing_pts.append(p)
            else:
                out[i] = cached
        if missing_pts:
            xs = [p.lng for p in missing_pts]
            ys = [p.lat for p in missing_pts]
            nodes = ox.distance.nearest_nodes(self._graph, X=xs, Y=ys)
            nodes_list = nodes.tolist() if hasattr(nodes, "tolist") else list(nodes)
            for slot, p, node in zip(missing_idx, missing_pts, nodes_list):
                node_id = int(node)
                self._snap_cache[p] = node_id
                out[slot] = node_id
        return [n for n in out]  # type: ignore[return-value]

    # ----------------------------------------------------------- scalar queries

    def travel_time(self, a: Coordinates, b: Coordinates) -> float:
        """Seconds along the fastest route from `a` to `b`."""
        return self._pair(a, b, "time")

    def travel_distance(self, a: Coordinates, b: Coordinates) -> float:
        """Meters along the fastest route from `a` to `b`."""
        return self._pair(a, b, "distance")

    # ------------------------------------------------------------------- matrix

    def matrix(
        self,
        points: Sequence[Coordinates],
        metric: Metric = "time",
    ) -> np.ndarray:
        """Return an N×N matrix of pairwise travel `metric` between points.

        Diagonal is zero. Unreachable pairs become `+inf`. Internally one
        single-source Dijkstra per source, so cost is O(n · (E + V log V)),
        not O(n²) Dijkstras.
        """
        weight = _WEIGHT_BY_METRIC[metric]
        nodes = self.snap_many(points)
        n = len(nodes)
        out = np.full((n, n), np.inf, dtype=float)
        np.fill_diagonal(out, 0.0)
        for i, src in enumerate(nodes):
            lengths = nx.single_source_dijkstra_path_length(
                self._graph, src, weight=weight
            )
            for j, dst in enumerate(nodes):
                if i == j:
                    continue
                d = lengths.get(dst)
                if d is None:
                    continue
                out[i, j] = d
                self._pair_cache[(metric, src, dst)] = d
        return out

    # -------------------------------------------------------------------- route

    def route(
        self,
        a: Coordinates,
        b: Coordinates,
        metric: Metric = "time",
    ) -> list[Coordinates]:
        """Return the polyline of (lat, lng) along the fastest route a→b."""
        weight = _WEIGHT_BY_METRIC[metric]
        src, dst = self.snap(a), self.snap(b)
        node_path = nx.shortest_path(self._graph, src, dst, weight=weight)
        return [
            Coordinates(
                lat=float(self._graph.nodes[n]["y"]),
                lng=float(self._graph.nodes[n]["x"]),
            )
            for n in node_path
        ]

    # ----------------------------------------------------------------- internals

    def _pair(self, a: Coordinates, b: Coordinates, metric: Metric) -> float:
        weight = _WEIGHT_BY_METRIC[metric]
        src, dst = self.snap(a), self.snap(b)
        if src == dst:
            return 0.0
        cached = self._pair_cache.get((metric, src, dst))
        if cached is not None:
            return cached
        value = float(
            nx.shortest_path_length(self._graph, src, dst, weight=weight)
        )
        self._pair_cache[(metric, src, dst)] = value
        return value


def _has_edge_attribute(graph: nx.MultiDiGraph, attr: str) -> bool:
    for _, _, data in graph.edges(data=True):
        return attr in data
    return False


if __name__ == "__main__":
    # Smoke test: load the saved graph and print a tiny matrix.
    import time as _time

    graph_path = Path(__file__).resolve().parent.parent / "cities_graph.graphml"
    print(f"Loading graph from {graph_path}…")
    t0 = _time.perf_counter()
    net = RoadNetwork.load(graph_path)
    print(f"  loaded in {_time.perf_counter() - t0:.2f}s — "
          f"{net.graph.number_of_nodes()} nodes, {net.graph.number_of_edges()} edges")

    granollers = Coordinates(lat=41.6083, lng=2.2877)   # roughly Granollers center
    mollet = Coordinates(lat=41.5413, lng=2.2123)       # roughly Mollet center
    t = net.travel_time(granollers, mollet)
    d = net.travel_distance(granollers, mollet)
    print(f"Granollers → Mollet: {t/60:.1f} min, {d/1000:.2f} km")

    M = net.matrix([granollers, mollet], metric="time")
    print("Time matrix (s):")
    print(M)
