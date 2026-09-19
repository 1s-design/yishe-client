# -*- mode: python ; coding: utf-8 -*-


import os

def collect_src_datas():
    """收集 src 目录下的 .py 文件，排除 __pycache__"""
    datas = []
    src_dir = 'src'
    for root, dirs, files in os.walk(src_dir):
        # 排除 __pycache__ 目录
        dirs[:] = [d for d in dirs if d != '__pycache__']
        for f in files:
            if f.endswith('.py'):
                full_path = os.path.join(root, f)
                # 目标路径保持 src/xxx 结构
                dest_dir = os.path.dirname(full_path)
                datas.append((full_path, dest_dir))
    return datas

a = Analysis(
    ['ps.py'],
    pathex=[],
    binaries=[],
    datas=collect_src_datas(),
    hiddenimports=[
        # src 模块
        'src',
        'src.api_server',
        'src.psd_exporter',
        'src.smart_object_replacer',
        'src.layer_finder',
        'src.color_layer_service',
        'src.photoshop_service',
        'src.psd_parser',
        # src.services 模块
        'src.services',
        'src.services.photoshop_status_service',
        'src.services.psd_analysis_service',
        'src.services.runtime_psd_analysis_service',
        # src.utils 模块
        'src.utils',
        'src.utils.file_utils',
        'src.utils.image_utils',
        'src.utils.permission_utils',
        'src.utils.photoshop_diagnostics',
        'src.utils.photoshop_process',
        # FastAPI 相关
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        # pydantic 相关
        'pydantic._internal',
        'pydantic._internal._generate_schema',
        # 其他可能需要的（如果安装了的话）
        'comtypes',
        'comtypes.client',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='ps',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
