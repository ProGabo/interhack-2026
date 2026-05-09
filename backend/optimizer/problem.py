"""The `DeliveryProblem` aggregate: one day's worth of optimization input.

A `DeliveryProblem` bundles the drivers, their trucks, and the orders that
must be served. It loads from a single JSON document (the input the API
receives) and validates internal consistency against the product catalog.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel

from .catalog import Catalog
from .domain import Coordinates, Driver, Order


class DeliveryProblem(BaseModel):
    """The full input for one day of route + load optimization."""

    drivers: list[Driver]
    orders: list[Order]

    @classmethod
    def from_json(cls, path: Path | str) -> "DeliveryProblem":
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return cls.model_validate(data)

    @classmethod
    def from_dict(cls, data: dict) -> "DeliveryProblem":
        return cls.model_validate(data)

    def referenced_product_ids(self) -> set[str]:
        return {ln.product_id for o in self.orders for ln in o.lines}

    def validate_against_catalog(self, catalog: Catalog) -> None:
        """Raise if any order line references a product not in the catalog."""
        unknown = self.referenced_product_ids() - catalog.ids
        if unknown:
            raise ValueError(
                f"Orders reference unknown products: {sorted(unknown)}"
            )

    def all_stop_coords(self) -> list[Coordinates]:
        """Coordinates of every customer stop, in `orders` order. No depots."""
        return [o.customer.coords for o in self.orders]

    def driver_count(self) -> int:
        return len(self.drivers)

    def order_count(self) -> int:
        return len(self.orders)
