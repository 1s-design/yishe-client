"""
PSD 运行时分析服务
基于 Photoshop 运行时文档对象补采更接近真实的画板与智能对象几何信息。
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
import time

try:
    from .psd_analysis_service import analyze_psd
    from ..utils.photoshop_process import create_photoshop_session
    from ..layer_finder import find_artboard_layers, find_smart_object_layers
except ImportError:
    from src.services.psd_analysis_service import analyze_psd
    from src.utils.photoshop_process import create_photoshop_session
    from src.layer_finder import find_artboard_layers, find_smart_object_layers


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(value)
    except Exception:
        return default


def _normalize_bounds(bounds: Any) -> Optional[List[int]]:
    if not bounds:
        return None

    try:
        if isinstance(bounds, (list, tuple)) and len(bounds) >= 4:
            return [_safe_int(bounds[0]), _safe_int(bounds[1]), _safe_int(bounds[2]), _safe_int(bounds[3])]

        if hasattr(bounds, "left") and hasattr(bounds, "top") and hasattr(bounds, "right") and hasattr(bounds, "bottom"):
            return [
                _safe_int(bounds.left),
                _safe_int(bounds.top),
                _safe_int(bounds.right),
                _safe_int(bounds.bottom),
            ]
    except Exception:
        return None

    return None


def _extract_runtime_geometry(layer: Any) -> Dict[str, Any]:
    bounds = None

    try:
        if hasattr(layer, "bounds"):
            bounds = _normalize_bounds(layer.bounds)
    except Exception:
        bounds = None

    if not bounds:
        left = _safe_int(getattr(layer, "left", None), 0)
        top = _safe_int(getattr(layer, "top", None), 0)
        right = _safe_int(getattr(layer, "right", None), left)
        bottom = _safe_int(getattr(layer, "bottom", None), top)
        bounds = [left, top, right, bottom]

    left, top, right, bottom = bounds
    width = max(0, right - left)
    height = max(0, bottom - top)

    return {
        "position": {
            "x": left,
            "y": top,
            "left": left,
            "top": top,
            "right": right,
            "bottom": bottom,
        },
        "size": {
            "width": width,
            "height": height,
            "aspect_ratio": round(width / height, 4) if height > 0 else 0,
        },
        "bounds": {
            "x1": left,
            "y1": top,
            "x2": right,
            "y2": bottom,
        },
    }


def _extract_smart_object_document_size(session: Any, doc: Any, layer: Any) -> Optional[Dict[str, int]]:
    try:
        from photoshop.api import ActionDescriptor, ActionReference
        from photoshop.api.enumerations import DialogModes
    except Exception:
        return None

    previous_active_document = None
    try:
        previous_active_document = session.active_document
    except Exception:
        previous_active_document = None

    try:
        doc.activeLayer = layer
        string_id = session.app.stringIDToTypeID
        edit_contents_id = string_id("placedLayerEditContents")
        placed_layer_id = string_id("placedLayer")
        ordinal_id = string_id("ordinal")
        target_enum_id = string_id("targetEnum")

        ref = ActionReference()
        ref.putEnumerated(placed_layer_id, ordinal_id, target_enum_id)

        desc = ActionDescriptor()
        desc.putReference(string_id("null"), ref)
        session.app.executeAction(edit_contents_id, desc, DialogModes.DisplayNoDialogs)
        time.sleep(0.2)

        smart_doc = session.active_document
        width = _safe_int(getattr(smart_doc, "width", None), 0)
        height = _safe_int(getattr(smart_doc, "height", None), 0)
        if width > 0 and height > 0:
            return {"width": width, "height": height}
        return None
    except Exception:
        return None
    finally:
        try:
            current_doc = session.active_document
            if current_doc is not None and current_doc != doc:
                try:
                    current_doc.close(2)
                except Exception:
                    try:
                        current_doc.close()
                    except Exception:
                        pass
        except Exception:
            pass

        try:
            if previous_active_document is not None and previous_active_document != doc:
                previous_active_document = None
        except Exception:
            pass

        try:
            doc.activate()
        except Exception:
            try:
                doc.activeLayer = layer
            except Exception:
                pass


def _build_runtime_smart_objects(session: Any, doc: Any) -> List[Dict[str, Any]]:
    smart_objects = find_smart_object_layers(doc, None, debug=False)
    result: List[Dict[str, Any]] = []

    for item in smart_objects:
        layer = item.get("layer")
        geometry = _extract_runtime_geometry(layer) if layer is not None else {
            "position": {
                "x": 0,
                "y": 0,
                "left": 0,
                "top": 0,
                "right": 0,
                "bottom": 0,
            },
            "size": {
                "width": _safe_int(item.get("width"), 0),
                "height": _safe_int(item.get("height"), 0),
                "aspect_ratio": 0,
            },
            "bounds": None,
        }

        if geometry["size"]["width"] <= 0 or geometry["size"]["height"] <= 0:
            fallback_width = _safe_int(item.get("width"), 0)
            fallback_height = _safe_int(item.get("height"), 0)
            if fallback_width > 0 and fallback_height > 0:
                geometry["size"] = {
                    "width": fallback_width,
                    "height": fallback_height,
                    "aspect_ratio": round(fallback_width / fallback_height, 4) if fallback_height > 0 else 0,
                }

        smart_doc_size = None
        if layer is not None and (geometry["size"]["width"] <= 0 or geometry["size"]["height"] <= 0):
            smart_doc_size = _extract_smart_object_document_size(session, doc, layer)
            if smart_doc_size:
                doc_width = smart_doc_size["width"]
                doc_height = smart_doc_size["height"]
                geometry["size"] = {
                    "width": doc_width,
                    "height": doc_height,
                    "aspect_ratio": round(doc_width / doc_height, 4) if doc_height > 0 else 0,
                }

        result.append({
            "name": item.get("name", "未知"),
            "path": item.get("path", ""),
            "visible": bool(getattr(layer, "visible", True)) if layer is not None else True,
            "opacity": 1.0,
            "blend_mode": str(getattr(layer, "blendMode", None) or getattr(layer, "blend_mode", None) or "normal"),
            "position": geometry["position"],
            "size": geometry["size"],
            "bounds": geometry["bounds"],
            "smart_object": {
                "kind": "runtime",
                "embedded_document": smart_doc_size,
            },
            "transform": None,
            "has_effects": False,
            "effects": [],
            "has_mask": False,
            "mask": None,
        })

    return result


def _runtime_artboard_map(doc: Any, psd_path: Path) -> Dict[str, Dict[str, Any]]:
    artboards = find_artboard_layers(doc, psd_path=psd_path, debug=False)
    artboard_map: Dict[str, Dict[str, Any]] = {}

    for item in artboards:
        layer = item.get("layer")
        geometry = _extract_runtime_geometry(layer) if layer is not None else {
            "position": {
                "x": 0,
                "y": 0,
                "left": 0,
                "top": 0,
                "right": 0,
                "bottom": 0,
            },
            "size": {
                "width": 0,
                "height": 0,
                "aspect_ratio": 0,
            },
            "bounds": None,
        }

        artboard_map[item.get("path") or item.get("name") or ""] = {
            "name": item.get("name", "未知画板"),
            "path": item.get("path", ""),
            "visible": bool(getattr(layer, "visible", True)) if layer is not None else True,
            "position": geometry["position"],
            "size": geometry["size"],
        }

    return artboard_map


def _merge_artboards(static_artboards: List[Dict[str, Any]], runtime_artboards: Dict[str, Dict[str, Any]], runtime_smart_objects: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    smart_object_map = {item.get("path", ""): item for item in runtime_smart_objects}
    merged: List[Dict[str, Any]] = []

    for artboard in static_artboards:
        path = artboard.get("path", "")
        runtime_artboard = runtime_artboards.get(path) or runtime_artboards.get(artboard.get("name", ""))
        base_artboard = {**artboard}

        if runtime_artboard:
            base_artboard["visible"] = runtime_artboard.get("visible", artboard.get("visible", True))
            base_artboard["position"] = runtime_artboard.get("position", artboard.get("position", {}))
            base_artboard["size"] = runtime_artboard.get("size", artboard.get("size", {}))

        artboard_position = base_artboard.get("position", {}) or {}
        artboard_left = _safe_int(artboard_position.get("left", artboard_position.get("x", 0)), 0)
        artboard_top = _safe_int(artboard_position.get("top", artboard_position.get("y", 0)), 0)

        merged_smart_objects: List[Dict[str, Any]] = []
        for smart_object in artboard.get("smart_objects", []) or []:
            runtime_smart_object = smart_object_map.get(smart_object.get("path", ""))
            merged_smart_object = {**smart_object}

            if runtime_smart_object:
                merged_smart_object["visible"] = runtime_smart_object.get("visible", smart_object.get("visible", True))
                merged_smart_object["position"] = runtime_smart_object.get("position", smart_object.get("position", {}))
                merged_smart_object["size"] = runtime_smart_object.get("size", smart_object.get("size", {}))
                merged_smart_object["bounds"] = runtime_smart_object.get("bounds")
                merged_smart_object["blend_mode"] = runtime_smart_object.get("blend_mode", smart_object.get("blend_mode", "normal"))

            position = merged_smart_object.get("position", {}) or {}
            absolute_left = _safe_int(position.get("left", position.get("x", 0)), 0)
            absolute_top = _safe_int(position.get("top", position.get("y", 0)), 0)
            position["relative_x"] = absolute_left - artboard_left
            position["relative_y"] = absolute_top - artboard_top
            position["absolute_x"] = absolute_left
            position["absolute_y"] = absolute_top
            position["relative_left"] = position["relative_x"]
            position["relative_top"] = position["relative_y"]
            merged_smart_object["position"] = position
            merged_smart_objects.append(merged_smart_object)

        base_artboard["smart_objects"] = merged_smart_objects
        base_artboard["smart_object_count"] = len(merged_smart_objects)
        merged.append(base_artboard)

    return merged


def analyze_psd_runtime(psd_path: str | Path) -> Dict[str, Any]:
    psd_path = Path(psd_path)
    static_result = analyze_psd(psd_path)

    session = create_photoshop_session(max_retries=5, retry_delay=2)
    with session:
        app = session.app
        doc = app.open(str(psd_path))
        try:
            runtime_smart_objects = _build_runtime_smart_objects(session, doc)
            runtime_artboards = _runtime_artboard_map(doc, psd_path)

            document_info = dict(static_result.get("document_info", {}))
            try:
                document_info["width"] = _safe_int(getattr(doc, "width", document_info.get("width", 0)))
                document_info["height"] = _safe_int(getattr(doc, "height", document_info.get("height", 0)))
                if getattr(doc, "resolution", None) is not None:
                    document_info["resolution"] = {
                        "horizontal": float(doc.resolution),
                        "vertical": float(doc.resolution),
                        "unit": "pixels/inch",
                    }
            except Exception:
                pass

            static_artboards = static_result.get("artboards", []) or []
            merged_artboards = _merge_artboards(static_artboards, runtime_artboards, runtime_smart_objects)

            result = {
                **static_result,
                "document_info": document_info,
                "smart_objects": runtime_smart_objects,
                "artboards": merged_artboards,
                "statistics": {
                    **(static_result.get("statistics", {}) or {}),
                    "total_smart_objects": len(runtime_smart_objects),
                    "artboard_count": len(merged_artboards) if merged_artboards else len(static_artboards),
                    "analysis_mode": "runtime",
                },
                "timestamp": datetime.now().isoformat(),
            }
            return result
        finally:
            try:
                doc.close(2)
            except Exception:
                try:
                    doc.close()
                except Exception:
                    pass
