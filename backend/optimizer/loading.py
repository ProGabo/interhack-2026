"""Van interior as a 3D cube grid with canonical pallet slots.

This module defines the *structure* — nothing more. Public surface:

    Cube       — type alias for an (x, y, z) cube coordinate
    Slot       — value object: pallet anchor + the cubes it occupies
    VanModel   — the 3D grid + slots + tarp accessibility

`VanModel` exposes the geometry, the slot layout, the tarp walls, and the
adjacency of cubes (`cube_neighbors`). It does not place pallets, plan a
loading order, or score service time — those operations belong to a
downstream solver that will consume this structure.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import networkx as nx


# Cube coordinates inside the van: (x, y, z).
# x runs along the truck length (front -> back),
# y runs across the width  (left tarp -> right tarp),
# z runs upward             (floor -> ceiling).
Cube = tuple[int, int, int]


@dataclass(frozen=True)
class Slot:
    """A canonical pallet anchor — corner cube + the cubes it occupies."""

    id: int
    anchor: Cube
    cubes: frozenset[Cube]


class VanModel:
    """Van cargo bay as a 3D cube lattice with canonical pallet slots.

    Construct from explicit cube counts or `from_spec_file(path)` to read a
    `key = value` text file (see `data/van_spec.txt`). After construction:

      * `slots` / `slot(id)` enumerate the pallet anchors,
      * `tarp_cubes(side)` returns the cubes on each tarp wall,
      * `iter_cubes()` / `cube_neighbors(cube)` expose the underlying grid
        graph (face-adjacent 6-connectivity, walls clipped to bounds),
      * `to_networkx()` returns the cube lattice as a NetworkX graph for
        any external traversal or visualisation.

    The model is immutable after construction.
    """

    def __init__(
        self,
        length_cubes: int,
        width_cubes: int,
        height_cubes: int,
        pallet_dims: tuple[int, int, int],
        cube_size_m: float = 0.5,
        tarp_sides: frozenset[str] = frozenset({"left", "right"}),
    ):
        if length_cubes <= 0 or width_cubes <= 0 or height_cubes <= 0:
            raise ValueError("Cube dimensions must be positive")
        pl, pw, ph = pallet_dims
        if pl <= 0 or pw <= 0 or ph <= 0:
            raise ValueError("Pallet dimensions must be positive")
        if length_cubes % pl != 0 or width_cubes % pw != 0:
            raise ValueError(
                f"Van floor {length_cubes}x{width_cubes} doesn't tile cleanly "
                f"with pallet footprint {pl}x{pw}"
            )
        if ph > height_cubes:
            raise ValueError(
                f"Pallet height {ph} exceeds van height {height_cubes}"
            )
        for s in tarp_sides:
            if s not in ("left", "right"):
                raise ValueError(f"Unknown tarp side: {s!r}")

        self._L = length_cubes
        self._W = width_cubes
        self._H = height_cubes
        self._pallet_dims = pallet_dims
        self._cube_m = cube_size_m
        self._tarp_sides = frozenset(tarp_sides)
        self._slots: list[Slot] = self._compute_slots()
        self._tarp_cubes_by_side: dict[str, frozenset[Cube]] = self._compute_tarp_cubes()

    # -------------------------------------------------------- construction

    @classmethod
    def from_spec_file(cls, path: Path | str) -> "VanModel":
        spec = _parse_kv_file(Path(path).read_text(encoding="utf-8"))

        def m_to_cubes(meters_key: str, cube_m: float) -> int:
            return int(round(float(spec[meters_key]) / cube_m))

        cube = float(spec["cube_size_m"])
        L = m_to_cubes("length_m", cube)
        W = m_to_cubes("width_m", cube)
        H = m_to_cubes("height_m", cube)
        pl = m_to_cubes("pallet_length_m", cube)
        pw = m_to_cubes("pallet_width_m", cube)
        ph = m_to_cubes("pallet_height_m", cube)
        sides_raw = spec.get("tarp_open_sides", "left,right")
        sides = frozenset(s.strip() for s in sides_raw.split(",") if s.strip())
        return cls(L, W, H, (pl, pw, ph), cube_size_m=cube, tarp_sides=sides)

    # ----------------------------------------------------------- properties

    @property
    def cube_size_m(self) -> float:
        return self._cube_m

    @property
    def length_cubes(self) -> int:
        return self._L

    @property
    def width_cubes(self) -> int:
        return self._W

    @property
    def height_cubes(self) -> int:
        return self._H

    @property
    def pallet_dims(self) -> tuple[int, int, int]:
        return self._pallet_dims

    @property
    def cubes_per_slot(self) -> int:
        pl, pw, ph = self._pallet_dims
        return pl * pw * ph

    @property
    def slots(self) -> list[Slot]:
        return list(self._slots)

    @property
    def slot_count(self) -> int:
        return len(self._slots)

    @property
    def tarp_sides(self) -> frozenset[str]:
        return self._tarp_sides

    def slot(self, slot_id: int) -> Slot:
        return self._slots[slot_id]

    def tarp_cubes(self, side: str | None = None) -> frozenset[Cube]:
        """Cubes belonging to the open tarp wall(s).

        `side=None` returns the union of all open walls; `'left'` or
        `'right'` restricts to one. Cubes are returned as a frozenset.
        """
        if side is None:
            if not self._tarp_cubes_by_side:
                return frozenset()
            return frozenset.union(*self._tarp_cubes_by_side.values())
        return self._tarp_cubes_by_side.get(side, frozenset())

    # -------------------------------------------------------------- grid graph

    def iter_cubes(self) -> Iterable[Cube]:
        for x in range(self._L):
            for y in range(self._W):
                for z in range(self._H):
                    yield (x, y, z)

    def cube_neighbors(self, cube: Cube) -> Iterable[Cube]:
        """Face-adjacent cubes (6-connectivity), clipped to the van bounds."""
        x, y, z = cube
        deltas = ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))
        for dx, dy, dz in deltas:
            nx_, ny_, nz_ = x + dx, y + dy, z + dz
            if 0 <= nx_ < self._L and 0 <= ny_ < self._W and 0 <= nz_ < self._H:
                yield (nx_, ny_, nz_)

    def to_networkx(self) -> nx.Graph:
        """Return the cube lattice as a NetworkX graph (nodes = Cubes, edges = adjacency)."""
        g = nx.Graph()
        for cube in self.iter_cubes():
            g.add_node(cube)
        for cube in self.iter_cubes():
            for n in self.cube_neighbors(cube):
                # Each undirected edge added once (smaller endpoint first).
                if cube < n:
                    g.add_edge(cube, n)
        return g

    # -------------------------------------------------------------- internals

    def _compute_slots(self) -> list[Slot]:
        pl, pw, ph = self._pallet_dims
        slots: list[Slot] = []
        sid = 0
        for ly in range(0, self._W, pw):
            for lx in range(0, self._L, pl):
                cubes = frozenset(
                    (lx + dx, ly + dy, dz)
                    for dx in range(pl)
                    for dy in range(pw)
                    for dz in range(ph)
                )
                slots.append(Slot(id=sid, anchor=(lx, ly, 0), cubes=cubes))
                sid += 1
        return slots

    def _compute_tarp_cubes(self) -> dict[str, frozenset[Cube]]:
        out: dict[str, frozenset[Cube]] = {}
        if "left" in self._tarp_sides:
            out["left"] = frozenset(
                (x, 0, z) for x in range(self._L) for z in range(self._H)
            )
        if "right" in self._tarp_sides:
            out["right"] = frozenset(
                (x, self._W - 1, z) for x in range(self._L) for z in range(self._H)
            )
        return out


# -------------------------------------------------------------- spec parsing


def _parse_kv_file(text: str) -> dict[str, str]:
    """Parse a tolerant `key = value  # comment` text file."""
    out: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip().lower()] = v.strip()
    return out


# ----------------------------------------------------------- smoke test


if __name__ == "__main__":
    backend = Path(__file__).resolve().parent.parent
    van = VanModel.from_spec_file(backend / "data" / "van_spec.txt")
    print(
        f"Van: {van.length_cubes}x{van.width_cubes}x{van.height_cubes} cubes "
        f"@ {van.cube_size_m} m  |  {van.slot_count} slots "
        f"({van.cubes_per_slot} cubes each)  |  tarps: {sorted(van.tarp_sides)}"
    )
    for s in van.slots:
        print(f"  slot {s.id} anchor {s.anchor}  ({len(s.cubes)} cubes)")
    g = van.to_networkx()
    print(f"\nCube lattice: {g.number_of_nodes()} nodes, {g.number_of_edges()} edges")
    print(f"Tarp cubes: left={len(van.tarp_cubes('left'))}, "
          f"right={len(van.tarp_cubes('right'))}")
