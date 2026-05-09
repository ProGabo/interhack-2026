"""Build and persist a road graph covering Granollers and Mollet del Vallès.

Within each city we keep the full drivable network so deliveries can be routed
to any address. Between the cities we only keep major roads (motorway, trunk,
primary) since the truck just needs the fastest corridor from one to the other.
"""

from __future__ import annotations

import csv
from pathlib import Path

import matplotlib.pyplot as plt
import networkx as nx
import osmnx as ox
from shapely.ops import unary_union

GRANOLLERS = "Granollers, Catalunya, Spain"
MOLLET_DEL_VALLES = "Mollet del Vallès, Catalunya, Spain"

NETWORK_TYPE = "drive"

# Inter-city corridor: only fast roads. Includes link ramps so the corridor
# actually connects to the local networks at on/off-ramps.
MAJOR_ROAD_FILTER = (
    '["highway"~"motorway|trunk|primary|'
    'motorway_link|trunk_link|primary_link"]'
)

DEFAULT_GRAPH_PATH = Path(__file__).with_name("cities_graph.graphml")
DEFAULT_COORDS_PATH = Path(__file__).with_name("coords.csv")


def _city_graph(place: str) -> nx.MultiDiGraph:
    return ox.graph_from_place(place, network_type=NETWORK_TYPE)


def _corridor_graph(places: list[str]) -> nx.MultiDiGraph:
    """Major-roads-only graph spanning the bounding box of the given places."""
    boundaries = [ox.geocode_to_gdf(p).geometry.iloc[0] for p in places]
    minx, miny, maxx, maxy = unary_union(boundaries).bounds
    return ox.graph_from_bbox(
        bbox=(minx, miny, maxx, maxy),
        custom_filter=MAJOR_ROAD_FILTER,
        truncate_by_edge=True,
        retain_all=False,
    )


def build_combined_graph() -> nx.MultiDiGraph:
    """Return a single graph with both cities plus the minimal corridor between."""
    g_granollers = _city_graph(GRANOLLERS)
    g_mollet = _city_graph(MOLLET_DEL_VALLES)
    g_corridor = _corridor_graph([GRANOLLERS, MOLLET_DEL_VALLES])

    combined = nx.compose_all([g_granollers, g_mollet, g_corridor])
    # Preserve graph-level metadata (CRS) that compose_all drops.
    combined.graph.update(g_granollers.graph)

    # Drop disconnected fragments left over after composition.
    combined = ox.truncate.largest_component(combined, strongly=True)

    # Enrich edges with speed_kph + travel_time (seconds) so downstream
    # routing can use realistic times instead of raw distance.
    combined = ox.routing.add_edge_speeds(combined)
    combined = ox.routing.add_edge_travel_times(combined)
    return combined


def save_graph(graph: nx.MultiDiGraph, path: Path | str = DEFAULT_GRAPH_PATH) -> Path:
    path = Path(path)
    ox.save_graphml(graph, path)
    return path


def load_graph(path: Path | str = DEFAULT_GRAPH_PATH) -> nx.MultiDiGraph:
    return ox.load_graphml(Path(path))


def get_or_build_graph(path: Path | str = DEFAULT_GRAPH_PATH) -> nx.MultiDiGraph:
    path = Path(path)
    if path.exists():
        return load_graph(path)
    graph = build_combined_graph()
    save_graph(graph, path)
    return graph


def load_dropoff_coords(path: Path | str = DEFAULT_COORDS_PATH) -> list[tuple[float, float]]:
    """Read drop-off coordinates from a CSV with columns `id, x, y` (x=lng, y=lat)."""
    points: list[tuple[float, float]] = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            points.append((float(row["y"]), float(row["x"])))
    return points


def _edge_colors(graph: nx.MultiDiGraph) -> list[str]:
    keywords = ("motorway", "trunk", "primary")
    return [
        "#d62728" if any(k in str(data.get("highway", "")) for k in keywords) else "#888888"
        for _, _, data in graph.edges(data=True)
    ]


def plot_graph(graph: nx.MultiDiGraph) -> None:
    """Show the graph with city streets in grey and the inter-city corridor in red."""
    fig, ax = ox.plot_graph(
        graph,
        edge_color=_edge_colors(graph),
        edge_linewidth=0.7,
        node_size=2,
        node_color="#1f77b4",
        bgcolor="white",
        show=False,
        close=False,
    )
    ax.set_title(
        f"Granollers + Mollet del Vallès "
        f"({graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges)"
    )
    plt.show()


def plot_graph_with_dropoffs(
    graph: nx.MultiDiGraph,
    coords: list[tuple[float, float]],
    title: str | None = None,
) -> None:
    """Overlay drop-off coordinates on the road graph.

    `coords` is a list of (lat, lng) pairs (matches `load_dropoff_coords`).
    Axis limits expand to include any drop-offs that fall outside the graph
    extent so off-area points are still visible (they may indicate the graph
    needs to be rebuilt over a different region).
    """
    fig, ax = ox.plot_graph(
        graph,
        edge_color=_edge_colors(graph),
        edge_linewidth=0.7,
        node_size=2,
        node_color="#1f77b4",
        bgcolor="white",
        show=False,
        close=False,
    )
    lats = [c[0] for c in coords]
    lngs = [c[1] for c in coords]
    ax.scatter(
        lngs, lats,
        s=10, c="#2ca02c", alpha=0.7, zorder=5,
        edgecolors="white", linewidth=0.3,
        label=f"{len(coords)} drop-offs",
    )

    pad = 0.005
    node_lngs = [graph.nodes[n]["x"] for n in graph.nodes()]
    node_lats = [graph.nodes[n]["y"] for n in graph.nodes()]
    all_lngs = node_lngs + lngs
    all_lats = node_lats + lats
    ax.set_xlim(min(all_lngs) - pad, max(all_lngs) + pad)
    ax.set_ylim(min(all_lats) - pad, max(all_lats) + pad)
    ax.legend(loc="upper right", framealpha=0.9)
    ax.set_title(
        title
        or f"Graph + {len(coords)} drop-offs "
           f"({graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges)"
    )
    plt.show()


if __name__ == "__main__":
    g = build_combined_graph()
    print(f"Nodes: {g.number_of_nodes()}  Edges: {g.number_of_edges()}")
    out = save_graph(g)
    print(f"Saved to {out}")

    if DEFAULT_COORDS_PATH.exists():
        coords = load_dropoff_coords(DEFAULT_COORDS_PATH)
        print(f"Loaded {len(coords)} drop-off points from {DEFAULT_COORDS_PATH.name}")
        plot_graph_with_dropoffs(g, coords)
    else:
        plot_graph(g)
