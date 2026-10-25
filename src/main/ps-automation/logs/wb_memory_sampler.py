# -*- coding: utf-8 -*-
"""Independent memory sampler: system commit via psutil + PS automation /memoryStatus.
Survives client death (does not depend on port 1595 to keep logging)."""
import json
import time
import datetime
import urllib.request
import psutil

LOG = "D:/workspace/yishe-client/src/main/ps-automation/logs/memory-watch-20261024.log"
THRESH_SYS_PCT = 90.0
THRESH_PS_GB = 6.0
INTERVAL = 120


import ctypes


class MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]


def get_commit():
    st = MEMORYSTATUSEX()
    st.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st))
    total = st.ullTotalPageFile / 2**30
    used = (st.ullTotalPageFile - st.ullAvailPageFile) / 2**30
    return used, total


def fetch_memory_status(timeout=6):
    try:
        with urllib.request.urlopen("http://localhost:1595/memoryStatus", timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except Exception as e:
        return {"error": str(e)[:120]}


def sample():
    commit_used, commit_limit = get_commit()
    sys_pct = commit_used / commit_limit * 100 if commit_limit else 0
    top = []
    for p in psutil.process_iter(["name", "memory_info"]):
        try:
            mi = p.info["memory_info"]
            if mi and mi.private / 2**30 > 1.0:
                top.append("%s:%.1fGB" % (p.info["name"], mi.private / 2**30))
        except Exception:
            pass
    status = fetch_memory_status()
    wd = status.get("watchdog") if isinstance(status, dict) else None
    ps_gb = wd.get("photoshop_commit_gb") if wd else None
    active = wd.get("active_jobs") if wd else None
    deferred = wd.get("restart_deferred_seconds") if wd else None

    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = "%s | SYS %.1f/%.1fGB (%.1f%%) | auto=%s" % (
        ts, commit_used, commit_limit, sys_pct,
        "down" if wd is None else ("ps=%s act=%s defer=%s" % (
            "?" if ps_gb is None else "%.2fGB" % ps_gb, active, deferred)))
    if top:
        line += " | top: " + " ".join(sorted(top, key=lambda x: -float(x.split(":")[1][:-2]))[:4])
    alerts = []
    if sys_pct >= THRESH_SYS_PCT:
        alerts.append("!! SYSTEM COMMIT %.1f%% >= %d%%" % (sys_pct, THRESH_SYS_PCT))
    if ps_gb is not None and ps_gb >= THRESH_PS_GB:
        alerts.append("!! PS COMMIT %.2fGB >= %dGB" % (ps_gb, THRESH_PS_GB))
    if wd is None and "error" in status and "10061" not in status["error"]:
        alerts.append("?? memoryStatus: %s" % status["error"])
    if alerts:
        line += " | " + " ; ".join(alerts)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line, flush=True)


def main():
    with open(LOG, "a", encoding="utf-8") as f:
        f.write("==== wb-sampler started %s (sys-level, every %ds) ====\n"
                % (datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), INTERVAL))
    while True:
        try:
            sample()
        except Exception as e:
            with open(LOG, "a", encoding="utf-8") as f:
                f.write("%s | sampler-error: %r\n"
                        % (datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), e))
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
