"""
颜色控制图层处理模块
支持按路径/名称/顺序匹配颜色图层，并更新其纯色填充颜色。
"""

from __future__ import annotations

import json
from typing import Any, Iterable, Optional


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


def _build_set_solid_fill_script(red: int, green: int, blue: int) -> str:
    payload = json.dumps({"red": red, "green": green, "blue": blue}, ensure_ascii=True)
    return f"""
(function() {{
  var input = {payload};
  var makeColor = function() {{
    var colorDesc = new ActionDescriptor();
    colorDesc.putDouble(charIDToTypeID("Rd  "), input.red);
    colorDesc.putDouble(charIDToTypeID("Grn "), input.green);
    colorDesc.putDouble(charIDToTypeID("Bl  "), input.blue);
    return colorDesc;
  }};

  try {{
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putEnumerated(stringIDToTypeID("contentLayer"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    desc.putReference(charIDToTypeID("null"), ref);

    var solidColorDesc = new ActionDescriptor();
    solidColorDesc.putObject(charIDToTypeID("Clr "), stringIDToTypeID("RGBColor"), makeColor());

    desc.putObject(charIDToTypeID("T   "), stringIDToTypeID("solidColorLayer"), solidColorDesc);
    executeAction(charIDToTypeID("setd"), desc, DialogModes.NO);
    "ok";
  }} catch (error) {{
    throw new Error("set_solid_fill_failed:" + error);
  }}
}})();
""".strip()


def _execute_javascript(app: Any, script: str):
    for method_name in ("doJavaScript", "DoJavaScript"):
        method = getattr(app, method_name, None)
        if callable(method):
            return method(script)
    raise RuntimeError("当前 Photoshop API 不支持 doJavaScript")


def _normalize_ref(value: Optional[str]) -> str:
    return str(value or "").strip()


def _match_color_layers(doc: Any, color_layer_configs: list[dict[str, Any]]) -> list[tuple[Any, dict[str, Any], str]]:
    all_layers = list(_iter_layers(doc.layers))
    if not all_layers:
        raise ValueError("当前 PSD 中没有可匹配的图层")

    # 规则：
    # 1. 如果只有一个配置，则复用给所有图层
    # 2. 如果有多个配置，则按顺序一一匹配
    # 3. 如果某个配置显式给了 layer_path / layer_name，优先定向到对应图层
    matched_pairs: list[tuple[Any, dict[str, Any], str]] = []
    used_layer_indices: set[int] = set()

    def match_explicit_target(config: dict[str, Any]) -> Optional[tuple[int, Any, str]]:
        target_path = _normalize_ref(config.get("layer_path"))
        target_name = _normalize_ref(config.get("layer_name")).lower()
        if target_path:
            for layer_idx, (layer, _, current_path) in enumerate(all_layers):
                if layer_idx in used_layer_indices:
                    continue
                if current_path == target_path:
                    return layer_idx, layer, current_path
        if target_name:
            for layer_idx, (layer, layer_name, current_path) in enumerate(all_layers):
                if layer_idx in used_layer_indices:
                    continue
                if target_name in layer_name.strip().lower():
                    return layer_idx, layer, current_path
        return None

    if len(color_layer_configs) == 1:
        config = color_layer_configs[0]
        explicit_match = match_explicit_target(config)
        if explicit_match:
            layer_idx, layer, current_path = explicit_match
            used_layer_indices.add(layer_idx)
            matched_pairs.append((layer, config, current_path))
            for fallback_idx, (fallback_layer, _, fallback_path) in enumerate(all_layers):
                if fallback_idx in used_layer_indices:
                    continue
                matched_pairs.append((fallback_layer, config, fallback_path))
        else:
            for layer, _, current_path in all_layers:
                matched_pairs.append((layer, config, current_path))
        return matched_pairs

    layer_cursor = 0
    for config in color_layer_configs:
        explicit_match = match_explicit_target(config)
        if explicit_match:
            layer_idx, layer, current_path = explicit_match
            used_layer_indices.add(layer_idx)
            matched_pairs.append((layer, config, current_path))
            continue

        while layer_cursor < len(all_layers) and layer_cursor in used_layer_indices:
            layer_cursor += 1

        if layer_cursor < len(all_layers):
            layer, _, current_path = all_layers[layer_cursor]
            used_layer_indices.add(layer_cursor)
            matched_pairs.append((layer, config, current_path))
            layer_cursor += 1
        elif all_layers:
            # 配置多于图层时，继续复用最后一个可用图层
            layer, _, current_path = all_layers[-1]
            matched_pairs.append((layer, config, current_path))

    return matched_pairs


def apply_color_layer_configs(session: Any, doc: Any, color_layer_configs: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not color_layer_configs:
        return []

    app = session.app
    matched_pairs = _match_color_layers(doc, color_layer_configs)
    applied_results: list[dict[str, Any]] = []

    for index, (target_layer, config, matched_path) in enumerate(matched_pairs, 1):
        color = config.get("color")
        if not color:
            raise ValueError(f"颜色图层配置[{index}] 缺少 color")

        rgb = parse_hex_color(color)
        doc.activeLayer = target_layer
        _execute_javascript(app, _build_set_solid_fill_script(rgb["red"], rgb["green"], rgb["blue"]))

        applied_results.append(
            {
                "layer_name": getattr(target_layer, "name", config.get("layer_name") or f"layer_{index}"),
                "layer_path": matched_path,
                "color": f"#{color.strip().lstrip('#').upper()}",
            }
        )

    return applied_results
