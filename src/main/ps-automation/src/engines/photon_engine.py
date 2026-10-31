"""Photon 出图引擎（不依赖 Photoshop）。

对外契约与 psd_exporter.replace_and_export_psd_multi 完全一致：
    输入 PSD + 智能对象配置 + 导出目录；输出 (导出图片路径列表, 处理耗时)。

实现要点：
- 用 Photon CLI 打开 PSD，按与 PS 相同的规则匹配智能对象；
- 用 smartObject.replace 换图（保留原放置几何与智能滤镜）；
- 每个顶层图层单独 render 成整画布 PNG（等价 PS 的“只显示该层再 saveAs”）；
- 全程不保存模板 PSD（session.close 一律 discard）。
"""
import os
import re
import time
import uuid
from pathlib import Path
from typing import Iterable, Optional

from .photon_cli import PhotonCli, PhotonCliError

try:
    from ..utils.permission_utils import check_write_permission
    from ..utils.image_utils import (
        apply_overlays_to_image,
        compose_contain_with_cover_background,
        match_overlay_for_artboard,
        resize_image_in_tiles,
    )
except ImportError:
    from src.utils.permission_utils import check_write_permission
    from src.utils.image_utils import (
        apply_overlays_to_image,
        compose_contain_with_cover_background,
        match_overlay_for_artboard,
        resize_image_in_tiles,
    )

# 与 PS 引擎保持一致的忽略标志
IGNORE_SMART_OBJECT_PREFIX = "ignore"
# Photon render 单边上限；超出则分块渲染后拼接，保持 1:1 像素
DEFAULT_RENDER_MAX_EDGE = 8192


def _render_max_edge() -> int:
    try:
        value = int(os.environ.get("YISHE_PHOTON_RENDER_EDGE", "") or DEFAULT_RENDER_MAX_EDGE)
    except ValueError:
        return DEFAULT_RENDER_MAX_EDGE
    return value if 1 <= value <= DEFAULT_RENDER_MAX_EDGE else DEFAULT_RENDER_MAX_EDGE


def _safe_filename_part(value: Optional[str], fallback: str = "item", max_length: int = 80) -> str:
    text = str(value or "").strip()
    if not text:
        text = fallback
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", text)
    text = re.sub(r"\s+", "_", text).strip(" ._")
    if not text:
        text = fallback
    reserved_names = {
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    }
    if text.upper() in reserved_names:
        text = f"{text}_file"
    if len(text) > max_length:
        text = text[:max_length].rstrip(" ._") or fallback
    return text


def _safe_png_filename(filename: Optional[str], fallback_stem: str = "export") -> str:
    path = Path(str(filename or "").strip())
    stem = _safe_filename_part(path.stem, fallback=fallback_stem, max_length=140)
    return f"{stem}.png"


def _safe_temp_stem(value: str, fallback: str = "image", max_length: int = 90) -> str:
    text = str(value or "").strip()
    if not text:
        text = fallback
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", text)
    text = re.sub(r"\s+", "_", text).strip(" ._")
    if not text:
        text = fallback
    if len(text) > max_length:
        text = text[:max_length].rstrip(" ._") or fallback
    return text


def _apply_overlays_local(
    export_path: Optional[Path],
    overlays: Optional[list],
    artboard_index: int,
    artboard_name: Optional[str] = None,
) -> None:
    """把命中当前画板的贴片叠到导出的 PNG 上（只动导出后的文件）。"""
    if not overlays:
        return
    if export_path is None or not Path(export_path).exists():
        return

    matched = match_overlay_for_artboard(overlays, artboard_index, artboard_name)
    if not matched:
        return

    from PIL import Image

    path = Path(export_path)
    try:
        with Image.open(path) as base_img:
            composed = apply_overlays_to_image(base_img, matched)
        try:
            composed.save(path, "PNG")
        finally:
            composed.close()
        print(
            f"    🏷️ 已为画板 [{artboard_index}]"
            f"{f' {artboard_name}' if artboard_name else ''} "
            f"叠加 {len(matched)} 个贴片: {path.name}"
        )
    except FileNotFoundError:
        raise
    except Exception as e:
        print(f"    ⚠️ 画板 [{artboard_index}] 贴片合成失败（导出文件保留）: {e}")


def _photoshop_order_layers(layers: Iterable[dict]) -> list[dict]:
    """把 inspect 的图层顺序翻转为 Photoshop 图层面板的顺序。

    Photon/psd-tools 系的枚举顺序是「背景 → 前景」，Photoshop COM 与图层面板是
    「前景 → 背景」。PS 引擎的画板编号与智能对象编号都基于后者，不翻转会让
    导出图片顺序和素材匹配顺序整体反向。
    """
    ordered = []
    for layer in reversed(list(layers or [])):
        item = dict(layer)
        children = layer.get("children")
        if children:
            item["children"] = _photoshop_order_layers(children)
        ordered.append(item)
    return ordered


def _iter_layers(layers: Iterable[dict], prefix: str = "") -> Iterable[tuple[dict, str]]:
    for layer in layers or []:
        name = str(layer.get("name") or layer.get("id") or "")
        path = f"{prefix}/{name}" if prefix else name
        yield layer, path
        children = layer.get("children") or []
        if children:
            yield from _iter_layers(children, path)


def _collect_smart_objects(layers: Iterable[dict]) -> list[dict]:
    """把已按 PS 顺序排好的图层树摊平成与 PS 侧同构的智能对象记录。"""
    smart_objects = []
    for layer, path in _iter_layers(layers):
        if layer.get("kind") != "smartObject":
            continue
        smart_object = layer.get("smartObject") or {}
        source_size = smart_object.get("sourceSize") or {}
        link = smart_object.get("link") or {}
        link_id = str(link.get("id") or "")
        link_path = str(link.get("path") or "")
        smart_objects.append(
            {
                "id": layer.get("id") or layer.get("layerId"),
                "name": str(layer.get("name") or ""),
                "path": path,
                # 同一资源的多个实例共享标识：内嵌用 link.id，链接型用源文件路径。
                # PS 替换其中一个会同步所有实例，这里靠它还原该行为。
                "link_id": link_id or (f"linked:{link_path}" if link_path else ""),
                "source_size": {
                    "width": int(source_size.get("width") or 0),
                    "height": int(source_size.get("height") or 0),
                },
                "bounds": layer.get("bounds") or {},
            }
        )
    return smart_objects


def _dedupe_smart_objects(smart_objects: list[dict]) -> list[dict]:
    unique = []
    seen = set()
    for smart_object in smart_objects:
        identity = smart_object.get("id") or (smart_object.get("path"), smart_object.get("name"))
        if identity in seen:
            continue
        seen.add(identity)
        unique.append(smart_object)
    return unique


def _shared_link_layer_ids(smart_object: dict, candidates: list[dict]) -> list[str]:
    """PS 替换一个智能对象会同步所有共享同一资源的实例，Photon 只改指定图层。

    所以按 link.id 把同资源的实例合并进同一次 replace，保持两引擎结果一致。
    """
    own_id = str(smart_object.get("id") or "")
    link_id = str(smart_object.get("link_id") or "")
    if not link_id:
        return [own_id]
    ids = [
        str(item["id"])
        for item in candidates
        if item.get("id") and str(item.get("link_id") or "") == link_id
    ]
    if own_id not in ids:
        ids.insert(0, own_id)
    return ids


def _resolve_target_size(smart_object: dict, doc_width: int, doc_height: int) -> tuple[int, int]:
    """智能对象内容尺寸：优先 sourceSize（对应 PS 打开智能对象文档后的宽高）。"""
    source_size = smart_object.get("source_size") or {}
    width = int(source_size.get("width") or 0)
    height = int(source_size.get("height") or 0)
    if width > 0 and height > 0:
        return width, height

    bounds = smart_object.get("bounds") or {}
    width = int(bounds.get("width") or 0)
    height = int(bounds.get("height") or 0)
    if width > 0 and height > 0:
        return width, height

    return max(int(doc_width), 1), max(int(doc_height), 1)


def _prepare_image(
    image_path: Path,
    export_dir: Path,
    target_size: tuple[int, int],
    resolution: int,
    tile_size: int,
    resize_mode: str,
    custom_options: Optional[dict],
    background_image_path: Optional[Path],
    rotation: float,
) -> Path:
    """与 PS 引擎完全一致的素材预处理（EXIF 校正 → 模式归一 → 旋转 → 缩放/合成）。"""
    target_width, target_height = target_size
    from PIL import Image, ImageOps

    with Image.open(image_path) as img:
        try:
            transposed = ImageOps.exif_transpose(img)
            if transposed is not None:
                img = transposed
        except Exception:
            pass

        if img.mode == "P":
            if "transparency" in img.info or (rotation and rotation != 0):
                img = img.convert("RGBA")
            else:
                if resize_mode not in ("contain", "custom"):
                    img = img.convert("RGB")
        elif img.mode == "LA":
            img = img.convert("RGBA")
        elif img.mode == "RGBA":
            pass
        elif img.mode == "RGB" and (rotation and rotation % 90 != 0):
            img = img.convert("RGBA")

        if rotation and rotation != 0:
            original_size = img.size
            fill_color = (0, 0, 0, 0) if img.mode == "RGBA" else None
            # Pillow 12 起 rotate() 不再接受 LANCZOS，用 BICUBIC 取得同等质量的旋转插值
            resample = getattr(Image, "Resampling", Image).BICUBIC
            img = img.rotate(-rotation, expand=True, resample=resample, fillcolor=fill_color)
            print(f"    🔄 旋转原图生效: {rotation}° (顺时针) 尺寸变换: {original_size} → {img.size} (模式: {img.mode})")
        else:
            print(f"    ℹ️ 原图无需旋转 (rotation={rotation})")

        orig_width, orig_height = img.size
        orig_ratio = orig_width / orig_height
        target_ratio = target_width / target_height

        if resize_mode == "custom" and custom_options:
            position = custom_options.get("position", {})
            size = custom_options.get("size", {})
            child_resize_mode = custom_options.get("child_resize_mode", "contain")
            print("    🎯 自定义模式配置:")
            print(
                f"       位置: ({position.get('x', 0)}{position.get('unit', 'px')}, "
                f"{position.get('y', 0)}{position.get('unit', 'px')})"
            )
            print(
                f"       尺寸: {size.get('width', 0)}{size.get('unit', 'px')} x "
                f"{size.get('height', 0)}{size.get('unit', 'px')}"
            )
            print(f"       区域缩放模式: {child_resize_mode} ({'铺满裁剪' if child_resize_mode == 'cover' else '完整显示'})")
        elif resize_mode != "stretch" and abs(orig_ratio - target_ratio) > 0.01:
            print("    📐 比例不匹配:")
            print(f"       原始图片: {orig_width} x {orig_height} (比例 {orig_ratio:.3f})")
            print(f"       目标尺寸: {target_width} x {target_height} (比例 {target_ratio:.3f})")

        if resize_mode == "contain" and background_image_path:
            background_path = Path(background_image_path)
            if not background_path.exists():
                raise FileNotFoundError(f"背景图文件不存在: {background_path}")
            print(f"    🖼️ contain 背景合成: {background_path}")
            with Image.open(background_path) as background_img:
                print(f"       背景尺寸: {background_img.size[0]} x {background_img.size[1]}")
                resized_img, compose_debug = compose_contain_with_cover_background(
                    img, background_img, (target_width, target_height)
                )
                bg_debug = compose_debug.get("background", {})
                design_debug = compose_debug.get("design", {})
                print(
                    "       背景 cover: "
                    f"{bg_debug.get('scaled_width')} x {bg_debug.get('scaled_height')}, "
                    f"裁剪偏移=({bg_debug.get('crop_offset_x')}, {bg_debug.get('crop_offset_y')})"
                )
                print(
                    "       设计 contain: "
                    f"{design_debug.get('width')} x {design_debug.get('height')}, "
                    f"粘贴偏移=({design_debug.get('offset_x')}, {design_debug.get('offset_y')})"
                )
        else:
            if background_image_path and resize_mode != "contain":
                print(f"    ℹ️ 已传背景图，但当前缩放模式为 {resize_mode}，背景合成仅在 contain 模式启用，已忽略")
            resized_img = resize_image_in_tiles(
                img,
                (target_width, target_height),
                tile_size,
                mode=resize_mode,
                custom_options=custom_options,
            )

        safe_stem = _safe_temp_stem(image_path.stem)
        if resized_img.mode == "RGBA":
            resized_path = export_dir / f"{safe_stem}_resized.png"
        else:
            suffix = image_path.suffix.lower()
            if suffix not in {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}:
                suffix = ".png"
            resized_path = export_dir / f"{safe_stem}_resized{suffix}"
        resized_img.save(resized_path, dpi=(resolution, resolution))
        resized_img.close()

    return resized_path


def _artboard_rect(layer: dict) -> Optional[dict]:
    """原生画板图层返回画板区域；PS 的 saveAs 对画板只保存该区域，这里保持一致。"""
    if not layer.get("artboard"):
        return None
    bounds = layer.get("bounds") or {}
    try:
        x = int(round(float(bounds.get("x") or 0)))
        y = int(round(float(bounds.get("y") or 0)))
        width = int(round(float(bounds.get("width") or 0)))
        height = int(round(float(bounds.get("height") or 0)))
    except (TypeError, ValueError):
        return None
    if width <= 0 or height <= 0:
        return None
    return {"x": x, "y": y, "width": width, "height": height}


def _render_full_canvas(
    cli: PhotonCli,
    document_id: str,
    revision: Optional[int],
    out_path: Path,
    layer_id: Optional[str],
    width: int,
    height: int,
    rect: Optional[dict] = None,
) -> None:
    """渲染成 PNG：默认整张画布；传 rect 时只渲染该区域（画板切片）。

    渲染区域超过单边上限时按块渲染再拼接，保证 1:1 像素。
    """
    max_edge = _render_max_edge()
    region_x = int(rect["x"]) if rect else 0
    region_y = int(rect["y"]) if rect else 0
    region_width = int(rect["width"]) if rect else width
    region_height = int(rect["height"]) if rect else height

    if region_width <= max_edge and region_height <= max_edge:
        cli.render(
            document_id,
            out_path,
            layer_id=layer_id,
            rect=rect,
            max_edge=max_edge,
            revision=revision,
        )
        return

    from PIL import Image

    stitched = Image.new("RGBA", (region_width, region_height), (0, 0, 0, 0))
    try:
        for offset_y in range(0, region_height, max_edge):
            for offset_x in range(0, region_width, max_edge):
                tile_width = min(max_edge, region_width - offset_x)
                tile_height = min(max_edge, region_height - offset_y)
                tile_path = out_path.parent / f".{out_path.stem}_{uuid.uuid4().hex[:8]}_tile.png"
                try:
                    cli.render(
                        document_id,
                        tile_path,
                        layer_id=layer_id,
                        rect={
                            "x": region_x + offset_x,
                            "y": region_y + offset_y,
                            "width": tile_width,
                            "height": tile_height,
                        },
                        max_edge=max_edge,
                        revision=revision,
                    )
                    with Image.open(tile_path) as tile_img:
                        stitched.paste(tile_img.convert("RGBA"), (offset_x, offset_y))
                finally:
                    try:
                        tile_path.unlink(missing_ok=True)
                    except OSError:
                        pass
        stitched.save(out_path, "PNG")
    finally:
        stitched.close()


def replace_and_export_psd_multi_photon(
    psd_path: Path,
    export_dir: Path,
    smart_objects_config: list[dict],
    color_layer_configs: Optional[list[dict]] = None,
    output_filename: Optional[str] = None,
    overlays: Optional[list[dict]] = None,
) -> tuple[list[Optional[Path]], float]:
    """Photon 版多画板出图，入参与返回值和 PS 版一致。"""
    start_time = time.time()
    psd_path = Path(psd_path)
    export_dir = Path(export_dir)

    cli = PhotonCli()
    print(f"\n📋 [Photon] PSD: {psd_path.name} | CLI: {cli.cli_path}")

    stale_sessions = cli.close_documents_for_path(psd_path)
    if stale_sessions:
        print(f"ℹ️ [Photon] 已清理 {stale_sessions} 个残留会话，确保按原始模板出图")

    document = cli.open_document(psd_path)
    document_id = document.get("documentId") or document.get("id")
    revision = document.get("revision")
    if not document_id:
        raise PhotonCliError(f"Photon 打开 PSD 失败，未返回 documentId: {document}")

    # 与 PS 引擎一致：替换用的临时图在会话结束后清理
    temp_paths: list[Path] = []
    try:
        inspect_result = cli.inspect(document_id)
        revision = inspect_result.get("revision", revision)
        doc_width = int(inspect_result.get("width") or document.get("width") or 0)
        doc_height = int(inspect_result.get("height") or document.get("height") or 0)
        resolution = int(round(float(inspect_result.get("resolution") or 300)))
        doc_layers = _photoshop_order_layers(inspect_result.get("layers") or [])

        all_smart_objects: list[dict] = []
        ignored_smart_objects: list[dict] = []
        found: list[dict] = []
        total_count = 0
        if smart_objects_config:
            found = _dedupe_smart_objects(_collect_smart_objects(doc_layers))
            if not found:
                raise ValueError("PSD 文件中没有找到任何智能对象图层")

            total_count = len(found)
            for smart_object in found:
                if IGNORE_SMART_OBJECT_PREFIX.lower() in str(smart_object.get("name", "")).lower():
                    ignored_smart_objects.append(smart_object)
                else:
                    all_smart_objects.append(smart_object)

            # all_smart_objects 为空时不做截断，交给下面的“全部为忽略标志”检查抛错，
            # 否则会把配置清空后静默导出模板
            if all_smart_objects and len(smart_objects_config) > len(all_smart_objects):
                unique_image_paths = {
                    str(config.get("image_path") or "").strip()
                    for config in smart_objects_config
                    if str(config.get("image_path") or "").strip()
                }
                if len(unique_image_paths) == 1:
                    original_config_count = len(smart_objects_config)
                    smart_objects_config = smart_objects_config[: len(all_smart_objects)]
                    print(
                        "ℹ️ 智能对象配置数量多于可处理智能对象，但所有配置使用同一张素材图，"
                        f"已从 {original_config_count} 条截断为 {len(smart_objects_config)} 条"
                    )
                else:
                    raise ValueError(
                        "传入的智能对象配置数量多于 PSD 中可处理的智能对象数量，"
                        f"配置数={len(smart_objects_config)}，可处理智能对象数={len(all_smart_objects)}。"
                        "为避免部分素材被静默忽略，已终止本次导出。"
                    )

        print(
            f"📋 [Photon] {psd_path.name} | {doc_width}x{doc_height} | "
            f"智能对象 {len(all_smart_objects)}/{total_count}"
        )
        if ignored_smart_objects:
            print(f"已忽略的智能对象: {len(ignored_smart_objects)} (包含标志 '{IGNORE_SMART_OBJECT_PREFIX}')")
        for smart_object in ignored_smart_objects:
            print(f"  ⏭️  {smart_object.get('name')} | {smart_object.get('path')}")

        if smart_objects_config and not all_smart_objects:
            raise ValueError(
                f"PSD 文件中的所有智能对象都包含忽略标志 '{IGNORE_SMART_OBJECT_PREFIX}'，没有可处理的智能对象"
            )

        # ========== 匹配配置和智能对象（与 PS 引擎同一套规则） ==========
        matched_pairs: list[tuple[dict, dict]] = []
        used_indices: set[int] = set()

        if smart_objects_config:
            for config_idx, so_config in enumerate(smart_objects_config):
                target_name = str(so_config.get("smart_object_name") or "").strip()
                matched_index = None
                match_reason = "按顺序"

                if target_name:
                    target_name_lower = target_name.lower()
                    for so_idx, smart_object in enumerate(all_smart_objects):
                        if so_idx in used_indices:
                            continue
                        if str(smart_object.get("name", "")).strip().lower() == target_name_lower:
                            matched_index = so_idx
                            match_reason = f"名称精确匹配: '{target_name}'"
                            break

                    if matched_index is None:
                        for so_idx, smart_object in enumerate(all_smart_objects):
                            if so_idx in used_indices:
                                continue
                            if target_name_lower in str(smart_object.get("name", "")).lower():
                                matched_index = so_idx
                                match_reason = f"名称包含匹配: '{target_name}'"
                                break

                    if matched_index is None:
                        print(
                            f"⚠️  警告: 配置[{config_idx}] 的名称 '{target_name}' 未匹配到任何未处理智能对象，将按顺序匹配"
                        )

                if matched_index is None:
                    for so_idx in range(len(all_smart_objects)):
                        if so_idx not in used_indices:
                            matched_index = so_idx
                            break

                if matched_index is None:
                    print(f"⚠️  警告: 配置[{config_idx}] 没有可用的未处理智能对象，已跳过")
                    continue

                smart_object = all_smart_objects[matched_index]
                matched_pairs.append((smart_object, so_config))
                used_indices.add(matched_index)
                print(f"✅ 匹配: 智能对象 '{smart_object['name']}' <-> 配置[{config_idx}] ({match_reason})")

            skipped_count = len(all_smart_objects) - len(used_indices)
            if skipped_count > 0:
                print(f"ℹ️ 未处理 {skipped_count} 个额外智能对象：配置数组已用完，不再复用配置")

        if smart_objects_config and not matched_pairs:
            raise ValueError("未能匹配任何智能对象和配置")

        # ========== 替换智能对象 ==========
        processed_count = 0
        failed_pairs = []
        if matched_pairs:
            print("\n" + "=" * 70)
            print("🔄 [Photon] 开始替换智能对象")
            print("=" * 70)

            for i, (smart_object, so_config) in enumerate(matched_pairs, 1):
                print(f"\n⏳ [{i}/{len(matched_pairs)}] 正在替换智能对象: {smart_object['name']}...")
                try:
                    image_path = Path(so_config["image_path"])
                    if not image_path.exists():
                        raise FileNotFoundError(f"素材文件不存在: {image_path}")
                    target_size = _resolve_target_size(smart_object, doc_width, doc_height)
                    print(f"    智能对象尺寸: {target_size[0]} x {target_size[1]} 像素")

                    resized_path = _prepare_image(
                        image_path=image_path,
                        export_dir=export_dir,
                        target_size=target_size,
                        resolution=resolution,
                        tile_size=so_config.get("tile_size", 512),
                        resize_mode=so_config.get("resize_mode", "contain"),
                        custom_options=so_config.get("custom_options"),
                        background_image_path=(
                            Path(so_config["background_image_path"]) if so_config.get("background_image_path") else None
                        ),
                        rotation=float(so_config.get("rotation", 0)),
                    )
                    temp_paths.append(resized_path)

                    replace_ids = _shared_link_layer_ids(smart_object, found)
                    if len(replace_ids) > 1:
                        print(
                            f"    🔗 同一智能对象资源共 {len(replace_ids)} 个实例，"
                            "一并替换（与 PS 行为一致）"
                        )
                    response = cli.execute(
                        "smartObject.replace",
                        {
                            "layerIds": replace_ids,
                            "path": str(resized_path),
                            # preserve：保持原有内嵌/链接类型；PS 不会把链接型智能对象转成内嵌
                            "link": "preserve",
                        },
                        document_id,
                        revision,
                    )
                    revision = response.get("revision", revision)
                    print(f"✅ [{i}/{len(matched_pairs)}] 智能对象 '{smart_object['name']}' 已替换")
                    processed_count += 1
                except Exception as e:
                    print(f"❌ [{i}/{len(matched_pairs)}] 处理智能对象 '{smart_object['name']}' 时出错: {e}")
                    import traceback

                    traceback.print_exc()
                    failed_pairs.append(
                        {
                            "index": i,
                            "name": smart_object.get("name"),
                            "path": smart_object.get("path"),
                            "image_path": so_config.get("image_path"),
                            "error": str(e),
                        }
                    )
                    continue

        print(f"\n✅ 处理完成: 成功处理 {processed_count}/{len(matched_pairs)} 个智能对象")

        if failed_pairs:
            print("\n" + "=" * 70)
            print("❌ 智能对象替换未全部成功，已阻止导出")
            print("=" * 70)
            for item in failed_pairs:
                print(
                    f"  [{item['index']}/{len(matched_pairs)}] {item['name']} | "
                    f"path={item['path']} | image={item['image_path']} | error={item['error']}"
                )
            print("=" * 70)
            failure_details = "; ".join(
                f"[{item['index']}] {item['name']}: {item['error']}" for item in failed_pairs[:3]
            )
            raise RuntimeError(
                f"智能对象替换未全部成功，已取消导出，"
                f"成功 {processed_count}/{len(matched_pairs)}，失败 {len(failed_pairs)}。"
                f"错误详情: {failure_details}"
            )

        if color_layer_configs:
            print(
                f"⚠️ 颜色图层处理已临时停用，已忽略 {len(color_layer_configs)} 个颜色图层配置，"
                "避免错误和额外耗时"
            )

        # ========== 逐个顶层元素导出 ==========
        top_layers = doc_layers
        export_paths: list[Optional[Path]] = []
        export_errors: list[str] = []
        export_dir.mkdir(parents=True, exist_ok=True)

        if top_layers:
            print(f"\n🎨 [Photon] 找到 {len(top_layers)} 个顶层元素，开始逐个导出")
            for i, layer in enumerate(top_layers, 1):
                artboard_name = str(layer.get("name") or f"图层组{i}")
                print(f"⏳ 导出画板 [{i}/{len(top_layers)}]: {artboard_name}")
                artboard_rect = _artboard_rect(layer)
                if artboard_rect:
                    print(
                        f"    🖼️ 画板区域: {artboard_rect['width']}x{artboard_rect['height']}"
                        f" @ ({artboard_rect['x']},{artboard_rect['y']})"
                    )

                if output_filename is None:
                    base_name = _safe_filename_part(psd_path.stem, fallback="psd", max_length=80)
                    safe_artboard_name = _safe_filename_part(artboard_name, fallback=f"artboard{i}", max_length=60)
                    artboard_export_filename = f"{base_name}_artboard{i}_{safe_artboard_name}_export.png"
                else:
                    output_path = Path(_safe_png_filename(output_filename))
                    safe_artboard_name = _safe_filename_part(artboard_name, fallback=f"artboard{i}", max_length=60)
                    artboard_export_filename = f"{output_path.stem}_artboard{i}_{safe_artboard_name}{output_path.suffix}"

                artboard_export_path = export_dir / artboard_export_filename
                has_permission, perm_error = check_write_permission(artboard_export_path)
                if not has_permission:
                    print(f"    ❌ 权限检查失败: {perm_error}")
                    print(f"    ⚠️ 跳过图层组 [{i}/{len(top_layers)}]: {artboard_name}")
                    export_errors.append(f"[{artboard_name}] 无写入权限: {perm_error}")
                    export_paths.append(None)
                    continue

                try:
                    _render_full_canvas(
                        cli,
                        document_id,
                        revision,
                        artboard_export_path,
                        layer.get("id") or layer.get("layerId"),
                        doc_width,
                        doc_height,
                        rect=artboard_rect,
                    )
                except Exception as export_error:
                    print(f"    ❌ 导出失败: {export_error}")
                    import traceback

                    traceback.print_exc()
                    export_errors.append(f"[{artboard_name}] {export_error}")
                    export_paths.append(None)
                    continue

                if artboard_export_path.exists():
                    file_size_mb = artboard_export_path.stat().st_size / 1024 / 1024
                    export_paths.append(artboard_export_path)
                    print(f"✅ 画板 [{i}/{len(top_layers)}] 导出成功: {artboard_export_path.name} ({file_size_mb:.2f} MB)")
                else:
                    print(f"    ❌ 导出文件不存在: {artboard_export_path}")
                    export_errors.append(f"[{artboard_name}] 渲染后文件未生成")
                    export_paths.append(None)
        else:
            print("未找到顶层元素，将导出整张文档")
            if output_filename is None:
                output_filename = f"{_safe_filename_part(psd_path.stem, fallback='psd', max_length=120)}_export.png"
            else:
                output_filename = _safe_png_filename(output_filename)
            export_path = export_dir / output_filename

            has_permission, perm_error = check_write_permission(export_path)
            if not has_permission:
                raise PermissionError(f"导出路径没有写入权限: {perm_error}")

            _render_full_canvas(cli, document_id, revision, export_path, None, doc_width, doc_height)
            export_paths.append(export_path)

        if not any(path for path in export_paths):
            # 全部失败时把底层原因带出去，客户端提示不再只有“所有文件导出失败”
            detail = "; ".join(export_errors[:3]) or "未知原因"
            raise RuntimeError(f"所有画板导出失败: {detail}")

        # ========== 导出后贴片合成 ==========
        if overlays:
            print(f"\n🏷️ 开始叠加贴片（overlays 配置 {len(overlays)} 条）")
            if top_layers:
                for idx, export_path in enumerate(export_paths, 1):
                    artboard_name = None
                    if idx - 1 < len(top_layers):
                        artboard_name = top_layers[idx - 1].get("name")
                    _apply_overlays_local(export_path, overlays, idx, artboard_name)
            elif export_paths:
                _apply_overlays_local(export_paths[0], overlays, 1, None)

        processing_time = time.time() - start_time
        successful = [p for p in export_paths if p is not None]
        print("\n" + "=" * 70)
        print("✅ [Photon] 最终处理结果")
        print("=" * 70)
        print(f"处理耗时: {processing_time:.2f} 秒")
        print(f"共导出 {len(successful)}/{len(export_paths)} 个文件")
        for i, path in enumerate(export_paths, 1):
            if path and path.exists():
                file_size_mb = path.stat().st_size / 1024 / 1024
                print(f"  ✅ [{i}] {path.name} ({file_size_mb:.2f} MB)")
            else:
                print(f"  ❌ [{i}] (导出失败)")
        print("=" * 70)

        return export_paths, processing_time
    finally:
        _close_document_quietly(cli, document_id, revision)
        # 链接型智能对象在会话内引用临时图，必须先关闭会话再删
        for temp_path in temp_paths:
            try:
                temp_path.unlink()
            except OSError:
                pass


def _close_document_quietly(cli: PhotonCli, document_id: str, revision: Optional[int]) -> None:
    """丢弃本次会话，绝不把替换结果写回模板 PSD。"""
    for _ in range(2):
        try:
            cli.close_document(document_id, revision, disposition="discard")
            return
        except Exception as e:
            print(f"    ⚠️ 关闭 Photon 文档会话失败: {e}")
            try:
                revision = cli.inspect(document_id).get("revision", revision)
            except Exception:
                return
