"""FastAPI server exposing the Damm Smart Truck pipeline.

Endpoints:
    GET  /health           liveness probe
    GET  /sample-request   the bundled sample_request.json (for the frontend
                           to populate its form / show what the schema is)
    POST /optimize         run k-means + rebalance + SA on a request body,
                           return per-van plans

The OSM road graph is loaded once at startup; per-request work is then
~ms (k-means + SA on 12 stops finishes in well under a second).
"""

from __future__ import annotations

import json
import math
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from clustering import (
    Depot, Fleet, Stop,
    _cluster_with_weights, _matrix_for_problem,
    load_problem_from_dict,
    W_GEO, W_TMID, W_TWIDTH,
)
from graph_manager import get_or_build_graph
from route_sa import sa_optimize_clusters

SAMPLE_REQUEST_PATH = Path(__file__).with_name("sample_request.json")


# ---------- Request schema (mirrors data/sample_request.json) -------------

class Coords(BaseModel):
    lat: float
    lng: float


class TimeWindow(BaseModel):
    open: str = Field(..., description="HH:MM")
    close: str


class DeliveryLine(BaseModel):
    product_id: str
    qty: int


class StopRequest(BaseModel):
    id: str
    coords: Coords
    time_window: TimeWindow
    deliveries: list[DeliveryLine]
    pickups: list[DeliveryLine] = []


class DepotRequest(BaseModel):
    id: str
    coords: Coords
    open: str
    close: str


class FleetRequest(BaseModel):
    num_vans: int
    van_type: str
    vans_ref: str | None = None
    products_ref: str | None = None


class DriverRequest(BaseModel):
    id: str
    shift_start: str
    shift_end: str


class OptimizeRequest(BaseModel):
    request_id: str | None = None
    date: str | None = None
    depot: DepotRequest
    fleet: FleetRequest
    drivers: list[DriverRequest]
    stops: list[StopRequest]


# ---------- Response schema ----------------------------------------------

class StopPlan(BaseModel):
    sequence: int
    id: str
    arrival_time: str
    coords: Coords
    service_time_min: float
    delivery_cells: int
    delivery_kg: float
    pickup_cells: int
    pickup_kg: float


class LoadingWave(BaseModel):
    wave: int
    zone: str
    stop_ids: list[str]
    stop_sequences: list[int]
    delivery_cells: int
    pickup_cells: int
    picking_efficiency_score: float
    rationale: str


class VanPlan(BaseModel):
    van_idx: int
    driver_id: str
    feasible: bool
    violations: list[str]
    travel_time_min: float
    total_time_h: float
    peak_cells: int
    peak_kg: float
    lateral_access_penalty: float
    blocked_early_stop_count: int
    accessibility_score: float
    loading_waves: list[LoadingWave]
    loading_manifest_markdown: str
    loading_manifest_rows: list[dict[str, Any]]
    truck_status_timeline: list[dict[str, Any]]
    why_route: list[str]
    stops: list[StopPlan]


class OptimizeResponse(BaseModel):
    request_id: str | None
    fleet_total_drive_min: float
    fleet_total_time_h: float
    all_feasible: bool
    depot: DepotRequest
    vans: list[VanPlan]


# ---------- App lifecycle ------------------------------------------------

@asynccontextmanager
async def lifespan(_: FastAPI):
    # Pre-warm the OSM graph; first call builds and caches to graphml.
    get_or_build_graph()
    yield


app = FastAPI(
    title="Damm Smart Truck API",
    version="0.1.0",
    description="Joint route + load optimization for DDI-style delivery rounds.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # tighten to the frontend origin in prod
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ---------- Helpers ------------------------------------------------------

def _seconds_to_hm(s: float) -> str:
    h, m = divmod(int(s) // 60, 60)
    return f"{h:02d}:{m:02d}"


def _build_stop_plan(
    sequence: int,
    sid: str,
    arrival_s: float,
    stops_by_id: dict[str, Stop],
) -> StopPlan:
    s = stops_by_id[sid]
    return StopPlan(
        sequence=sequence,
        id=sid,
        arrival_time=_seconds_to_hm(arrival_s),
        coords=Coords(lat=s.lat, lng=s.lng),
        service_time_min=round(s.service_time_s / 60, 2),
        delivery_cells=s.delivery_cells,
        delivery_kg=round(s.delivery_kg, 2),
        pickup_cells=s.pickup_cells,
        pickup_kg=round(s.pickup_kg, 2),
    )


def _build_truck_grid_assignments(stop_plans: list[StopPlan]) -> tuple[list[dict[str, Any]], int]:
    """
    Deterministic 2D top-down assignment with side-curtain priority.
    Col 0 and col N-1 are laterally accessible lanes.
    """
    lane_count = 4
    lane_pattern = [0, lane_count - 1, 1, lane_count - 2]
    assignments: list[dict[str, Any]] = []
    for idx, stop in enumerate(stop_plans):
        col = lane_pattern[idx % len(lane_pattern)]
        row = idx // lane_count
        is_edge = col in (0, lane_count - 1)
        assignments.append({
            "stop_id": stop.id,
            "sequence": stop.sequence,
            "row": row,
            "col": col,
            "is_edge": is_edge,
            "delivery_cells": int(stop.delivery_cells),
            "pickup_cells": int(stop.pickup_cells),
        })
    return assignments, lane_count


def _compute_lateral_metrics(assignments: list[dict[str, Any]], lane_count: int) -> tuple[float, int]:
    penalty = 0.0
    blocked_early = 0
    for idx, slot in enumerate(assignments):
        if slot["is_edge"]:
            continue
        remaining_later_stops = max(0, len(assignments) - idx - 1)
        if remaining_later_stops > 0:
            blocked_early += 1
            penalty += 9.0 + 1.25 * remaining_later_stops
        # Inner lanes are slower to unload even when not blocked.
        inner_distance = min(slot["col"], (lane_count - 1) - slot["col"])
        penalty += 3.0 + 1.4 * inner_distance
        # Returns loaded in inner lanes are harder for reverse logistics.
        if slot["pickup_cells"] > slot["delivery_cells"] and slot["pickup_cells"] > 0:
            penalty += 4.5
    return round(penalty, 2), blocked_early


def _build_loading_waves(
    stop_plans: list[StopPlan],
    assignments: list[dict[str, Any]],
) -> tuple[list[LoadingWave], list[dict[str, Any]], str]:
    if not stop_plans:
        return [], [], ""

    by_id = {s.id: s for s in stop_plans}
    edge_by_id = {a["stop_id"]: a["is_edge"] for a in assignments}
    load_order = list(reversed(stop_plans))  # Back-first loading = last delivery first.
    chunk_size = max(1, math.ceil(len(load_order) / 3))
    zone_labels = ["Back", "Middle", "Front"]
    waves: list[LoadingWave] = []
    markdown_rows: list[dict[str, Any]] = []

    for wave_idx in range(3):
        chunk = load_order[wave_idx * chunk_size:(wave_idx + 1) * chunk_size]
        if not chunk:
            continue
        stop_ids = [s.id for s in chunk]
        stop_sequences = [int(s.sequence) for s in chunk]
        delivery_cells = sum(int(s.delivery_cells) for s in chunk)
        pickup_cells = sum(int(s.pickup_cells) for s in chunk)
        edge_stops = sum(1 for sid in stop_ids if edge_by_id.get(sid, False))

        driver_minutes_saved = (delivery_cells * 0.12) + (pickup_cells * 0.08) + (edge_stops * 1.5)
        warehouse_walk_cost = (len(chunk) * 0.9) + (delivery_cells * 0.04)
        score = max(10.0, min(99.0, 50.0 + (driver_minutes_saved - warehouse_walk_cost) * 6.0))

        rationale = (
            f"{zone_labels[wave_idx]} wave groups {len(chunk)} stops; "
            f"edge-priority placements reduce curtain-side rehandles while keeping picking walks bounded."
        )
        wave = LoadingWave(
            wave=wave_idx + 1,
            zone=zone_labels[wave_idx],
            stop_ids=stop_ids,
            stop_sequences=stop_sequences,
            delivery_cells=delivery_cells,
            pickup_cells=pickup_cells,
            picking_efficiency_score=round(score, 1),
            rationale=rationale,
        )
        waves.append(wave)
        markdown_rows.append({
            "wave": wave.wave,
            "zone": wave.zone,
            "stops": ", ".join(wave.stop_ids),
            "stop_sequences": ", ".join(str(seq) for seq in wave.stop_sequences),
            "delivery_cells": wave.delivery_cells,
            "pickup_cells": wave.pickup_cells,
            "picking_efficiency_score": wave.picking_efficiency_score,
            "rationale": wave.rationale,
        })

    table_lines = [
        "| Wave | Zone | Stops | Sequences | Delivery Cells | Pickup Cells | Picking Efficiency | Rationale |",
        "|---|---|---|---|---:|---:|---:|---|",
    ]
    for row in markdown_rows:
        table_lines.append(
            f"| {row['wave']} | {row['zone']} | {row['stops']} | {row['stop_sequences']} | "
            f"{row['delivery_cells']} | {row['pickup_cells']} | {row['picking_efficiency_score']} | {row['rationale']} |"
        )
    return waves, markdown_rows, "\n".join(table_lines)


def _build_truck_timeline(assignments: list[dict[str, Any]], lane_count: int) -> list[dict[str, Any]]:
    if not assignments:
        return []
    max_row = max(item["row"] for item in assignments)
    total_stops = len(assignments)
    timeline: list[dict[str, Any]] = []
    for progress_stop in range(0, total_stops + 1):
        cells = []
        for slot in assignments:
            seq = slot["sequence"]
            delivered = progress_stop >= seq
            has_pickup = slot["pickup_cells"] > 0
            status = "delivery_full"
            if delivered and has_pickup:
                status = "return_full"
            elif delivered:
                status = "empty"
            red_zone = status == "return_full" and not slot["is_edge"]
            cells.append({
                "stop_id": slot["stop_id"],
                "sequence": seq,
                "row": slot["row"],
                "col": slot["col"],
                "status": status,
                "red_zone": red_zone,
                "is_accessible": slot["col"] in (0, lane_count - 1),
                "delivery_cells": slot["delivery_cells"],
                "pickup_cells": slot["pickup_cells"],
            })
        timeline.append({
            "progress_stop": progress_stop,
            "rows": max_row + 1,
            "cols": lane_count,
            "cells": cells,
        })
    return timeline


# ---------- Endpoints ----------------------------------------------------

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/sample-request", response_model=OptimizeRequest)
def sample_request() -> Any:
    if not SAMPLE_REQUEST_PATH.exists():
        raise HTTPException(404, "no bundled sample_request.json")
    return json.loads(SAMPLE_REQUEST_PATH.read_text(encoding="utf-8"))


@app.post("/optimize", response_model=OptimizeResponse)
def optimize(req: OptimizeRequest) -> OptimizeResponse:
    try:
        depot, fleet, drivers, stops = load_problem_from_dict(req.model_dump())
    except KeyError as e:
        raise HTTPException(422, f"unknown reference: {e}")
    if len(drivers) != fleet.num_vans:
        raise HTTPException(
            422,
            f"fleet.num_vans={fleet.num_vans} but {len(drivers)} drivers provided",
        )
    stops_by_id = {s.id: s for s in stops}
    matrix = _matrix_for_problem(depot, stops, use_disk_cache=False)

    clusters = _cluster_with_weights(
        stops, depot, fleet, drivers, stops_by_id, matrix,
        W_GEO, W_TMID, W_TWIDTH,
    )
    optimized = sa_optimize_clusters(
        clusters, depot, fleet, drivers, stops_by_id, matrix,
    )

    vans: list[VanPlan] = []
    fleet_drive_s = 0.0
    fleet_total_s = 0.0
    all_feasible = True
    for cluster, route in optimized:
        fleet_drive_s += route.travel_time_s
        fleet_total_s += route.total_time_s
        if not route.feasible:
            all_feasible = False
        stop_plans = [
            _build_stop_plan(k, sid, route.arrival_times_s[k - 1], stops_by_id)
            for k, sid in enumerate(route.stops, start=1)
        ]
        assignments, lane_count = _build_truck_grid_assignments(stop_plans)
        lateral_penalty, blocked_early = _compute_lateral_metrics(assignments, lane_count)
        accessibility_score = max(0.0, round(100.0 - min(95.0, lateral_penalty * 2.2), 1))
        waves, markdown_rows, markdown_table = _build_loading_waves(stop_plans, assignments)
        truck_timeline = _build_truck_timeline(assignments, lane_count)
        why_route = [
            (
                f"Route keeps early stops close to side-curtain lanes; estimated lateral-access penalty "
                f"is {lateral_penalty} with {blocked_early} potentially buried early stops."
            ),
            (
                f"Reverse logistics is reserved across the route: peak load reaches "
                f"{int(cluster.peak_cells)} cells and {round(cluster.peak_kg, 2)} kg."
            ),
            (
                f"Trade-off summary: {round(route.travel_time_s / 60, 2)} driving minutes with "
                f"accessibility score {accessibility_score}% to reduce manual pallet shifting."
            ),
        ]
        vans.append(VanPlan(
            van_idx=cluster.van_idx,
            driver_id=drivers[cluster.van_idx].id,
            feasible=route.feasible,
            violations=cluster.violations,
            travel_time_min=round(route.travel_time_s / 60, 2),
            total_time_h=round(route.total_time_s / 3600, 3),
            peak_cells=int(cluster.peak_cells),
            peak_kg=round(cluster.peak_kg, 2),
            lateral_access_penalty=lateral_penalty,
            blocked_early_stop_count=blocked_early,
            accessibility_score=accessibility_score,
            loading_waves=waves,
            loading_manifest_markdown=markdown_table,
            loading_manifest_rows=markdown_rows,
            truck_status_timeline=truck_timeline,
            why_route=why_route,
            stops=stop_plans,
        ))

    return OptimizeResponse(
        request_id=req.request_id,
        fleet_total_drive_min=round(fleet_drive_s / 60, 2),
        fleet_total_time_h=round(fleet_total_s / 3600, 3),
        all_feasible=all_feasible,
        depot=req.depot,
        vans=vans,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=False)
