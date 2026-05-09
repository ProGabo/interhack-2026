"""Cluster orders into per-driver groups.

A `Clusterer` assigns every order to exactly one driver via k-medoids on a
custom road-time + window-gap distance, then rebalances cluster membership
until each cluster fits inside the assigned truck's weight + grid-cell
capacity.

Design: deep module. Public surface is the `Clusterer` constructor and its
`.cluster(problem)` method, returning a `ClusterAssignment`. Everything
else — distance-matrix construction, PAM iterations, capacity rebalance,
driver-to-cluster matching — is internal.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import time
from pathlib import Path
from typing import Sequence

import numpy as np

from .catalog import Catalog
from .domain import Driver, Order, TimeWindow
from .problem import DeliveryProblem
from .road_network import RoadNetwork


# ---------------------------------------------------------------- result types


@dataclass(frozen=True)
class Cluster:
    """A driver and the orders they will serve.

    `medoid_local_idx` is the index *within `orders`* (0-based) of the order
    that anchors the cluster — useful for routing heuristics that benefit
    from a starting reference point.
    """

    driver: Driver
    orders: list[Order]
    medoid_local_idx: int

    @property
    def order_ids(self) -> list[str]:
        return [o.id for o in self.orders]

    @property
    def medoid_order(self) -> Order:
        return self.orders[self.medoid_local_idx]


@dataclass(frozen=True)
class ClusterAssignment:
    """Result of clustering: every driver mapped to their order list."""

    clusters: list[Cluster]
    distance_matrix: np.ndarray  # NxN over input orders, in original order
    alpha: float
    beta: float

    def by_driver_id(self) -> dict[str, Cluster]:
        return {c.driver.id: c for c in self.clusters}


# --------------------------------------------------------------- the clusterer


class Clusterer:
    """Group orders for delivery by k-medoids, then rebalance for truck capacity.

    Distance metric between two orders i, j:

        D(i, j) = alpha * road_time_seconds(i, j)
                + beta  * window_gap_seconds(i, j)

    where `road_time` is shortest-path travel time over the OSMnx graph and
    `window_gap` is the seconds of forced wait between non-overlapping
    delivery windows (zero if windows overlap).

    After PAM k-medoids converges, the rebalance step greedily moves orders
    from over-capacity clusters into clusters with room, choosing moves
    that least increase total distance. The medoids themselves are frozen
    during rebalance — only the labels move — so clusters keep a stable
    geographic anchor.
    """

    def __init__(
        self,
        network: RoadNetwork,
        catalog: Catalog,
        alpha: float = 1.0,
        beta: float = 0.5,
        max_iter: int = 100,
        max_rebalance_passes: int = 200,
        seed: int | None = 0,
    ):
        self._network = network
        self._catalog = catalog
        self._alpha = alpha
        self._beta = beta
        self._max_iter = max_iter
        self._max_rebalance_passes = max_rebalance_passes
        self._rng = random.Random(seed)

    def cluster(self, problem: DeliveryProblem) -> ClusterAssignment:
        problem.validate_against_catalog(self._catalog)
        n = problem.order_count()
        k = problem.driver_count()
        if k == 0:
            raise ValueError("DeliveryProblem has no drivers")
        if n < k:
            raise ValueError(
                f"Fewer orders ({n}) than drivers ({k}); need k <= n for k-medoids"
            )
        self._precheck_individual_capacity(problem)

        D = self._build_distance_matrix(problem.orders)
        labels, medoid_idx = _pam_kmedoids(D, k=k, max_iter=self._max_iter, rng=self._rng)

        cluster_to_driver = self._match_drivers_to_clusters(
            medoid_idx=medoid_idx,
            orders=problem.orders,
            drivers=problem.drivers,
        )
        labels = self._rebalance(
            labels=labels,
            medoid_idx=medoid_idx,
            D=D,
            orders=problem.orders,
            cluster_to_driver=cluster_to_driver,
        )

        clusters: list[Cluster] = []
        for c in range(k):
            members = np.where(labels == c)[0]
            cluster_orders = [problem.orders[i] for i in members.tolist()]
            local_medoid = int(np.where(members == medoid_idx[c])[0][0])
            clusters.append(
                Cluster(
                    driver=cluster_to_driver[c],
                    orders=cluster_orders,
                    medoid_local_idx=local_medoid,
                )
            )
        return ClusterAssignment(
            clusters=clusters,
            distance_matrix=D,
            alpha=self._alpha,
            beta=self._beta,
        )

    # ------------------------------------------------------------ distance matrix

    def _build_distance_matrix(self, orders: Sequence[Order]) -> np.ndarray:
        coords = [o.customer.coords for o in orders]
        time_matrix = self._network.matrix(coords, metric="time")
        n = len(orders)
        gap_matrix = np.zeros((n, n), dtype=float)
        for i in range(n):
            for j in range(i + 1, n):
                gap = _window_gap_seconds(orders[i].window, orders[j].window)
                gap_matrix[i, j] = gap
                gap_matrix[j, i] = gap
        # Symmetrise time (road network may be slightly asymmetric on one-ways).
        sym_time = (time_matrix + time_matrix.T) / 2.0
        return self._alpha * sym_time + self._beta * gap_matrix

    # --------------------------------------------------------------- precheck

    def _precheck_individual_capacity(self, problem: DeliveryProblem) -> None:
        """Fail loudly if any single order won't fit any truck."""
        min_weight = min(d.truck.max_weight_kg for d in problem.drivers)
        min_cells = min(d.truck.grid_cells for d in problem.drivers)
        for o in problem.orders:
            w_del, w_pick = _split_weight([o], self._catalog)
            c_del, c_pick = _split_cells([o], self._catalog)
            if max(w_del, w_pick) > min_weight:
                raise ValueError(
                    f"Order {o.id} weighs {max(w_del, w_pick):.0f}kg, "
                    f"exceeds smallest truck cap ({min_weight:.0f}kg)"
                )
            if max(c_del, c_pick) > min_cells:
                raise ValueError(
                    f"Order {o.id} occupies {max(c_del, c_pick)} cells, "
                    f"exceeds smallest truck grid ({min_cells} cells)"
                )

    # ----------------------------------------------------- driver-cluster match

    def _match_drivers_to_clusters(
        self,
        medoid_idx: list[int],
        orders: Sequence[Order],
        drivers: Sequence[Driver],
    ) -> dict[int, Driver]:
        """Greedy match driver→cluster by depot-to-medoid travel time."""
        n_d, n_c = len(drivers), len(medoid_idx)
        cost = np.zeros((n_d, n_c), dtype=float)
        for d, driver in enumerate(drivers):
            for c, m in enumerate(medoid_idx):
                cost[d, c] = self._network.travel_time(
                    driver.depot, orders[m].customer.coords
                )
        used_d: set[int] = set()
        used_c: set[int] = set()
        out: dict[int, Driver] = {}
        flat = sorted(
            ((cost[d, c], d, c) for d in range(n_d) for c in range(n_c)),
            key=lambda t: t[0],
        )
        for _, d, c in flat:
            if d in used_d or c in used_c:
                continue
            out[c] = drivers[d]
            used_d.add(d)
            used_c.add(c)
            if len(out) == n_c:
                break
        return out

    # --------------------------------------------------------------- rebalance

    def _rebalance(
        self,
        labels: np.ndarray,
        medoid_idx: list[int],
        D: np.ndarray,
        orders: Sequence[Order],
        cluster_to_driver: dict[int, Driver],
    ) -> np.ndarray:
        labels = labels.copy()
        for _ in range(self._max_rebalance_passes):
            overflow = self._cluster_overflow(labels, orders, cluster_to_driver)
            if not overflow:
                return labels
            c_over = max(overflow.keys(), key=lambda c: overflow[c])
            move = self._best_move_out_of(
                cluster=c_over,
                labels=labels,
                medoid_idx=medoid_idx,
                D=D,
                orders=orders,
                cluster_to_driver=cluster_to_driver,
            )
            if move is None:
                raise RuntimeError(
                    f"Cannot rebalance cluster {c_over}: no feasible move out. "
                    f"Truck capacity may be too small for the workload."
                )
            order_idx, target_cluster = move
            labels[order_idx] = target_cluster
        raise RuntimeError(
            f"Rebalance did not converge within {self._max_rebalance_passes} passes"
        )

    def _cluster_overflow(
        self,
        labels: np.ndarray,
        orders: Sequence[Order],
        cluster_to_driver: dict[int, Driver],
    ) -> dict[int, float]:
        """Return {cluster_id: utilisation_ratio} for every overflowing cluster."""
        out: dict[int, float] = {}
        for c, driver in cluster_to_driver.items():
            members = [orders[i] for i in np.where(labels == c)[0].tolist()]
            ratio = _utilisation_ratio(members, driver, self._catalog)
            if ratio > 1.0:
                out[c] = ratio
        return out

    def _best_move_out_of(
        self,
        cluster: int,
        labels: np.ndarray,
        medoid_idx: list[int],
        D: np.ndarray,
        orders: Sequence[Order],
        cluster_to_driver: dict[int, Driver],
    ) -> tuple[int, int] | None:
        """Pick the cheapest (order, target_cluster) move that relieves `cluster`."""
        members = [
            i for i in np.where(labels == cluster)[0].tolist()
            if i != medoid_idx[cluster]
        ]
        best: tuple[int, int, float] | None = None  # (order_idx, target, delta_dist)
        for order_idx in members:
            current_dist = D[order_idx, medoid_idx[cluster]]
            ranking = np.argsort(D[order_idx, medoid_idx])
            for target in ranking.tolist():
                if target == cluster:
                    continue
                target_driver = cluster_to_driver[target]
                target_members = [orders[i] for i in np.where(labels == target)[0].tolist()]
                tentative = target_members + [orders[order_idx]]
                if _utilisation_ratio(tentative, target_driver, self._catalog) > 1.0:
                    continue
                delta = float(D[order_idx, medoid_idx[target]] - current_dist)
                if best is None or delta < best[2]:
                    best = (order_idx, target, delta)
                break  # only consider the closest feasible alternative per order
        if best is None:
            return None
        return best[0], best[1]


# ---------------------------------------------------------- module-level helpers


def _seconds_in_day(t: time) -> int:
    return t.hour * 3600 + t.minute * 60 + t.second


def _window_gap_seconds(w1: TimeWindow, w2: TimeWindow) -> float:
    s1, e1 = _seconds_in_day(w1.start), _seconds_in_day(w1.end)
    s2, e2 = _seconds_in_day(w2.start), _seconds_in_day(w2.end)
    return float(max(0, max(s1, s2) - min(e1, e2)))


def _split_weight(orders: Sequence[Order], catalog: Catalog) -> tuple[float, float]:
    delivery = pickup = 0.0
    for o in orders:
        for ln in o.lines:
            w = catalog[ln.product_id].weight_kg * ln.quantity
            if ln.direction == "delivery":
                delivery += w
            else:
                pickup += w
    return delivery, pickup


def _split_cells(orders: Sequence[Order], catalog: Catalog) -> tuple[int, int]:
    delivery = pickup = 0
    for o in orders:
        for ln in o.lines:
            cells = catalog[ln.product_id].cell_count * ln.quantity
            if ln.direction == "delivery":
                delivery += cells
            else:
                pickup += cells
    return delivery, pickup


def _utilisation_ratio(orders: Sequence[Order], driver: Driver, catalog: Catalog) -> float:
    """Worst-case utilisation across weight and cells, deliveries and pickups."""
    w_del, w_pick = _split_weight(orders, catalog)
    c_del, c_pick = _split_cells(orders, catalog)
    return max(
        w_del / driver.truck.max_weight_kg,
        w_pick / driver.truck.max_weight_kg,
        c_del / driver.truck.grid_cells,
        c_pick / driver.truck.grid_cells,
    )


# ------------------------------------------------------------------ PAM kernel


def _pam_kmedoids(
    D: np.ndarray,
    k: int,
    max_iter: int,
    rng: random.Random,
) -> tuple[np.ndarray, list[int]]:
    """Alternating k-medoids ('Voronoi iteration'). Returns (labels, medoid_idx)."""
    n = D.shape[0]
    if k > n:
        raise ValueError(f"k={k} exceeds n={n}")
    medoids = _kpp_init(D, k, rng)
    labels = np.argmin(D[:, medoids], axis=1)
    for _ in range(max_iter):
        new_medoids: list[int] = []
        for c in range(k):
            members = np.where(labels == c)[0]
            if len(members) == 0:
                # Reseed empty cluster with the point farthest from any medoid.
                farthest = int(np.argmax(D[:, medoids].min(axis=1)))
                new_medoids.append(farthest)
                continue
            sub_costs = D[np.ix_(members, members)].sum(axis=1)
            new_medoids.append(int(members[np.argmin(sub_costs)]))
        if new_medoids == medoids:
            return labels, medoids
        medoids = new_medoids
        labels = np.argmin(D[:, medoids], axis=1)
    return labels, medoids


def _kpp_init(D: np.ndarray, k: int, rng: random.Random) -> list[int]:
    """k-means++ flavoured seeding: spread initial medoids by squared distance."""
    n = D.shape[0]
    chosen = [rng.randrange(n)]
    while len(chosen) < k:
        nearest = D[:, chosen].min(axis=1).copy()
        nearest[chosen] = 0.0
        if nearest.sum() == 0:
            remaining = [i for i in range(n) if i not in chosen]
            chosen.append(rng.choice(remaining))
            continue
        weights = (nearest ** 2).tolist()
        for c in chosen:
            weights[c] = 0.0
        idx = rng.choices(range(n), weights=weights, k=1)[0]
        if idx not in chosen:
            chosen.append(int(idx))
    return chosen


# --------------------------------------------------------------- smoke test


if __name__ == "__main__":
    backend = Path(__file__).resolve().parent.parent
    network = RoadNetwork.load(backend / "cities_graph.graphml")
    catalog = Catalog.load(backend / "data" / "products.json")
    problem = DeliveryProblem.from_json(backend / "data" / "sample_input.json")

    clusterer = Clusterer(network, catalog, alpha=1.0, beta=0.5, seed=0)
    assignment = clusterer.cluster(problem)

    print(f"Assigned {problem.order_count()} orders to {len(assignment.clusters)} drivers")
    print(f"  metric: D = {assignment.alpha}*time + {assignment.beta}*window_gap\n")
    for c in assignment.clusters:
        w_del, w_pick = _split_weight(c.orders, catalog)
        cells_del, cells_pick = _split_cells(c.orders, catalog)
        print(f"Driver {c.driver.id}  truck {c.driver.truck.id}  "
              f"({c.driver.truck.max_weight_kg:.0f}kg / {c.driver.truck.grid_cells} cells)")
        print(f"  anchor: {c.medoid_order.customer.name}")
        for o in c.orders:
            marker = " *" if o is c.medoid_order else "  "
            print(f"  {marker} {o.id}  {o.customer.name}  window {o.window.start}-{o.window.end}")
        print(f"  load: {w_del:.0f}kg deliv / {w_pick:.0f}kg pickup, "
              f"{cells_del} / {cells_pick} cells")
        print()
