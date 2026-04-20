from .admin import build_admin_router
from .assets import build_assets_router
from .catalog import build_catalog_router
from .classification import build_classification_router
from .discovery import build_discovery_router
from .export import build_export_router
from .governance import build_governance_router
from .insights import build_insights_router
from .lineage import build_lineage_router
from .runtime import build_runtime_router

__all__ = [
    "build_admin_router",
    "build_assets_router",
    "build_catalog_router",
    "build_classification_router",
    "build_discovery_router",
    "build_export_router",
    "build_governance_router",
    "build_insights_router",
    "build_lineage_router",
    "build_runtime_router",
]
