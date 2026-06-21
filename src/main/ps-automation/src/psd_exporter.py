"""
PSD 导出模块
包含多画板导出等复杂导出逻辑
"""
import re
import os
import time
from pathlib import Path
from typing import Optional, List

from photoshop import Session

# 智能对象忽略标志：如果智能对象名称包含此标志（不区分大小写），将不会被处理
IGNORE_SMART_OBJECT_PREFIX = "ignore"

# 支持相对导入和绝对导入
try:
    from .utils.permission_utils import check_write_permission
    from .layer_finder import find_artboard_layers
    from .smart_object_replacer import replace_smart_object_content
    from .utils import create_photoshop_session
    from .layer_finder import find_smart_object_layers
except ImportError:
    try:
        from src.utils.permission_utils import check_write_permission
        from src.layer_finder import find_artboard_layers
        from src.smart_object_replacer import replace_smart_object_content
        from src.utils import create_photoshop_session
        from src.layer_finder import find_smart_object_layers
    except ImportError:
        raise ImportError("无法导入必要的模块")


# 颜色图层处理已临时停用。保留入参与日志，避免影响现有调用方。
COLOR_LAYER_PROCESSING_ENABLED = False
PS_VERBOSE_LOG = os.environ.get("YISHE_PS_VERBOSE", "").strip().lower() in {"1", "true", "yes", "debug"}


def _log_detail(message: str) -> None:
    """Verbose Photoshop automation diagnostics. Enable with YISHE_PS_VERBOSE=1."""
    if PS_VERBOSE_LOG:
        print(message)


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


def _safe_get_active_layer_name(doc) -> str:
    """Photoshop 2025 下读取 activeLayer 有时会直接触发 COM 异常。"""
    try:
        active_layer = doc.activeLayer
        if hasattr(active_layer, "name"):
            return active_layer.name
    except Exception as exc:
        return f"无法读取 ({exc})"
    return "未知"


def _smart_object_identity(smart_object: dict) -> tuple:
    """Return a stable-ish identity for deduping Photoshop COM layer records."""
    layer = smart_object.get("layer")
    path = smart_object.get("path")
    name = smart_object.get("name")
    bounds = smart_object.get("bounds")
    width = smart_object.get("width")
    height = smart_object.get("height")
    try:
        layer_id = getattr(layer, "id", None)
        if layer_id is not None:
            return ("id", str(layer_id))
    except Exception:
        pass

    # COM wrappers can be recreated while still pointing at the same PSD layer.
    # Duplicate smart object names are valid in PSD templates, so name/path alone
    # is not enough. Include geometry to avoid collapsing separate slots that
    # share the same visible layer name.
    return ("path", str(path or ""), str(name or ""), str(bounds or ""), str(width or ""), str(height or ""))


def _dedupe_smart_objects(smart_objects: list[dict]) -> list[dict]:
    unique_smart_objects = []
    seen = set()
    for smart_object in smart_objects:
        identity = _smart_object_identity(smart_object)
        if identity in seen:
            continue
        seen.add(identity)
        unique_smart_objects.append(smart_object)
    return unique_smart_objects


def replace_and_export_psd_multi(
    psd_path: Path,
    export_dir: Path,
    smart_objects_config: list[dict],
    color_layer_configs: Optional[list[dict]] = None,
    output_filename: Optional[str] = None
) -> tuple[List[Path], float]:
    """
    处理 PSD 文件，支持多个智能对象的不同配置
    
    Args:
        psd_path: PSD 文件路径
        export_dir: 导出目录
        smart_objects_config: 智能对象配置数组
        output_filename: 导出文件名（可选）
    
    Returns:
        tuple: (导出的图片文件路径列表, 处理时间(秒))
    """
    # 记录开始时间
    start_time = time.time()
    
    # 使用辅助函数创建 Session（带重试逻辑）
    session = create_photoshop_session(max_retries=5, retry_delay=2)
    
    with session:
        app = session.app
        doc = app.open(str(psd_path))
        
        all_smart_objects = []
        ignored_smart_objects = []
        total_count = 0
        if smart_objects_config:
            # 查找所有智能对象
            all_smart_objects = find_smart_object_layers(doc, None, debug=False)

            if not all_smart_objects:
                print("\n⚠️ 第一次查找未找到智能对象，启用详细调试模式重新查找...\n")
                all_smart_objects = find_smart_object_layers(doc, None, debug=True)

            if not all_smart_objects:
                doc.close()
                raise ValueError("PSD 文件中没有找到任何智能对象图层")

            deduped_smart_objects = _dedupe_smart_objects(all_smart_objects)
            if len(deduped_smart_objects) != len(all_smart_objects):
                print(
                    f"ℹ️ 已去重智能对象: 原始 {len(all_smart_objects)} 个，"
                    f"去重后 {len(deduped_smart_objects)} 个"
                )
                all_smart_objects = deduped_smart_objects

            # ========== 过滤掉包含忽略标志的智能对象 ==========
            total_count = len(all_smart_objects)
            filtered_smart_objects = []

            for so in all_smart_objects:
                so_name = so.get('name', '')
                # 检查智能对象名称是否包含忽略标志（不区分大小写）
                if IGNORE_SMART_OBJECT_PREFIX.lower() in so_name.lower():
                    ignored_smart_objects.append(so)
                else:
                    filtered_smart_objects.append(so)

            all_smart_objects = filtered_smart_objects

            if len(smart_objects_config) > len(all_smart_objects):
                unique_image_paths = {
                    str(config.get("image_path") or "").strip()
                    for config in smart_objects_config
                    if str(config.get("image_path") or "").strip()
                }
                same_image_repeated = len(unique_image_paths) == 1
                if same_image_repeated:
                    original_config_count = len(smart_objects_config)
                    smart_objects_config = smart_objects_config[:len(all_smart_objects)]
                    print(
                        "ℹ️ 智能对象配置数量多于可处理智能对象，但所有配置使用同一张素材图，"
                        f"已从 {original_config_count} 条截断为 {len(smart_objects_config)} 条"
                    )
                else:
                    doc.close()
                    raise ValueError(
                        "传入的智能对象配置数量多于 PSD 中可处理的智能对象数量，"
                        f"配置数={len(smart_objects_config)}，可处理智能对象数={len(all_smart_objects)}。"
                        "为避免部分素材被静默忽略，已终止本次导出。"
                    )

        # ========== 打印 PSD 文件基本信息 ==========
        print(
            f"\n📋 PSD: {doc.name} | {int(doc.width)}x{int(doc.height)} | "
            f"智能对象 {len(all_smart_objects)}/{total_count}"
        )
        _log_detail("=" * 70)
        _log_detail(f"文件路径: {psd_path}")
        _log_detail(f"文件大小: {psd_path.stat().st_size / 1024 / 1024:.2f} MB")
        _log_detail(f"分辨率: {int(doc.resolution)} DPI")
        if ignored_smart_objects:
            print(f"已忽略的智能对象: {len(ignored_smart_objects)} (包含标志 '{IGNORE_SMART_OBJECT_PREFIX}')")
        _log_detail(f"智能对象配置数量: {len(smart_objects_config)}")
        _log_detail(f"颜色图层配置数量: {len(color_layer_configs or [])}")
        _log_detail("=" * 70)
        
        # 打印被忽略的智能对象信息
        if ignored_smart_objects:
            print("\n" + "=" * 70)
            print("⏭️  已忽略的智能对象（包含标志 '{}'）".format(IGNORE_SMART_OBJECT_PREFIX))
            print("=" * 70)
            for i, so in enumerate(ignored_smart_objects, 1):
                print(f"  [{i}] {so.get('name', '未知名称')}")
                print(f"      路径: {so.get('path', '未知路径')}")
            print("=" * 70)
        
        if smart_objects_config and not all_smart_objects:
            doc.close()
            raise ValueError(f"PSD 文件中的所有智能对象都包含忽略标志 '{IGNORE_SMART_OBJECT_PREFIX}'，没有可处理的智能对象")
        
        # ========== 匹配配置和智能对象 ==========
        # 匹配策略：
        # 1. 以配置数组为主，每条配置最多只处理一个智能对象
        # 2. 如果配置指定了 smart_object_name，优先按名称匹配（先精确，再包含关键字）
        # 2. 如果名称无法匹配，再按顺序匹配
        # 3. 配置用完后不再复用，避免一个请求意外替换多个同名/额外智能对象
        
        matched_pairs = []  # [(smart_object, config), ...]
        used_smart_object_indices = set()  # 已使用的智能对象索引

        if smart_objects_config:
            for config_idx, so_config in enumerate(smart_objects_config):
                target_name = str(so_config.get('smart_object_name') or "").strip()
                matched_index = None
                match_reason = "按顺序"

                if target_name:
                    target_name_lower = target_name.lower()

                    for so_idx, so in enumerate(all_smart_objects):
                        if so_idx in used_smart_object_indices:
                            continue
                        if str(so.get('name', '')).strip().lower() == target_name_lower:
                            matched_index = so_idx
                            match_reason = f"名称精确匹配: '{target_name}'"
                            break

                    if matched_index is None:
                        for so_idx, so in enumerate(all_smart_objects):
                            if so_idx in used_smart_object_indices:
                                continue
                            so_name = str(so.get('name', ''))
                            if target_name_lower in so_name.lower():
                                matched_index = so_idx
                                match_reason = f"名称包含匹配: '{target_name}'"
                                break

                    if matched_index is None:
                        print(f"⚠️  警告: 配置[{config_idx}] 的名称 '{target_name}' 未匹配到任何未处理智能对象，将按顺序匹配")

                if matched_index is None:
                    for so_idx, _so in enumerate(all_smart_objects):
                        if so_idx not in used_smart_object_indices:
                            matched_index = so_idx
                            break

                if matched_index is None:
                    print(f"⚠️  警告: 配置[{config_idx}] 没有可用的未处理智能对象，已跳过")
                    continue

                so = all_smart_objects[matched_index]
                matched_pairs.append((so, so_config))
                used_smart_object_indices.add(matched_index)
                print(f"✅ 匹配: 智能对象 '{so['name']}' <-> 配置[{config_idx}] ({match_reason})")

            skipped_count = len(all_smart_objects) - len(used_smart_object_indices)
            if skipped_count > 0:
                print(f"ℹ️ 未处理 {skipped_count} 个额外智能对象：配置数组已用完，不再复用配置")

        if smart_objects_config and not matched_pairs:
            doc.close()
            raise ValueError("未能匹配任何智能对象和配置")
        
        print(f"🔗 智能对象匹配: {len(matched_pairs)} 个")
        
        # ========== 打印智能对象详细信息 ==========
        if matched_pairs:
            print("\n" + "=" * 70)
            print("🔗 智能对象处理计划")
            print("=" * 70)
            for i, (so, so_config) in enumerate(matched_pairs, 1):
                _log_detail(f"\n  [{i}/{len(matched_pairs)}] {so['name']}")
                _log_detail(f"      图层路径: {so['path']}")
                _log_detail(f"      图片路径: {so_config['image_path']}")
                _log_detail(f"      缩放模式: {so_config.get('resize_mode', 'contain')}")
                if so_config.get('background_image_path'):
                    _log_detail(f"      背景图: {so_config.get('background_image_path')}")
                _log_detail(f"      分块尺寸: {so_config.get('tile_size', 512)}")
            print("=" * 70)
        
        # ========== 处理所有智能对象 ==========
        processed_count = 0
        failed_pairs = []
        if matched_pairs:
            print("\n" + "=" * 70)
            print("🔄 开始处理")
            print("=" * 70)

            for i, (so, so_config) in enumerate(matched_pairs, 1):
                print(f"\n⏳ [{i}/{len(matched_pairs)}] 正在替换智能对象: {so['name']}...")
                try:
                    image_path = Path(so_config['image_path'])
                    resize_mode = so_config.get('resize_mode', 'contain')
                    tile_size = so_config.get('tile_size', 512)
                    custom_options = so_config.get('custom_options')
                    background_image_path = so_config.get('background_image_path')

                    replace_smart_object_content(
                        session,
                        doc,
                        so['layer'],
                        image_path,
                        export_dir,
                        tile_size,
                        resize_mode,
                        custom_options,
                        Path(background_image_path) if background_image_path else None
                    )
                    print(f"✅ [{i}/{len(matched_pairs)}] 智能对象 '{so['name']}' 已替换")
                    processed_count += 1

                    # 确保回到主文档（每个替换操作后）
                    try:
                        time.sleep(0.3)
                        current_active = session.active_document
                        if current_active != doc:
                            doc.activeLayer = so['layer']
                            print(f"    ✅ 已确保回到主文档")
                    except Exception as e:
                        print(f"    ⚠️ 警告: 检查主文档时出错: {e}")

                except Exception as e:
                    print(f"❌ [{i}/{len(matched_pairs)}] 处理智能对象 '{so['name']}' 时出错: {e}")
                    import traceback
                    traceback.print_exc()
                    failed_pairs.append({
                        "index": i,
                        "name": so.get("name"),
                        "path": so.get("path"),
                        "image_path": so_config.get("image_path"),
                        "error": str(e),
                    })
                    # 继续处理下一个智能对象
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
            try:
                doc.close()
            except Exception as close_error:
                print(f"⚠️ 关闭主文档时出错: {close_error}")
            raise RuntimeError(
                "智能对象替换未全部成功，已取消导出，"
                f"成功 {processed_count}/{len(matched_pairs)}，失败 {len(failed_pairs)}。"
            )

        # 确保活动文档是主文档
        if matched_pairs:
            try:
                time.sleep(0.3)
                current_active = session.active_document
                if current_active != doc:
                    if matched_pairs:
                        doc.activeLayer = matched_pairs[0][0]['layer']
                        print(f"    ✅ 已激活主文档和目标图层")
            except Exception as e:
                print(f"    ⚠️ 警告: 检查活动文档时出错: {e}")
        
        applied_color_layers = []
        if color_layer_configs:
            print("\n" + "=" * 70)
            print("🎨 颜色控制图层")
            print("=" * 70)
            if COLOR_LAYER_PROCESSING_ENABLED:
                print("⚠️ 颜色图层处理开关已开启，但当前版本未接入执行逻辑")
            else:
                print(
                    f"⚠️ 颜色图层处理已临时停用，已忽略 {len(color_layer_configs)} 个颜色图层配置，"
                    "避免错误和额外耗时"
                )
            print("=" * 70)

        # ========== 查找画板并导出 ==========
        # 参考 erpfile.py 的原理：直接使用 doc.layerSets 获取所有图层组（画板）
        print(f"\n" + "=" * 70)
        print("🎨 检查画板（使用 doc.layerSets 方法）")
        print("=" * 70)
        print(f"PSD 文件路径: {psd_path}")
        print(f"文档名称: {doc.name if hasattr(doc, 'name') else '未知'}")
        
        export_paths = []  # 存储所有导出路径
        
        # 方法1: 直接使用 doc.layerSets（参考 erpfile.py）
        layer_sets = []
        try:
            if hasattr(doc, 'layerSets'):
                layer_sets = list(doc.layerSets) if hasattr(doc.layerSets, '__iter__') else [doc.layerSets]
                print(f"✅ 使用 doc.layerSets 找到 {len(layer_sets)} 个图层组（画板）")
                for i, ls in enumerate(layer_sets, 1):
                    ls_name = ls.name if hasattr(ls, 'name') else "未知"
                    print(f"   图层组[{i}]: {ls_name}")
        except Exception as e:
            print(f"⚠️ 使用 doc.layerSets 失败: {e}")
            layer_sets = []
        
        # 方法2: 如果 layerSets 为空，尝试使用分析服务查找
        if not layer_sets:
            print(f"\n尝试使用分析服务查找画板...")
            artboards = find_artboard_layers(doc, psd_path=psd_path, debug=True)
            if artboards:
                # 将分析服务找到的画板转换为图层组列表
                layer_sets = [ab['layer'] for ab in artboards]
                print(f"✅ 通过分析服务找到 {len(layer_sets)} 个画板")
        
        # 如果有图层组（画板），逐个导出
        if layer_sets:
            print(f"\n🎨 找到 {len(layer_sets)} 个图层组（画板），开始导出")
            _log_detail("=" * 70)
            
            # 保存所有图层组的可见性状态（用于后续恢复）
            original_visibility = {}
            try:
                for ls in layer_sets:
                    try:
                        ls_name = ls.name if hasattr(ls, 'name') else "未知"
                        original_visibility[ls_name] = ls.visible if hasattr(ls, 'visible') else True
                    except Exception:
                        continue
                _log_detail(f"    ✅ 已保存 {len(original_visibility)} 个图层组的可见性状态")
            except Exception as e:
                print(f"    ⚠️ 警告: 保存图层可见性时出错: {e}")
            
            # 强制循环：确保每个图层组都被处理（参考 erpfile.py，但去掉 break）
            _log_detail(f"\n🔄 开始循环处理 {len(layer_sets)} 个图层组（画板）...")
            _log_detail(f"   图层组列表:")
            for idx, ls in enumerate(layer_sets, 1):
                ls_name = ls.name if hasattr(ls, 'name') else "未知"
                _log_detail(f"     [{idx}] {ls_name}")
            _log_detail(f"   将逐个处理以上 {len(layer_sets)} 个图层组\n")
            
            for i, artboard_layer in enumerate(layer_sets, 1):
                # 获取图层组名称
                try:
                    artboard_name = artboard_layer.name if hasattr(artboard_layer, 'name') else f"图层组{i}"
                except Exception:
                    artboard_name = f"图层组{i}"
                
                print(f"⏳ 导出画板 [{i}/{len(layer_sets)}]: {artboard_name}")
                _log_detail("=" * 70)
                _log_detail(f"🔍 循环验证: 这是第 {i} 个图层组，共 {len(layer_sets)} 个")
                _log_detail(f"   图层组名称: '{artboard_name}'")
                _log_detail(f"   图层对象: {type(artboard_layer).__name__}")
                
                # 强制确保每个图层组都有唯一的文件名（使用索引）
                try:
                    # 生成导出文件名（确保唯一性）
                    if output_filename is None:
                        base_name = _safe_filename_part(psd_path.stem, fallback="psd", max_length=80)
                        safe_artboard_name = _safe_filename_part(artboard_name, fallback=f"artboard{i}", max_length=60)
                        # 使用索引确保文件名唯一，即使图层组名称相同
                        artboard_export_filename = f"{base_name}_artboard{i}_{safe_artboard_name}_export.png"
                    else:
                        # 如果指定了文件名，在文件名和扩展名之间插入图层组索引和名称
                        output_path = Path(_safe_png_filename(output_filename))
                        safe_artboard_name = _safe_filename_part(artboard_name, fallback=f"artboard{i}", max_length=60)
                        # 使用索引确保唯一性
                        artboard_export_filename = f"{output_path.stem}_artboard{i}_{safe_artboard_name}{output_path.suffix}"
                    
                    artboard_export_path = export_dir / artboard_export_filename
                    _log_detail(f"    📝 导出文件名: {artboard_export_filename}")
                    _log_detail(f"    📁 完整路径: {artboard_export_path}")
                    _log_detail(f"    🔢 画板索引: {i}/{len(layer_sets)}")
                    
                    # 检查权限
                    has_permission, perm_error = check_write_permission(artboard_export_path)
                    if not has_permission:
                        print(f"    ❌ 权限检查失败: {perm_error}")
                        print(f"    ⚠️ 跳过图层组 [{i}/{len(layer_sets)}]: {artboard_name}")
                        export_paths.append(None)  # 占位，表示这个图层组导出失败
                        continue
                    _log_detail(f"    ✅ 权限检查通过")
                    
                    # 确保导出目录存在
                    artboard_export_path.parent.mkdir(parents=True, exist_ok=True)
                    _log_detail(f"    ✅ 导出目录已准备")
                    
                    # 参考 erpfile.py 的原理：先隐藏所有图层组，然后只显示当前图层组
                    try:
                        _log_detail(f"    🔄 正在设置图层可见性")
                        _log_detail(f"       目标图层组名称: '{artboard_name}'")
                        
                        # 先隐藏所有图层组
                        _log_detail(f"       步骤1: 隐藏所有图层组...")
                        for ls in layer_sets:
                            try:
                                ls_name = ls.name if hasattr(ls, 'name') else "未知"
                                if hasattr(ls, 'visible'):
                                    ls.visible = False
                                    _log_detail(f"           🔒 隐藏: '{ls_name}'")
                            except Exception as e:
                                print(f"           ⚠️ 隐藏图层组时出错: {e}")
                        
                        # 只显示当前图层组
                        _log_detail(f"       步骤2: 只显示当前图层组 '{artboard_name}'...")
                        artboard_layer.visible = True
                        _log_detail(f"           ✅ 显示: '{artboard_name}'")
                        
                        # 验证可见性
                        _log_detail(f"       步骤3: 验证可见性...")
                        visible_count = 0
                        visible_names = []
                        for ls in layer_sets:
                            try:
                                if hasattr(ls, 'visible') and ls.visible:
                                    visible_count += 1
                                    ls_name = ls.name if hasattr(ls, 'name') else "未知"
                                    visible_names.append(ls_name)
                            except Exception:
                                pass
                        
                        _log_detail(f"           可见图层组数量: {visible_count}")
                        _log_detail(f"           可见图层组: {visible_names}")
                        
                        if visible_count == 1 and visible_names[0] == artboard_name:
                            _log_detail(f"           ✅ 验证通过: 只有目标图层组 '{artboard_name}' 可见")
                        else:
                            print(f"           ⚠️ 警告: 可见性设置可能不正确")
                            print(f"              预期: 只有 '{artboard_name}' 可见")
                            print(f"              实际: {visible_names}")
                        
                        # 选中当前图层组
                        doc.activeLayer = artboard_layer
                        _log_detail(f"    ✅ 已选中图层组: {artboard_name}")
                        
                        # 等待一下，让 PS 完成可见性设置
                        time.sleep(1.5)  # 增加等待时间，确保可见性设置生效
                        
                    except Exception as e:
                        print(f"    ⚠️ 警告: 设置图层可见性时出错: {e}")
                        import traceback
                        traceback.print_exc()
                        # 继续尝试导出
                    
                    # 导出画板
                    _log_detail(f"    📤 正在导出到: {artboard_export_path}")
                    try:
                        # 使用 ExportOptionsSaveForWeb 导出（只导出可见内容，按画板尺寸）
                        options = session.ExportOptionsSaveForWeb()
                        options.format = 13  # PNG
                        options.PNG8 = False  # PNG-24
                        options.transparency = True
                        options.interlaced = False
                        options.compression = 6

                        export_file_path_str = str(artboard_export_path)
                        _log_detail(f"       导出路径: {export_file_path_str}")

                        doc.exportDocument(
                            export_file_path_str,
                            exportAs=session.ExportType.SaveForWeb,
                            options=options,
                        )
                        _log_detail(f"    ✅ exportDocument 调用成功 (SaveForWeb)")

                        # 等待文件写入完成
                        time.sleep(2.0)  # 增加等待时间，确保文件写入完成
                        
                        # 检查文件是否存在
                        # 注意：SaveForWeb 可能会修改文件名（添加扩展名或修改名称）
                        # Photoshop 会自动清理文件名中的特殊字符（空格、括号等）替换为 `-`
                        # 所以我们需要检查多种可能的文件名
                        max_retries = 10
                        retry_count = 0
                        actual_export_path = None
                        
                        # 生成文件名变体（Photoshop 可能会修改特殊字符）
                        # 将文件名中的空格、括号等特殊字符替换为 `-`（Photoshop 的行为）
                        sanitized_name = re.sub(r'[ ()\[\]]+', '-', artboard_export_filename)
                        sanitized_name = re.sub(r'-+', '-', sanitized_name)  # 多个 `-` 合并为一个
                        sanitized_name = sanitized_name.strip('-')  # 去掉首尾的 `-`
                        
                        # 可能的文件名变体
                        possible_paths = [
                            artboard_export_path,  # 原始路径
                            export_dir / sanitized_name,  # Photoshop 清理后的文件名
                            export_dir / f"{artboard_export_path.stem}.png",  # 可能去掉后缀
                            export_dir / artboard_export_filename,  # 原始文件名
                        ]
                        
                        # 如果原始路径没有 .png 扩展名，添加它
                        if not artboard_export_path.suffix.lower() == '.png':
                            possible_paths.append(export_dir / f"{artboard_export_path.stem}.png")
                        
                        _log_detail(f"       检查可能的文件路径:")
                        for pp in possible_paths:
                            _log_detail(f"          - {pp}")
                        
                        while retry_count < max_retries and actual_export_path is None:
                            for pp in possible_paths:
                                if pp.exists():
                                    actual_export_path = pp
                                    _log_detail(f"       找到文件: {actual_export_path}")
                                    break
                            
                            if actual_export_path is None:
                                retry_count += 1
                                time.sleep(0.5)
                                if retry_count < max_retries:
                                    _log_detail(f"       等待文件生成... ({retry_count}/{max_retries})")
                        
                        # 如果还是找不到，尝试在目录中搜索匹配的文件（基于时间戳和基本名称）
                        if actual_export_path is None:
                            _log_detail(f"       ⚠️ 未找到预期文件，尝试在目录中搜索匹配的文件...")
                            try:
                                # 提取时间戳部分（格式：_20251229_130113_085）
                                timestamp_match = re.search(r'_(\d{8}_\d{6}_\d{3})', artboard_export_filename)
                                if timestamp_match:
                                    timestamp = timestamp_match.group(1)
                                    # 搜索包含相同时间戳和画板标识的文件
                                    search_pattern = f"*{timestamp}*artboard*画板*.png"
                                    matching_files = list(export_dir.glob(search_pattern))
                                    if matching_files:
                                        # 按修改时间排序，取最新的
                                        matching_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
                                        actual_export_path = matching_files[0]
                                        _log_detail(f"       找到匹配的文件: {actual_export_path}")
                            except Exception as search_error:
                                _log_detail(f"       搜索文件时出错: {search_error}")
                        
                        # 如果还是找不到，列出导出目录中的所有文件，帮助调试
                        if actual_export_path is None:
                            _log_detail(f"       ⚠️ 未找到预期文件，列出导出目录中的所有文件:")
                            try:
                                dir_files = list(export_dir.glob("*"))
                                if dir_files:
                                    # 只列出最近的文件（可能相关的）
                                    dir_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
                                    for df in dir_files[:20]:  # 只显示最近20个文件
                                        _log_detail(f"          - {df.name} ({df.stat().st_size} 字节)")
                                else:
                                    _log_detail(f"          (目录为空)")
                            except Exception as e:
                                _log_detail(f"          (无法列出目录: {e})")
                        
                        if actual_export_path and actual_export_path.exists():
                            # 如果实际文件路径与预期不同，更新它
                            if actual_export_path != artboard_export_path:
                                _log_detail(f"       ⚠️ 注意: 实际文件路径与预期不同")
                                _log_detail(f"          预期: {artboard_export_path}")
                                _log_detail(f"          实际: {actual_export_path}")
                                artboard_export_path = actual_export_path
                            file_size = artboard_export_path.stat().st_size
                            file_size_mb = file_size / 1024 / 1024
                            export_paths.append(artboard_export_path)
                            print(f"✅ 画板 [{i}/{len(layer_sets)}] 导出成功: {artboard_export_path.name} ({file_size_mb:.2f} MB)")
                            _log_detail(f"    📊 当前成功导出: {len([p for p in export_paths if p is not None])}/{len(layer_sets)} 个文件")
                        else:
                            print(f"    ❌❌❌ 错误: 导出文件不存在! ❌❌❌")
                            print(f"       预期路径: {artboard_export_path}")
                            print(f"       已重试 {max_retries} 次，文件仍未生成")
                            print(f"       图层组 [{i}/{len(layer_sets)}]: {artboard_name}")
                            print(f"       可能原因:")
                            print(f"         1. Photoshop 导出失败但未报错")
                            print(f"         2. 文件路径权限问题")
                            print(f"         3. 磁盘空间不足")
                            export_paths.append(None)  # 占位，表示这个图层组导出失败
                            
                    except Exception as export_error:
                        print(f"    ❌❌❌ 导出调用失败: {export_error} ❌❌❌")
                        print(f"       图层组 [{i}/{len(layer_sets)}]: {artboard_name}")
                        import traceback
                        traceback.print_exc()
                        export_paths.append(None)  # 占位，表示这个图层组导出失败
                        continue
                        
                except Exception as e:
                    print(f"    ❌❌❌ 导出图层组 '{artboard_name}' 时发生异常: {e} ❌❌❌")
                    print(f"       图层组 [{i}/{len(layer_sets)}]: {artboard_name}")
                    import traceback
                    traceback.print_exc()
                    export_paths.append(None)  # 占位，表示这个图层组导出失败
                    continue
                
                # 循环结束标记
                _log_detail(f"\n    ✅ 图层组 [{i}/{len(layer_sets)}] 处理完成（无论成功或失败）")
                _log_detail(f"    📊 当前进度: 已处理 {i}/{len(layer_sets)} 个图层组")
                _log_detail(f"    📊 当前成功导出: {len([p for p in export_paths if p is not None])} 个文件")
            
            # 循环完成验证
            _log_detail(f"\n" + "=" * 70)
            _log_detail(f"🔄 循环处理完成验证")
            _log_detail("=" * 70)
            _log_detail(f"   预期处理图层组数: {len(layer_sets)}")
            _log_detail(f"   实际循环次数: {i} (应该等于 {len(layer_sets)})")
            _log_detail(f"   导出路径列表长度: {len(export_paths)} (应该等于 {len(layer_sets)})")
            if len(export_paths) != len(layer_sets):
                print(f"   ❌ 错误: 导出路径数量 ({len(export_paths)}) 不等于图层组数量 ({len(layer_sets)})")
            else:
                _log_detail(f"   ✅ 验证通过: 所有图层组都已处理")
            _log_detail("=" * 70)
            
            # 导出完成后，统计结果
            print(f"\n📊 图层组导出统计")
            successful_exports = [p for p in export_paths if p is not None]
            failed_exports = len(export_paths) - len(successful_exports)
            print(f"   总图层组数: {len(layer_sets)}")
            print(f"   成功导出: {len(successful_exports)}")
            print(f"   失败数量: {failed_exports}")
            
            # 强制确保返回数量等于图层组数量
            if len(export_paths) != len(layer_sets):
                print(f"   ⚠️ 警告: 导出路径数量 ({len(export_paths)}) 不等于图层组数量 ({len(layer_sets)})")
                print(f"   正在修复: 补充占位符以确保数量一致...")
                # 补充 None 占位符，确保数量一致
                while len(export_paths) < len(layer_sets):
                    export_paths.append(None)
                    print(f"      补充了 1 个占位符，当前数量: {len(export_paths)}")
                # 如果多了，截断（理论上不应该发生）
                if len(export_paths) > len(layer_sets):
                    export_paths = export_paths[:len(layer_sets)]
                    print(f"      截断到 {len(layer_sets)} 个")
                print(f"   ✅ 修复完成: 现在返回 {len(export_paths)} 个路径（等于图层组数量）")
            
            # 重要：固定返回和分析出的画板一样数量的文件（包括失败的占位符）
            # 不筛选掉 None，保持所有路径（成功的是 Path 对象，失败的是 None）
            _log_detail(f"   📋 最终返回: {len(export_paths)} 个路径（成功: {len(successful_exports)}, 失败: {failed_exports}）")
            
            # 恢复所有图层组的可见性
            try:
                _log_detail(f"\n    🔄 正在恢复图层组可见性...")
                restored_count = 0
                for ls in layer_sets:
                    try:
                        ls_name = ls.name if hasattr(ls, 'name') else "未知"
                        if ls_name in original_visibility and hasattr(ls, 'visible'):
                            ls.visible = original_visibility[ls_name]
                            restored_count += 1
                    except Exception as e:
                        print(f"        ⚠️ 恢复图层组 '{ls_name}' 可见性时出错: {e}")
                        continue
                _log_detail(f"    ✅ 已恢复 {restored_count}/{len(layer_sets)} 个图层组的可见性")
            except Exception as e:
                print(f"    ⚠️ 警告: 恢复图层组可见性时出错: {e}")
        else:
            # 没有画板：按原来的逻辑导出一张图
            print("未找到画板，将导出整张文档")
            print("=" * 70)
            
            if output_filename is None:
                output_filename = f"{_safe_filename_part(psd_path.stem, fallback='psd', max_length=120)}_export.png"
            else:
                output_filename = _safe_png_filename(output_filename)
            
            export_path = export_dir / output_filename
            
            # 检查导出路径的权限
            print(f"\n⏳ 正在导出图片...")
            has_permission, perm_error = check_write_permission(export_path)
            if not has_permission:
                print(f"\n    ❌ 权限检查失败: {perm_error}")
                doc.close()
                raise PermissionError(f"导出路径没有写入权限: {perm_error}")
            
            print(f"    ✅ 权限检查通过")
            
            try:
                # 确保导出目录存在
                export_path.parent.mkdir(parents=True, exist_ok=True)
                
                options = session.ExportOptionsSaveForWeb()
                options.format = 13  # PNG
                options.PNG8 = False  # PNG-24
                options.transparency = True
                options.interlaced = False
                options.compression = 6
                print(f"    导出路径: {export_path}")
                doc.exportDocument(
                    str(export_path),
                    exportAs=session.ExportType.SaveForWeb,
                    options=options,
                )
                print(f"    ✅ 导出成功")
                export_paths.append(export_path)
            except Exception as e:
                print(f"\n❌ 导出失败: {e}")
                import traceback
                traceback.print_exc()
                doc.close()
                raise
        
        print(f"\n" + "=" * 70)
        print("✅ 最终处理结果")
        print("=" * 70)
        # 计算当前处理时间（用于中间显示）
        current_processing_time = time.time() - start_time
        print(f"处理耗时: {current_processing_time:.2f} 秒")
        print(f"共导出 {len(export_paths)} 个文件:")
        if export_paths:
            for i, path in enumerate(export_paths, 1):
                if path and path.exists():
                    file_size_mb = path.stat().st_size / 1024 / 1024
                    print(f"  ✅ [{i}] {path.name} ({file_size_mb:.2f} MB)")
                    print(f"     完整路径: {path}")
                elif path:
                    print(f"  ❌ [{i}] {path.name} (文件不存在)")
                else:
                    print(f"  ❌ [{i}] (导出失败)")
        else:
            print(f"  ⚠️ 没有成功导出的文件!")
        print("=" * 70)
        
        # 最终验证：确保如果有图层组，返回数量一致
        if layer_sets:
            successful_count = len([p for p in export_paths if p is not None])
            if successful_count == 0:
                print(f"\n❌❌❌ 严重错误: 找到 {len(layer_sets)} 个图层组（画板），但没有任何文件成功导出! ❌❌❌")
                print(f"   请检查上方的错误日志，找出导出失败的原因")
            elif len(export_paths) != len(layer_sets):
                print(f"\n⚠️ 警告: 找到 {len(layer_sets)} 个图层组，但返回路径数量 ({len(export_paths)}) 不一致")
                print(f"   成功导出: {successful_count} 个文件")
                print(f"   请检查上方的错误日志")
            else:
                print(f"\n✅ 验证通过: 返回 {len(export_paths)} 个路径（等于图层组数量 {len(layer_sets)}）")
                print(f"   成功导出: {successful_count} 个文件")
        
        # 关闭主文档
        try:
            doc.close()
            print(f"主文档已关闭")
        except Exception as e:
            print(f"⚠️ 警告: 关闭主文档时出错: {e}")
    
    # 计算处理时间
    processing_time = time.time() - start_time
    
    import gc
    gc.collect()
    
    # 统一返回列表格式和处理时间
    return (export_paths if export_paths else [], processing_time)
