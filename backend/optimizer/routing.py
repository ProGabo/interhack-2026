"""In-cluster route optimization via simulated annealing.

Given a `Cluster` (one driver + their orders) and the shared `RoadNetwork`,
this module finds a visit ordering that minimises

    cost = total_drive_seconds + window_penalty * total_late_seconds

over permutations of the cluster's stops. Service time is fixed per stop
in this phase (`_service_time_for`); a future phase can swap in a
loading-aware estimator without touching the SA outer loop.

Public surface:
    Schedule        — the optimised plan (per-stop arrival/departure + KPIs)
    ScheduledStop   — one stop in a Schedule
    RouteSolver     — runs SA over visit permutations within a cluster
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from datetime import time
from pathlib import Path
from typing import Sequence

import numpy as np

from .clustering import Cluster
from .domain import Driver, Order
from .road_network import RoadNetwork


# ---------------------------------------------------------------- result types


@dataclass(frozen=True)
class ScheduledStop:
    """One stop in an optimised route."""

    order: Order
    arrival_seconds: float          # clock time, seconds since midnight
    departure_seconds: float        # arrival + service (after any wait)
    drive_seconds_from_prev: float  # travel from previous stop (or depot)
    service_seconds: float
    window_violation_seconds: float  # 0 if on time


@dataclass(frozen=True)
class Schedule:
    """An ordered visit plan plus KPIs and SA cost."""

    driver: Driver
    stops: list[ScheduledStop]
    return_drive_seconds: float          # last stop -> depot
    total_drive_seconds: float           # includes return
    total_service_seconds: float
    total_window_violation_seconds: float
    cost: float                          # SA objective (drive + window penalty)


# ------------------------------------------------------------------ RouteSolver


class RouteSolver:
    """Optimise visit order within one cluster using simulated annealing.

    Build a single travel-time matrix once (depot at index 0, stops at
    1..n) via the shared `RoadNetwork`, then run SA over permutations of
    the stop indices. Initial state: nearest-neighbour walk from the depot.

    Neighborhood moves (uniform random):
        * swap      — exchange two stops
        * reverse   — flip a contiguous segment (2-opt)
        * relocate  — pull one stop and reinsert at another position (or-opt)

    Cooling: geometric, computed once from `(t_min / t_init) ^ (1/iters)`.
    """

    def __init__(
        self,
        network: RoadNetwork,
        window_penalty_per_second: float = 50.0,
        service_setup_seconds: float = 60.0,
        service_handling_per_line_seconds: float = 90.0,
        sa_iterations: int = 8000,
        sa_initial_temp: float = 600.0,
        sa_min_temp: float = 0.5,
        seed: int | None = 0,
    ):
        if sa_iterations < 1:
            raise ValueError("sa_iterations must be >= 1")
        if sa_initial_temp <= sa_min_temp:
            raise ValueError("sa_initial_temp must exceed sa_min_temp")
        self._network = network
        self._window_penalty = window_penalty_per_second
        self._setup = service_setup_seconds
        self._handling = service_handling_per_line_seconds
        self._iters = sa_iterations
        self._t_init = sa_initial_temp
        self._t_min = sa_min_temp
        self._rng = random.Random(seed)

    # ----------------------------------------------------------- public API

    def solve(self, cluster: Cluster) -> Schedule:
        if not cluster.orders:
            raise ValueError("Cluster has no orders")
        M = self._travel_matrix(cluster.driver, cluster.orders)
        shift_start_s = float(_seconds_in_day(cluster.driver.shift_start))
        state = self._nearest_neighbour(M, len(cluster.orders))
        state, _ = self._run_sa(state, M, cluster.orders, shift_start_s)
        return self._to_schedule(state, M, cluster.orders, cluster.driver, shift_start_s)

    # ----------------------------------------------------------- inputs

    def _travel_matrix(
        self, driver: Driver, orders: Sequence[Order]
    ) -> np.ndarray:
        coords = [driver.depot] + [o.customer.coords for o in orders]
        return self._network.matrix(coords, metric="time")

    def _nearest_neighbour(self, M: np.ndarray, n_orders: int) -> list[int]:
        unvisited = set(range(1, n_orders + 1))
        state: list[int] = []
        current = 0  # depot row
        while unvisited:
            nxt = min(unvisited, key=lambda j: M[current, j])
            state.append(nxt - 1)  # back to order index (0-based)
            unvisited.remove(nxt)
            current = nxt
        return state

    # ----------------------------------------------------------------- SA loop

    def _run_sa(
        self,
        initial: list[int],
        M: np.ndarray,
        orders: Sequence[Order],
        shift_start_s: float,
    ) -> tuple[list[int], float]:
        current = initial[:]
        current_cost = self._cost(current, M, orders, shift_start_s)
        best, best_cost = current[:], current_cost
        T = self._t_init
        cooling = (self._t_min / self._t_init) ** (1.0 / self._iters)
        for _ in range(self._iters):
            candidate = self._perturb(current)
            cand_cost = self._cost(candidate, M, orders, shift_start_s)
            delta = cand_cost - current_cost
            if delta < 0 or self._rng.random() < math.exp(-delta / max(T, 1e-9)):
                current = candidate
                current_cost = cand_cost
                if current_cost < best_cost:
                    best, best_cost = current[:], current_cost
            T *= cooling
        return best, best_cost

    def _perturb(self, state: list[int]) -> list[int]:
        n = len(state)
        if n < 2:
            return state[:]
        move = self._rng.choice(("swap", "reverse", "relocate"))
        if move == "swap":
            i, j = self._rng.sample(range(n), 2)
            new = state[:]
            new[i], new[j] = new[j], new[i]
            return new
        if move == "reverse":
            i, j = sorted(self._rng.sample(range(n), 2))
            return state[:i] + list(reversed(state[i : j + 1])) + state[j + 1 :]
        # relocate
        i = self._rng.randrange(n)
        j = self._rng.randrange(n)
        new = state[:]
        moved = new.pop(i)
        new.insert(j, moved)
        return new

    # ----------------------------------------------------------------- costing

    def _cost(
        self,
        state: list[int],
        M: np.ndarray,
        orders: Sequence[Order],
        shift_start_s: float,
    ) -> float:
        drive = 0.0
        violation = 0.0
        t = shift_start_s
        prev = 0  # depot
        for order_idx in state:
            nxt = order_idx + 1
            d = float(M[prev, nxt])
            drive += d
            t += d
            order = orders[order_idx]
            ws = _seconds_in_day(order.window.start)
            we = _seconds_in_day(order.window.end)
            if t < ws:
                t = float(ws)        # wait until window opens
            if t > we:
                violation += t - we  # arrived late, by `t - we` seconds
            t += self._service_time_for(order)
            prev = nxt
        drive += float(M[prev, 0])    # return to depot
        return drive + self._window_penalty * violation

    def _to_schedule(
        self,
        state: list[int],
        M: np.ndarray,
        orders: Sequence[Order],
        driver: Driver,
        shift_start_s: float,
    ) -> Schedule:
        stops: list[ScheduledStop] = []
        t = shift_start_s
        prev = 0
        total_drive = 0.0
        for order_idx in state:
            nxt = order_idx + 1
            drive = float(M[prev, nxt])
            total_drive += drive
            t += drive
            order = orders[order_idx]
            ws = _seconds_in_day(order.window.start)
            we = _seconds_in_day(order.window.end)
            arrival = t if t >= ws else float(ws)
            t = arrival
            violation = max(0.0, arrival - we)
            st = self._service_time_for(order)
            departure = arrival + st
            stops.append(ScheduledStop(
                order=order,
                arrival_seconds=arrival,
                departure_seconds=departure,
                drive_seconds_from_prev=drive,
                service_seconds=st,
                window_violation_seconds=violation,
            ))
            t = departure
            prev = nxt
        return_drive = float(M[prev, 0])
        total_drive += return_drive
        total_service = sum(s.service_seconds for s in stops)
        total_violation = sum(s.window_violation_seconds for s in stops)
        cost = total_drive + self._window_penalty * total_violation
        return Schedule(
            driver=driver,
            stops=stops,
            return_drive_seconds=return_drive,
            total_drive_seconds=total_drive,
            total_service_seconds=total_service,
            total_window_violation_seconds=total_violation,
            cost=cost,
        )

    # ----------------------------------------------------------- service time

    def _service_time_for(self, order: Order) -> float:
        return self._setup + self._handling * len(order.lines)


# ----------------------------------------------------------- module helpers


def _seconds_in_day(t: time) -> int:
    return t.hour * 3600 + t.minute * 60 + t.second


def _fmt_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600) % 24
    m = int((seconds % 3600) // 60)
    return f"{h:02d}:{m:02d}"


# ----------------------------------------------------------- smoke test


if __name__ == "__main__":
    from .catalog import Catalog
    from .clustering import Clusterer
    from .problem import DeliveryProblem

    backend = Path(__file__).resolve().parent.parent
    network = RoadNetwork.load(backend / "cities_graph.graphml")
    catalog = Catalog.load(backend / "data" / "products.json")
    problem = DeliveryProblem.from_json(backend / "data" / "sample_input.json")

    print("Clustering...")
    clusterer = Clusterer(network, catalog, alpha=1.0, beta=0.5, seed=0)
    assignment = clusterer.cluster(problem)

    print(f"Solving routes for {len(assignment.clusters)} clusters via SA...")
    solver = RouteSolver(network, sa_iterations=10000, seed=0)

    for cluster in assignment.clusters:
        sched = solver.solve(cluster)
        print()
        print("=" * 78)
        print(
            f"Driver {sched.driver.id}  truck {sched.driver.truck.id}  "
            f"shift {sched.driver.shift_start}-{sched.driver.shift_end}"
        )
        print(
            f"  cost = {sched.cost:.0f}s   "
            f"drive = {sched.total_drive_seconds / 60:.1f} min   "
            f"service = {sched.total_service_seconds / 60:.1f} min   "
            f"late = {sched.total_window_violation_seconds:.0f} s"
        )
        for i, s in enumerate(sched.stops, 1):
            ws = _fmt_time(_seconds_in_day(s.order.window.start))
            we = _fmt_time(_seconds_in_day(s.order.window.end))
            arr = _fmt_time(s.arrival_seconds)
            dep = _fmt_time(s.departure_seconds)
            tag = "" if s.window_violation_seconds == 0 else f"  LATE +{s.window_violation_seconds:.0f}s"
            print(
                f"  {i:2d}. {arr}->{dep}  window {ws}-{we}  "
                f"drive {s.drive_seconds_from_prev / 60:4.1f} min   "
                f"{s.order.customer.name}{tag}"
            )
        print(f"  return drive: {sched.return_drive_seconds / 60:.1f} min")
