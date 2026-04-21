"""
颜色控制图层处理模块
仅针对纯色填充图层（Solid Color Fill Layer）提供直接改色能力。
"""

from __future__ import annotations

from typing import Any, Iterable, Optional

from photoshop.api.enumerations import LayerKind


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
        print(f"    probably_solid_fill={is_solid_fill}")

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
            result = _set_fill_color_with_dom(session, target_layer, color)
            print(f"✅ 颜色图层改色成功[{index}]: {result}")
        except Exception as error:
            warning_message = (
                f"颜色图层处理跳过[{index}/{len(matched_pairs)}]: fillColor 改色失败: "
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
                    "method": "dom.fillColor",
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
                "method": "dom.fillColor",
                "success": True,
            }
        )

    return applied_results
