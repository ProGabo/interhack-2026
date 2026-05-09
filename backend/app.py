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


class VanPlan(BaseModel):
    van_idx: int
    driver_id: str
    feasible: bool
    violations: list[str]
    travel_time_min: float
    total_time_h: float
    peak_cells: int
    peak_kg: float
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
        vans.append(VanPlan(
            van_idx=cluster.van_idx,
            driver_id=drivers[cluster.van_idx].id,
            feasible=route.feasible,
            violations=cluster.violations,
            travel_time_min=round(route.travel_time_s / 60, 2),
            total_time_h=round(route.total_time_s / 3600, 3),
            peak_cells=int(cluster.peak_cells),
            peak_kg=round(cluster.peak_kg, 2),
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
