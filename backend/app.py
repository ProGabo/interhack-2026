"""FastAPI server: OR-tools VRPSPD-TW behind a single POST endpoint.

    GET  /health           liveness probe
    GET  /sample-request   bundled example body, for the frontend's "load example"
    POST /optimize         body matches sample_request.json shape
    GET  /docs             auto Swagger UI
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from graph_manager import get_or_build_graph
from loader import build_travel_matrix, load
from solver import solve_vrp

SAMPLE = Path(__file__).with_name("sample_request.json")


# --- Request schema (mirrors sample_request.json) ----------------------

class Coords(BaseModel):
    lat: float
    lng: float


class TimeWindow(BaseModel):
    open: str
    close: str


class Line(BaseModel):
    product_id: str
    qty: int


class StopReq(BaseModel):
    id: str
    coords: Coords
    time_window: TimeWindow
    deliveries: list[Line]
    pickups: list[Line] = []


class DepotReq(BaseModel):
    id: str
    coords: Coords
    open: str
    close: str


class FleetReq(BaseModel):
    num_vans: int
    van_type: str
    vans_ref: str | None = None
    products_ref: str | None = None


class DriverReq(BaseModel):
    id: str
    shift_start: str
    shift_end: str


class OptimizeRequest(BaseModel):
    request_id: str | None = None
    date: str | None = None
    depot: DepotReq
    fleet: FleetReq
    drivers: list[DriverReq]
    stops: list[StopReq]


# --- Response schema ---------------------------------------------------

class StopOut(BaseModel):
    sequence: int
    id: str
    arrival_time: str
    coords: Coords


class VanOut(BaseModel):
    van_idx: int
    driver_id: str
    feasible: bool
    travel_time_min: float
    total_time_h: float
    peak_cells: int
    peak_kg: int
    stops: list[StopOut]


class OptimizeResponse(BaseModel):
    request_id: str | None
    fleet_drive_min: float
    fleet_total_h: float
    all_feasible: bool
    depot: DepotReq
    vans: list[VanOut]


# --- App ---------------------------------------------------------------

@asynccontextmanager
async def lifespan(_: FastAPI):
    get_or_build_graph()    # warm the OSM graph cache
    yield


app = FastAPI(title="Damm Smart Truck API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"],
    allow_methods=["GET", "POST"], allow_headers=["*"],
)


def _hm(s: int) -> str:
    h, m = divmod(int(s) // 60, 60)
    return f"{h:02d}:{m:02d}"


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/sample-request", response_model=OptimizeRequest)
def sample_request():
    if not SAMPLE.exists():
        raise HTTPException(404, "sample_request.json missing")
    return json.loads(SAMPLE.read_text(encoding="utf-8"))


@app.post("/optimize", response_model=OptimizeResponse)
def optimize(req: OptimizeRequest) -> OptimizeResponse:
    body = req.model_dump()
    try:
        depot, fleet, drivers, stops = load(body)
    except KeyError as e:
        raise HTTPException(422, f"unknown reference: {e}")
    if len(drivers) != fleet.num_vans:
        raise HTTPException(
            422, f"num_vans={fleet.num_vans} but {len(drivers)} drivers"
        )

    matrix = build_travel_matrix(depot, stops)
    plan = solve_vrp(depot, fleet, drivers, stops, matrix, time_limit_s=5)
    if not plan.vans:
        raise HTTPException(500, "OR-tools returned no solution within time limit")

    by_id = {s.id: s for s in stops}
    vans_out = [
        VanOut(
            van_idx=v.van_idx,
            driver_id=v.driver_id,
            feasible=v.feasible,
            travel_time_min=round(v.travel_s / 60, 2),
            total_time_h=round(v.total_s / 3600, 3),
            peak_cells=v.peak_cells,
            peak_kg=v.peak_kg,
            stops=[
                StopOut(
                    sequence=p.sequence, id=p.id,
                    arrival_time=_hm(p.arrival_s),
                    coords=Coords(lat=by_id[p.id].lat, lng=by_id[p.id].lng),
                )
                for p in v.stops
            ],
        )
        for v in plan.vans
    ]

    return OptimizeResponse(
        request_id=req.request_id,
        fleet_drive_min=round(plan.drive_s / 60, 2),
        fleet_total_h=round(plan.total_s / 3600, 3),
        all_feasible=plan.all_feasible,
        depot=req.depot,
        vans=vans_out,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=False)
