"""Product catalog: shapes, weights, and returnability of every SKU we ship.

Loaded once from a JSON file at startup; passed by reference to anything that
needs to know the physical footprint of an order (loading planner, capacity
checker, weight summers).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterator

from pydantic import BaseModel, Field


class Product(BaseModel):
    """A SKU with its physical footprint in the truck grid.

    `length_cells × width_cells × height_cells` is the bounding-box size of
    the product expressed in van-grid unit cubes (see `VanModel`). Phase 1
    capacity uses `cell_count` (2D footprint) for a quick floor-area check;
    Phase 2 loading uses `cell_volume` (3D) to size pallet slots.
    """

    id: str
    name: str
    length_cells: int = Field(..., gt=0)
    width_cells: int = Field(..., gt=0)
    height_cells: int = Field(1, gt=0)
    weight_kg: float = Field(..., gt=0)
    is_returnable: bool = False

    @property
    def cell_count(self) -> int:
        """2D floor footprint in unit cells."""
        return self.length_cells * self.width_cells

    @property
    def cell_volume(self) -> int:
        """3D bounding-box volume in unit cubes."""
        return self.length_cells * self.width_cells * self.height_cells


class Catalog:
    """Immutable, lookup-by-id collection of products.

    Use `Catalog.load(path)` to read from disk; treat instances as read-only
    once constructed. Indexing (`catalog["barrel_50l"]`) raises KeyError on
    miss; `.get` returns None for the soft path.
    """

    def __init__(self, products: list[Product]):
        if len({p.id for p in products}) != len(products):
            raise ValueError("Duplicate product id in catalog")
        self._by_id: dict[str, Product] = {p.id: p for p in products}

    @classmethod
    def load(cls, path: Path | str) -> "Catalog":
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        products = [Product.model_validate(item) for item in raw["products"]]
        return cls(products)

    def __getitem__(self, product_id: str) -> Product:
        return self._by_id[product_id]

    def get(self, product_id: str) -> Product | None:
        return self._by_id.get(product_id)

    def __contains__(self, product_id: object) -> bool:
        return product_id in self._by_id

    def __iter__(self) -> Iterator[Product]:
        return iter(self._by_id.values())

    def __len__(self) -> int:
        return len(self._by_id)

    @property
    def ids(self) -> set[str]:
        return set(self._by_id.keys())
