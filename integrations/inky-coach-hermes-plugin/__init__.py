"""The Coach adds no background hooks or model tools; Paper owns the state."""

from pathlib import Path


def register(ctx):
    """Desktop UI and the existing Paper MCP provide the integration."""
    ctx.register_skill(
        "coach",
        Path(__file__).parent / "skills" / "coach" / "SKILL.md",
        description="用户询问时读取 Inky Paper 工作记录、拆分可选择卡片或生成日总结。",
    )
