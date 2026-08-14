#!/usr/bin/env python3
"""
浏览器自动化 Agent 服务
使用 browser-use 库执行任务
配置通过环境变量传入：BROWSER_AGENT_API_KEY, BROWSER_AGENT_BASE_URL, BROWSER_AGENT_MODEL
"""

import os
import sys
import json
import asyncio
import signal
import logging
from typing import Optional
from contextlib import asynccontextmanager

# 在导入 browser-use 之前清除代理环境变量
for key in list(os.environ.keys()):
    if 'proxy' in key.lower() or 'socks' in key.lower():
        del os.environ[key]
os.environ['no_proxy'] = 'localhost,127.0.0.1,*'
os.environ['NO_PROXY'] = 'localhost,127.0.0.1,*'

import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel

class EndpointFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return record.getMessage().find("/health") == -1

logging.getLogger("uvicorn.access").addFilter(EndpointFilter())

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("browser-agent")

# 从环境变量读取 AI 配置
AI_CONFIG = {
    "api_key": os.environ.get("BROWSER_AGENT_API_KEY", ""),
    "base_url": os.environ.get("BROWSER_AGENT_BASE_URL", "https://api.openai.com/v1"),
    "model": os.environ.get("BROWSER_AGENT_MODEL", "gpt-4o-mini"),
}

logger.info("AI 配置: base_url=%s, model=%s, api_key=%s", 
            AI_CONFIG["base_url"], AI_CONFIG["model"], 
            AI_CONFIG["api_key"][:10] + "..." if AI_CONFIG["api_key"] else "未设置")


# --------------- Models ---------------

class ExecuteTaskRequest(BaseModel):
    task: Optional[str] = None
    instruction: Optional[str] = None
    max_steps: int = 25
    cdp_url: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None
    skill_prompt: Optional[str] = None
    timeout_seconds: int = 280

    def get_task(self) -> str:
        return self.task or self.instruction or ""


class TaskResult(BaseModel):
    success: bool
    final_answer: str
    steps_count: int = 0
    steps: list = []
    error: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    version: str
    config_loaded: bool
    model: str = ""
    base_url: str = ""
    browser_use_available: bool = False
    python_version: str = ""


# --------------- Agent ---------------

BROWSER_EXECUTION_LOCK = asyncio.Lock()

async def detect_cdp_url() -> Optional[str]:
    """检测浏览器 CDP 端口，返回 CDP URL"""
    import aiohttp

    for port in [9333, 9334, 9222]:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"http://127.0.0.1:{port}/json/version",
                    timeout=aiohttp.ClientTimeout(total=2)
                ) as resp:
                    if resp.status == 200:
                        logger.info("检测到浏览器 CDP: port=%d", port)
                        return f"http://127.0.0.1:{port}"
        except:
            pass

    return None


async def execute_with_browser_use(
    task: str,
    max_steps: int = 25,
    cdp_url: Optional[str] = None,
    skill_prompt: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    model: Optional[str] = None,
    timeout_seconds: int = 280,
) -> TaskResult:
    """使用 browser-use 执行任务，连接客户端已有浏览器"""
    try:
        effective_api_key = api_key or AI_CONFIG["api_key"]
        effective_base_url = base_url or AI_CONFIG["base_url"]
        effective_model = model or AI_CONFIG["model"]

        if not effective_api_key:
            return TaskResult(
                success=False,
                final_answer="",
                error="未配置 AI API Key，请在管理后台绑定客户端 Agent 的 AI 配置",
            )

        from browser_use import Agent
        from browser_use.browser.profile import BrowserProfile
        from browser_use.llm.openai.like import ChatOpenAILike

        # ChatOpenAILike: 兼容 OpenAI 格式的自定义 API
        llm = ChatOpenAILike(
            model=effective_model,
            api_key=effective_api_key,
            base_url=effective_base_url,
        )

        # 检测浏览器 CDP
        effective_cdp = cdp_url or AI_CONFIG.get("cdp_url") or await detect_cdp_url()

        if not effective_cdp:
            return TaskResult(
                success=False,
                final_answer="",
                error="未检测到客户端浏览器。MCP 工具应自动启动浏览器，请检查客户端浏览器服务。",
            )

        browser_profile = BrowserProfile(cdp_url=effective_cdp)
        logger.info("连接客户端浏览器 CDP: %s", effective_cdp)

        # 如果有 skill_prompt，添加到任务描述中
        effective_task = task
        if skill_prompt:
            effective_task = f"{skill_prompt}\n\n请按照上述指引执行以下任务：\n{task}"
            logger.info("使用 Skill 指引: %s", skill_prompt[:100] + "...")

        # 创建 Agent（官方入口）
        agent = Agent(
            task=effective_task,
            llm=llm,
            browser_profile=browser_profile,
            max_actions_per_step=max_steps,
            use_vision=False,  # 禁用截图，避免 413 请求体过大
        )

        # 同一 CDP 浏览器只允许一个 Agent 操作，并限制最长执行时间。
        async with BROWSER_EXECUTION_LOCK:
            agent_result = await asyncio.wait_for(
                agent.run(max_steps=max_steps),
                timeout=max(30, min(timeout_seconds, 280)),
            )

        # 用官方 API 判断结果
        is_done = agent_result.is_done() if agent_result else False
        is_successful = agent_result.is_successful() if agent_result else None
        final_answer = agent_result.final_result() if agent_result else ""
        errors = agent_result.errors() if agent_result else []

        # 提取步骤详情
        steps = []
        for i, item in enumerate(agent_result.history):
            try:
                output = item.model_output
                if output:
                    actions = []
                    for action in output.action:
                        actions.append(str(action))
                    steps.append({
                        "step": i + 1,
                        "actions": actions,
                    })
            except Exception:
                pass

        return TaskResult(
            success=is_successful is True,
            final_answer=final_answer or "任务已完成",
            steps_count=len(steps),
            steps=steps,
            error="; ".join(str(e) for e in errors[:3]) if errors and not is_successful else None,
        )

    except asyncio.TimeoutError:
        logger.error("browser-use 执行超时: %ss", timeout_seconds)
        return TaskResult(
            success=False,
            final_answer="",
            error=f"browser-use 执行超时（{timeout_seconds}s）",
        )
    except Exception as e:
        logger.error("browser-use 执行失败: %s", e)
        return TaskResult(
            success=False,
            final_answer="",
            error=str(e),
        )


# --------------- FastAPI ---------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("浏览器自动化 Agent 服务启动")
    yield
    logger.info("浏览器自动化 Agent 服务关闭")


app = FastAPI(title="Browser Agent", lifespan=lifespan)


@app.get("/health", response_model=HealthResponse)
async def health():
    browser_use_ok = False
    try:
        import browser_use
        browser_use_ok = True
    except ImportError:
        pass

    return HealthResponse(
        status="ok",
        version="1.0.0",
        config_loaded=bool(AI_CONFIG["api_key"]),
        model=AI_CONFIG.get("model", ""),
        base_url=AI_CONFIG.get("base_url", ""),
        browser_use_available=browser_use_ok,
        python_version=f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
    )


@app.post("/execute", response_model=TaskResult)
async def execute(req: ExecuteTaskRequest):
    task = req.get_task()
    if not task:
        return TaskResult(success=False, final_answer="", error="缺少 task 或 instruction 参数")

    result = await execute_with_browser_use(
        task=task,
        max_steps=req.max_steps,
        cdp_url=req.cdp_url,
        skill_prompt=req.skill_prompt,
        api_key=req.api_key,
        base_url=req.base_url,
        model=req.model,
        timeout_seconds=req.timeout_seconds,
    )
    return result


@app.post("/config")
async def update_config(config: dict):
    """更新 AI 配置（客户端启动时调用）"""
    if "api_key" in config:
        AI_CONFIG["api_key"] = config["api_key"]
    if "base_url" in config:
        AI_CONFIG["base_url"] = config["base_url"]
    if "model" in config:
        AI_CONFIG["model"] = config["model"]
    if "cdp_url" in config:
        AI_CONFIG["cdp_url"] = config["cdp_url"]

    logger.info("AI 配置已更新: model=%s, base_url=%s, cdp_url=%s", 
                AI_CONFIG["model"], AI_CONFIG["base_url"], AI_CONFIG.get("cdp_url", ""))
    return {"status": "ok", "config": AI_CONFIG}


@app.post("/shutdown")
async def shutdown():
    return {"status": "shutting_down"}


def main():
    port = int(os.environ.get("PORT", "1596"))
    host = os.environ.get("HOST", "127.0.0.1")

    def _handle_signal(sig, frame):
        logger.info("收到信号 %s，准备关闭", sig)

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    logger.info("浏览器自动化 Agent 服务启动在 %s:%d", host, port)
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
