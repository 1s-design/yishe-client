"""
颜色控制图层处理模块
仅针对纯色填充图层（Solid Color Fill Layer）提供直接改色能力。
"""

from __future__ import annotations

from typing import Any, Iterable, Optional

from photoshop.api import ActionDescriptor
from photoshop.api.enumerations import DialogModes, LayerKind


def _iter_layers(layers: Iterable[Any], parent_path: str = ""):
    for layer in layers:
        try:
            layer_name = layer.name if hasattr(layer, "name") else "未命名图层"
        except Exception:
            layer_name = "未命名图层"

        current_path = f"{parent_path}/{layer_name}" if parent_path else layer_name
        yield layer, layer_name, current_path

        try:
            children = layer.layers
        except Exception:
            children = None

        if children:
            yield from _iter_layers(children, current_path)


def _normalize_ref(value: Optional[str]) -> str:
    return str(value or "").strip()


def parse_hex_color(value: str) -> dict[str, int]:
    normalized = str(value or "").strip()
    if normalized.startswith("#"):
        normalized = normalized[1:]

    if len(normalized) == 3:
        normalized = "".join(ch * 2 for ch in normalized)

    if len(normalized) != 6:
        raise ValueError(f"颜色值格式无效: {value}")

    try:
        red = int(normalized[0:2], 16)
        green = int(normalized[2:4], 16)
        blue = int(normalized[4:6], 16)
    except ValueError as exc:
        raise ValueError(f"颜色值格式无效: {value}") from exc

    return {"red": red, "green": green, "blue": blue}


def _safe_layer_kind_text(layer: Any) -> str:
    try:
        return str(layer.kind)
    except Exception as error:
        return f"<unavailable: {error}>"


def _safe_layer_typename(layer: Any) -> str:
    try:
        return str(layer.typename)
    except Exception as error:
        return f"<unavailable: {error}>"


def _safe_layer_bool_attr(layer: Any, attr_name: str) -> str:
    try:
        return str(getattr(layer, attr_name))
    except Exception as error:
        return f"<unavailable: {error}>"


def _safe_layer_name(layer: Any) -> str:
    try:
        return str(layer.name)
    except Exception as error:
        return f"<unavailable: {error}>"


def _is_probably_solid_fill_layer(layer: Any) -> bool:
    try:
        layer_kind = layer.kind
        if hasattr(LayerKind, "SolidFillLayer") and layer_kind == LayerKind.SolidFillLayer:
            return True
    except Exception:
        pass

    kind_text = _safe_layer_kind_text(layer).upper()
    typename = _safe_layer_typename(layer).upper()
    if kind_text in {"3", "LAYERKIND.SOLIDFILLLAYER", "LAYERKIND.SOLIDFILLLAYER"}:
        return True
    return "SOLID" in kind_text or "FILL" in kind_text or "CONTENTLAYER" in typename


def _collect_color_layer_candidates(doc: Any) -> list[tuple[Any, str, str, str]]:
    candidates: list[tuple[Any, str, str, str]] = []
    for layer, _, current_path in _iter_layers(doc.layers):
        layer_name = _safe_layer_name(layer)
        layer_kind = _safe_layer_kind_text(layer)
        layer_typename = _safe_layer_typename(layer)
        if _is_probably_solid_fill_layer(layer):
            candidates.append((layer, current_path, layer_kind, layer_typename))
    return candidates


def _match_color_layers(
    doc: Any,
    color_layer_configs: list[dict[str, Any]],
) -> list[tuple[Any, dict[str, Any], str]]:
    all_layers = list(_iter_layers(doc.layers))
    if not all_layers:
        raise ValueError("当前 PSD 中没有可匹配的图层")

    candidate_layers = _collect_color_layer_candidates(doc)
    if not candidate_layers:
        raise ValueError("当前 PSD 中没有识别到可疑的纯色填充图层候选")

    matched_pairs: list[tuple[Any, dict[str, Any], str]] = []
    used_layer_indices: set[int] = set()

    def match_explicit_target(config: dict[str, Any]) -> Optional[tuple[int, Any, str]]:
        target_path = _normalize_ref(config.get("layer_path"))
        target_name = _normalize_ref(config.get("layer_name")).lower()
        if target_path:
            for layer_idx, (layer, _, current_path) in enumerate(all_layers):
                if current_path == target_path:
                    return layer_idx, layer, current_path
        if target_name:
            for layer_idx, (layer, layer_name, current_path) in enumerate(all_layers):
                if target_name in layer_name.strip().lower():
                    return layer_idx, layer, current_path
        return None

    if len(color_layer_configs) == 1:
        config = color_layer_configs[0]
        explicit_match = match_explicit_target(config)
        if explicit_match:
            layer_idx, layer, current_path = explicit_match
            matched_pairs.append((layer, config, current_path))
            for fallback_layer, fallback_path, _, _ in candidate_layers:
                if fallback_path == current_path:
                    continue
                matched_pairs.append((fallback_layer, config, fallback_path))
        else:
            for layer, current_path, _, _ in candidate_layers:
                matched_pairs.append((layer, config, current_path))
        return matched_pairs

    layer_cursor = 0
    for config in color_layer_configs:
        explicit_match = match_explicit_target(config)
        if explicit_match:
            _, layer, current_path = explicit_match
            matched_pairs.append((layer, config, current_path))
            continue

        while layer_cursor < len(candidate_layers) and layer_cursor in used_layer_indices:
            layer_cursor += 1

        if layer_cursor < len(candidate_layers):
            layer, current_path, _, _ = candidate_layers[layer_cursor]
            used_layer_indices.add(layer_cursor)
            matched_pairs.append((layer, config, current_path))
            layer_cursor += 1
        elif candidate_layers:
            layer, current_path, _, _ = candidate_layers[-1]
            matched_pairs.append((layer, config, current_path))

    return matched_pairs


def _set_fill_color_with_dom(session: Any, layer: Any, color: str) -> dict[str, Any]:
    rgb = parse_hex_color(color)
    solid_color = session.SolidColor()
    solid_color.rgb.red = rgb["red"]
    solid_color.rgb.green = rgb["green"]
    solid_color.rgb.blue = rgb["blue"]
    layer.fillColor = solid_color
    return {
        "rgb": rgb,
        "method": "dom.fillColor",
    }


def _set_adjustment_layer_color(layer: Any, color: str) -> dict[str, Any]:
    rgb = parse_hex_color(color)
    adjustment_layer = layer.adjustmentLayer
    adjustment_layer.color = (rgb["red"], rgb["green"], rgb["blue"])
    return {
        "rgb": rgb,
        "method": "dom.adjustmentLayer.color",
    }


def _set_fill_color_with_dict(layer: Any, color: str) -> dict[str, Any]:
    rgb = parse_hex_color(color)
    layer.fillColor = {
        "red": rgb["red"],
        "green": rgb["green"],
        "blue": rgb["blue"],
    }
    return {
        "rgb": rgb,
        "method": "dom.fillColor.dict",
    }


def _set_raster_layer_color(session: Any, doc: Any, layer: Any, color: str) -> dict[str, Any]:
    rgb = parse_hex_color(color)
    solid_color = session.SolidColor()
    solid_color.rgb.red = rgb["red"]
    solid_color.rgb.green = rgb["green"]
    solid_color.rgb.blue = rgb["blue"]

    original_active_layer = None
    original_all_locked = None
    original_pixels_locked = None

    try:
        original_active_layer = doc.activeLayer
    except Exception:
        original_active_layer = None

    try:
        original_all_locked = layer.allLocked
    except Exception:
        original_all_locked = None

    try:
        original_pixels_locked = layer.pixelsLocked
    except Exception:
        original_pixels_locked = None

    try:
        doc.activeLayer = layer
        try:
            if original_all_locked:
                layer.allLocked = False
        except Exception:
            pass
        try:
            if original_pixels_locked:
                layer.pixelsLocked = False
        except Exception:
            pass

        print("      [raster] step=select_all")
        doc.selection.selectAll()
        print("      [raster] step=set_foreground_color")
        session.app.foregroundColor = solid_color
        print("      [raster] step=build_action_descriptor")

        string_id = getattr(session.app, "stringIDToTypeID", None)
        execute_action = getattr(session.app, "executeAction", None)
        if not callable(string_id):
            raise RuntimeError(f"session.app.stringIDToTypeID 不可调用: {string_id}")
        if not callable(execute_action):
            raise RuntimeError(f"session.app.executeAction 不可调用: {execute_action}")

        fill_descriptor = ActionDescriptor()
        fill_descriptor.putEnumerated(
            string_id("using"),
            string_id("fillContents"),
            string_id("foregroundColor"),
        )
        fill_descriptor.putUnitDouble(string_id("opacity"), string_id("percentUnit"), 100.0)
        fill_descriptor.putEnumerated(
            string_id("mode"),
            string_id("blendMode"),
            string_id("normal"),
        )
        print("      [raster] step=execute_fill_action")
        execute_action(string_id("fill"), fill_descriptor, DialogModes.DisplayNoDialogs)
        print("      [raster] step=deselect")
        doc.selection.deselect()
    finally:
        try:
            doc.selection.deselect()
        except Exception:
            pass
        try:
            if original_all_locked is not None:
                layer.allLocked = original_all_locked
        except Exception:
            pass
        try:
            if original_pixels_locked is not None:
                layer.pixelsLocked = original_pixels_locked
        except Exception:
            pass
        try:
            if original_active_layer is not None:
                doc.activeLayer = original_active_layer
        except Exception:
            pass

    return {
        "rgb": rgb,
        "method": "raster.action.fillForeground",
    }


def _apply_color_with_fallbacks(session: Any, layer: Any, color: str) -> dict[str, Any]:
    attempts = [
        ("dom.adjustmentLayer.color", lambda: _set_adjustment_layer_color(layer, color)),
        ("dom.fillColor", lambda: _set_fill_color_with_dom(session, layer, color)),
        ("dom.fillColor.dict", lambda: _set_fill_color_with_dict(layer, color)),
    ]
    errors: list[str] = []

    for method_name, runner in attempts:
        try:
            print(f"    尝试改色方法: {method_name}")
            result = runner()
            print(f"    ✅ 方法成功: {method_name}")
            return result
        except Exception as error:
            errors.append(f"{method_name} -> {error}")
            print(f"    ❌ 方法失败: {method_name}: {error}")

    raise RuntimeError("; ".join(errors))


def _apply_color_with_all_fallbacks(session: Any, doc: Any, layer: Any, color: str) -> dict[str, Any]:
    errors: list[str] = []
    try:
        return _apply_color_with_fallbacks(session, layer, color)
    except Exception as error:
        errors.append(str(error))

    layer_kind = _safe_layer_kind_text(layer).strip().upper()
    layer_typename = _safe_layer_typename(layer).strip().upper()
    looks_like_raster = layer_kind in {"3", "LAYERKIND.NORMAL"} or "ARTLAYER" in layer_typename

    if looks_like_raster:
        try:
            print("    尝试改色方法: raster.action.fillForeground")
            result = _set_raster_layer_color(session, doc, layer, color)
            print("    ✅ 方法成功: raster.action.fillForeground")
            return result
        except Exception as error:
            errors.append(f"raster.action.fillForeground -> {error}")
            print(f"    ❌ 方法失败: raster.action.fillForeground: {error}")

    raise RuntimeError("; ".join(errors))


def _safe_read_adjustment_layer_color(layer: Any) -> str:
    try:
        adjustment_layer = layer.adjustmentLayer
    except Exception as error:
        return f"<unavailable: adjustmentLayer={error}>"

    try:
        color_value = adjustment_layer.color
        return str(color_value)
    except Exception as error:
        return f"<unavailable: adjustmentLayer.color={error}>"


def _safe_read_fill_color(layer: Any) -> str:
    try:
        fill_color = layer.fillColor
    except Exception as error:
        return f"<unavailable: fillColor={error}>"

    try:
        red = getattr(getattr(fill_color, "rgb", None), "red", None)
        green = getattr(getattr(fill_color, "rgb", None), "green", None)
        blue = getattr(getattr(fill_color, "rgb", None), "blue", None)
        if red is not None or green is not None or blue is not None:
            return f"rgb=({red}, {green}, {blue})"
    except Exception:
        pass

    return str(fill_color)


def apply_color_layer_configs(
    session: Any,
    doc: Any,
    color_layer_configs: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    if not color_layer_configs:
        return []

    matched_pairs = _match_color_layers(doc, color_layer_configs)
    applied_results: list[dict[str, Any]] = []
    candidate_layers = _collect_color_layer_candidates(doc)

    print("\n" + "=" * 70)
    print("🎨 颜色图层处理计划")
    print("=" * 70)
    print(f"可疑纯色填充图层候选总数: {len(candidate_layers)}")
    for candidate_index, (_, candidate_path, candidate_kind, candidate_typename) in enumerate(candidate_layers, 1):
        print(
            f"候选[{candidate_index}] path={candidate_path} "
            f"kind={candidate_kind} typename={candidate_typename}"
        )
    print("-" * 70)
    print(f"本次实际命中处理数: {len(matched_pairs)}")
    for index, (layer, config, matched_path) in enumerate(matched_pairs, 1):
        print(f"[{index}] name={_safe_layer_name(layer)}")
        print(f"    path={matched_path}")
        print(f"    kind={_safe_layer_kind_text(layer)}")
        print(f"    typename={_safe_layer_typename(layer)}")
        print(f"    target_color={config.get('color')}")
    print("=" * 70)

    for index, (target_layer, config, matched_path) in enumerate(matched_pairs, 1):
        color = config.get("color")
        if not color:
            raise ValueError(f"颜色图层配置[{index}] 缺少 color")

        doc.activeLayer = target_layer

        layer_name = _safe_layer_name(target_layer)
        layer_kind = _safe_layer_kind_text(target_layer)
        layer_typename = _safe_layer_typename(target_layer)
        is_solid_fill = _is_probably_solid_fill_layer(target_layer)

        print(f"🔎 颜色图层探测[{index}]")
        print(f"    name={layer_name}")
        print(f"    path={matched_path}")
        print(f"    kind={layer_kind}")
        print(f"    typename={layer_typename}")
        print(f"    isBackgroundLayer={_safe_layer_bool_attr(target_layer, 'isBackgroundLayer')}")
        print(f"    visible={_safe_layer_bool_attr(target_layer, 'visible')}")
        print(f"    allLocked={_safe_layer_bool_attr(target_layer, 'allLocked')}")
        print(f"    probably_solid_fill={is_solid_fill}")
        try:
            has_adjustment_layer = hasattr(target_layer, "adjustmentLayer")
        except Exception:
            has_adjustment_layer = False
        try:
            has_fill_color = hasattr(target_layer, "fillColor")
        except Exception:
            has_fill_color = False
        print(f"    has_adjustment_layer={has_adjustment_layer}")
        print(f"    has_fillColor={has_fill_color}")
        print(f"    current_adjustmentLayer.color={_safe_read_adjustment_layer_color(target_layer)}")
        print(f"    current_fillColor={_safe_read_fill_color(target_layer)}")

        if not is_solid_fill:
            warning_message = (
                f"颜色图层处理跳过[{index}/{len(matched_pairs)}]: 当前图层看起来不是纯色填充图层，"
                f"无法直接使用 fillColor 修改: "
                f"name={layer_name}, path={matched_path}, kind={layer_kind}, typename={layer_typename}"
            )
            print(f"⚠️ {warning_message}")
            applied_results.append(
                {
                    "layer_name": layer_name,
                    "layer_path": matched_path,
                    "color": f"#{color.strip().lstrip('#').upper()}",
                    "kind": layer_kind,
                    "typename": layer_typename,
                    "method": "dom.fillColor",
                    "success": False,
                    "skipped": True,
                    "message": warning_message,
                }
            )
            continue

        try:
            result = _apply_color_with_all_fallbacks(session, doc, target_layer, color)
            print(f"✅ 颜色图层改色成功[{index}]: {result}")
        except Exception as error:
            warning_message = (
                f"颜色图层处理跳过[{index}/{len(matched_pairs)}]: 多种 DOM 改色方式均失败: "
                f"name={layer_name}, path={matched_path}, "
                f"kind={layer_kind}, typename={layer_typename}, error={error}"
            )
            print(f"⚠️ {warning_message}")
            applied_results.append(
                {
                    "layer_name": layer_name,
                    "layer_path": matched_path,
                    "color": f"#{color.strip().lstrip('#').upper()}",
                    "kind": layer_kind,
                    "typename": layer_typename,
                    "method": "dom.color.fallbacks",
                    "success": False,
                    "skipped": True,
                    "message": warning_message,
                }
            )
            continue

        applied_results.append(
            {
                "layer_name": layer_name,
                "layer_path": matched_path,
                "color": f"#{color.strip().lstrip('#').upper()}",
                "kind": layer_kind,
                "typename": layer_typename,
                "method": result.get("method"),
                "success": True,
            }
        )

    return applied_results
