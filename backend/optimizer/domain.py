"""Core domain types for the delivery-optimization problem.

These are pure data — no behavior beyond simple value-object helpers
(window overlap, etc.). The optimizer modules consume and produce these.
"""

from __future__ import annotations

from datetime import time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Coordinates(BaseModel):
    model_config = ConfigDict(frozen=True)

    lat: float = Field(..., ge=-90.0, le=90.0)
    lng: float = Field(..., ge=-180.0, le=180.0)


class TimeWindow(BaseModel):
    model_config = ConfigDict(frozen=True)

    start: time
    end: time

    def overlaps(self, other: "TimeWindow") -> bool:
        return self.start < other.end and other.start < self.end

    def contains(self, t: time) -> bool:
        return self.start <= t <= self.end

    def duration_seconds(self) -> int:
        s = self.start.hour * 3600 + self.start.minute * 60 + self.start.second
        e = self.end.hour * 3600 + self.end.minute * 60 + self.end.second
        return e - s


OrderDirection = Literal["delivery", "pickup"]


class OrderLine(BaseModel):
    """A request for some quantity of a product, in a single direction.

    `delivery` lines flow from the depot to the customer; `pickup` lines flow
    back to the depot (returnables: empty barrels, kegs, crates).
    """

    product_id: str
    quantity: int = Field(..., gt=0)
    direction: OrderDirection = "delivery"


class Customer(BaseModel):
    id: str
    name: str
    coords: Coordinates
    address: str | None = None


class Order(BaseModel):
    """All work required at a single customer visit on a single day."""

    id: str
    customer: Customer
    window: TimeWindow
    lines: list[OrderLine]
    priority: int = 0

    def lines_for(self, direction: OrderDirection) -> list[OrderLine]:
        return [ln for ln in self.lines if ln.direction == direction]


class Truck(BaseModel):
    """Physical truck with weight cap and a 2D pallet-slot grid.

    The grid models the van's interior as a `grid_length × grid_width` lattice
    of unit cells; each pallet occupies a connected set of cells. Lateral
    tarp access means the long sides of the grid are "exits" — extracting a
    pallet costs the shortest path in the grid to the nearest long edge.
    """

    id: str
    max_weight_kg: float = Field(..., gt=0)
    grid_length: int = Field(..., gt=0)
    grid_width: int = Field(..., gt=0)

    @property
    def grid_cells(self) -> int:
        return self.grid_length * self.grid_width


class Driver(BaseModel):
    id: str
    truck: Truck
    shift_start: time
    shift_end: time
    depot: Coordinates

    @property
    def shift_window(self) -> TimeWindow:
        return TimeWindow(start=self.shift_start, end=self.shift_end)
