#!/usr/bin/env python3
"""Project-local manual task runtime."""

from __future__ import annotations

import argparse
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_CONFIG = {
    "task_root": ".agent/tasks",
    "archive_root": ".agent/archive",
    "current_task_file": ".agent/current-task",
    "runtime_root": ".agent/runtime",
}

STATUSES = ("planning", "ready", "in_progress", "verifying", "capturing", "done", "archived")
PHASES = ("start", "plan", "prepare", "execute", "verify", "capture", "finish")

TASK_FILE_TEMPLATES = {
    "prd.md": "---\nphase: plan\nsource_skills: []\nstatus: draft\n---\n\n# PRD\n\n## Problem Statement\n\n## Solution\n\n## User Stories\n\n## Implementation Decisions\n\n## Testing Decisions\n\n## Out of Scope\n\n## Further Notes\n",
    "implement.jsonl": "",
    "check.jsonl": "",
    "verification.md": "---\nphase: verify\nsource_skills: []\nstatus: draft\n---\n\n# Verification\n\n## Checks\n\n## Results\n\n## Fixes\n\n## Unresolved Risks\n",
    "capture.md": "---\nphase: capture\nsource_skills: []\nstatus: draft\n---\n\n# Capture\n\n## Learnings\n\n## Project Doc Updates\n\n## Follow-ups\n",
    "journal.md": "# Journal\n\n",
}

REQUIRED_PRD_HEADINGS = (
    "Problem Statement",
    "Solution",
    "User Stories",
    "Implementation Decisions",
    "Testing Decisions",
    "Out of Scope",
    "Further Notes",
)


class TaskError(RuntimeError):
    """Expected runtime error shown without a traceback."""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def slugify(title: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", title.strip().lower()).strip("-")
    return slug or "task"


def project_root() -> Path:
    return Path.cwd()


def read_config(root: Path) -> dict[str, str]:
    config = dict(DEFAULT_CONFIG)
    config_path = root / ".agent" / "config.yaml"
    if not config_path.exists():
        return config
    for raw_line in config_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or ":" not in line or line.startswith("-"):
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip().strip('"\'')
        if key in config and value:
            config[key] = value
    return config


def task_root(root: Path, config: dict[str, str]) -> Path:
    return root / config["task_root"]


def current_task_path(root: Path, config: dict[str, str]) -> Path:
    return root / config["current_task_file"]


def task_dir(root: Path, config: dict[str, str], slug: str) -> Path:
    return task_root(root, config) / slug


def archive_root(root: Path, config: dict[str, str]) -> Path:
    return root / config["archive_root"]


def task_json_path(path: Path) -> Path:
    return path / "task.json"


def read_task(path: Path) -> dict[str, Any]:
    metadata_path = task_json_path(path)
    if not metadata_path.exists():
        raise TaskError(f"Task metadata not found: {metadata_path}")
    return json.loads(metadata_path.read_text(encoding="utf-8"))


def write_task(path: Path, metadata: dict[str, Any]) -> None:
    task_json_path(path).write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def current_slug(root: Path, config: dict[str, str]) -> str | None:
    path = current_task_path(root, config)
    if not path.exists():
        return None
    slug = path.read_text(encoding="utf-8").strip()
    return slug or None


def require_slug(root: Path, config: dict[str, str], slug: str | None) -> str:
    resolved = slug or current_slug(root, config)
    if not resolved:
        raise TaskError("No task specified and .agent/current-task is empty.")
    return resolved


def set_current(root: Path, config: dict[str, str], slug: str) -> None:
    path = current_task_path(root, config)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(slug + "\n", encoding="utf-8")


def clear_current(root: Path, config: dict[str, str], slug: str) -> None:
    path = current_task_path(root, config)
    if path.exists() and path.read_text(encoding="utf-8").strip() == slug:
        path.write_text("", encoding="utf-8")


def is_unfinished(metadata: dict[str, Any]) -> bool:
    return metadata.get("status") not in ("done", "archived")


def active_unfinished_task(root: Path, config: dict[str, str]) -> tuple[str, dict[str, Any]] | None:
    slug = current_slug(root, config)
    if not slug:
        return None
    path = task_dir(root, config, slug)
    if not path.exists():
        return None
    metadata = read_task(path)
    if is_unfinished(metadata):
        return slug, metadata
    return None


def create_task(args: argparse.Namespace) -> int:
    root = project_root()
    config = read_config(root)
    active = active_unfinished_task(root, config)
    if active and not args.force:
        slug, metadata = active
        raise TaskError(
            f"Active unfinished task exists: {slug} ({metadata.get('status')}). "
            "Use --force to create a new task and switch current-task."
        )

    slug = args.slug or slugify(args.title)
    path = task_dir(root, config, slug)
    if path.exists() and not args.force:
        raise TaskError(f"Task already exists: {slug}. Use --force to switch current-task.")
    path.mkdir(parents=True, exist_ok=True)
    (path / "research").mkdir(exist_ok=True)

    for filename, content in TASK_FILE_TEMPLATES.items():
        file_path = path / filename
        if not file_path.exists():
            file_path.write_text(content, encoding="utf-8")

    metadata_path = task_json_path(path)
    if metadata_path.exists():
        metadata = read_task(path)
    else:
        timestamp = now_iso()
        metadata = {
            "title": args.title,
            "slug": slug,
            "status": "planning",
            "created_at": timestamp,
            "updated_at": timestamp,
            "phases": {phase: {"completed": False, "completed_at": None} for phase in PHASES},
        }
        write_task(path, metadata)

    set_current(root, config, slug)
    print(f"Created task: {slug}")
    print(f"Status: {metadata['status']}")
    print(f"Path: {path.relative_to(root)}")
    print(f"Current task: {slug}")
    return 0


def show_current(args: argparse.Namespace) -> int:
    root = project_root()
    config = read_config(root)
    slug = current_slug(root, config)
    if not slug:
        raise TaskError("No current task set.")
    print(slug)
    return 0


def set_current_command(args: argparse.Namespace) -> int:
    root = project_root()
    config = read_config(root)
    path = task_dir(root, config, args.slug)
    if not path.exists():
        raise TaskError(f"Task does not exist: {args.slug}")
    set_current(root, config, args.slug)
    print(f"Current task: {args.slug}")
    return 0


def show_status(args: argparse.Namespace) -> int:
    root = project_root()
    config = read_config(root)
    slug = require_slug(root, config, args.task)
    path = task_dir(root, config, slug)
    metadata = read_task(path)
    print(f"Task: {metadata.get('title')} ({slug})")
    print(f"Status: {metadata.get('status')}")
    print(f"Path: {path.relative_to(root)}")
    print("Phases:")
    phases = metadata.get("phases", {})
    for phase in PHASES:
        completed = bool(phases.get(phase, {}).get("completed"))
        marker = "x" if completed else " "
        print(f"  [{marker}] {phase}")
    return 0


def file_has_body(path: Path) -> bool:
    if not path.exists():
        return False
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and not stripped.startswith("---"):
            return True
    return False


def directory_has_files(path: Path) -> bool:
    return path.exists() and any(child.is_file() for child in path.rglob("*"))


def jsonl_is_non_empty(path: Path) -> bool:
    if not path.exists():
        return False
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            try:
                data = json.loads(stripped)
                if isinstance(data, dict) and data:
                    return True
            except json.JSONDecodeError:
                continue
    return False


def print_check(label: str, passed: bool) -> None:
    marker = "x" if passed else " "
    print(f"  [{marker}] {label}")


def inspect_phase(args: argparse.Namespace) -> int:
    root = project_root()
    config = read_config(root)
    slug = require_slug(root, config, args.task)
    path = task_dir(root, config, slug)
    metadata = read_task(path)
    phase = args.phase

    print(f"Task: {metadata.get('title')} ({slug})")
    print(f"Status: {metadata.get('status')}")
    print(f"Phase inspection: {phase}")
    print("Checklist:")

    if phase == "plan":
        print_check("prd.md exists", (path / "prd.md").exists())
        print_check("prd.md has required sections", prd_sections_complete(path / "prd.md"))
        print_check("research/ exists", (path / "research").is_dir())
        next_skill = "agentic-task-plan"
    elif phase == "prepare":
        print_check("implement.jsonl exists", (path / "implement.jsonl").exists())
        print_check("implement.jsonl has entries", jsonl_is_non_empty(path / "implement.jsonl"))
        print_check("check.jsonl exists", (path / "check.jsonl").exists())
        print_check("check.jsonl has entries", jsonl_is_non_empty(path / "check.jsonl"))
        next_skill = "agentic-task-prepare"
    elif phase == "execute":
        print_check("implement.jsonl exists", (path / "implement.jsonl").exists())
        print_check("implement.jsonl has entries", jsonl_is_non_empty(path / "implement.jsonl"))
        next_skill = "agentic-task-execute"
    elif phase == "verify":
        print_check("verification.md exists", (path / "verification.md").exists())
        print_check("verification results are recorded", file_has_body(path / "verification.md"))
        next_skill = "agentic-task-verify"
    elif phase == "capture":
        print_check("capture.md exists", (path / "capture.md").exists())
        print_check("capture.md has learnings", file_has_body(path / "capture.md"))
        next_skill = "agentic-task-capture"
    elif phase == "finish":
        print_check("journal.md exists", (path / "journal.md").exists())
        print_check("journal entry exists for this task", journal_has_entry_for_task(path / "journal.md", slug))
        print("  [ ] jj working copy policy is satisfied after user-confirmed VCS review")
        print("Finish guidance: run `jj st`, summarize changes and verification, wait for user confirmation, and do not run direct git commands.")
        next_skill = "agentic-task-finish"
    else:
        raise TaskError(f"Unsupported inspection phase: {phase}")

    print(f"Next recommended stage skill: {next_skill}")
    print("This inspection did not mutate task state or artifacts.")
    return 0


def add_inspection_parser(subparsers: argparse._SubParsersAction[argparse.ArgumentParser], phase: str) -> None:
    phase_parser = subparsers.add_parser(phase, help=f"Inspect {phase} phase readiness without mutating state.")
    phase_parser.add_argument("--task", help="Task slug. Defaults to .agent/current-task.")
    phase_parser.set_defaults(func=inspect_phase, phase=phase)


TRANSITIONS = {
    "start": ("planning", "planning"),
    "plan": ("planning", "ready"),
    "prepare": ("ready", "in_progress"),
    "execute": ("in_progress", "verifying"),
    "verify": ("verifying", "capturing"),
    "capture": ("capturing", "done"),
    "finish": ("done", "archived"),
}


def markdown_headings(path: Path) -> set[str]:
    if not path.exists():
        return set()
    headings: set[str] = set()
    in_frontmatter = False
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped == "---":
            in_frontmatter = not in_frontmatter
            continue
        if in_frontmatter:
            continue
        if stripped.startswith("#"):
            headings.add(stripped.lstrip("#").strip())
    return headings


def prd_sections_complete(path: Path) -> bool:
    if not path.exists():
        return False
    headings = markdown_headings(path)
    if not all(heading in headings for heading in REQUIRED_PRD_HEADINGS):
        return False
    return all(section_has_body(path, heading) for heading in REQUIRED_PRD_HEADINGS)


def section_has_body(path: Path, heading: str) -> bool:
    if not path.exists():
        return False
    in_section = False
    in_frontmatter = False
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped == "---":
            in_frontmatter = not in_frontmatter
            continue
        if in_frontmatter:
            continue
        if stripped.startswith("#"):
            current = stripped.lstrip("#").strip()
            if in_section and current != heading:
                return False
            in_section = current == heading
            continue
        if in_section and stripped:
            return True
    return False


def journal_has_entry_for_task(path: Path, slug: str) -> bool:
    if not path.exists():
        return False
    text = path.read_text(encoding="utf-8")
    return f"**Task**: {slug}" in text


def validate_phase(path: Path, phase: str, slug: str) -> list[str]:
    errors: list[str] = []
    if phase == "start":
        return errors
    if phase == "plan":
        if not prd_sections_complete(path / "prd.md"):
            errors.append("prd.md is missing required headings")
    elif phase == "prepare":
        if not jsonl_is_non_empty(path / "implement.jsonl"):
            errors.append("implement.jsonl must contain at least one context entry")
        if not jsonl_is_non_empty(path / "check.jsonl"):
            errors.append("check.jsonl must contain at least one context entry")
    elif phase == "execute":
        if not jsonl_is_non_empty(path / "implement.jsonl"):
            errors.append("implement.jsonl must contain at least one context entry")
    elif phase == "verify":
        if not file_has_body(path / "verification.md"):
            errors.append("verification.md must contain verification results")
    elif phase == "capture":
        if not file_has_body(path / "capture.md"):
            errors.append("capture.md must contain captured learnings")
    elif phase == "finish":
        if not journal_has_entry_for_task(path / "journal.md", slug):
            errors.append("journal.md must contain an entry for this task")
    else:
        errors.append(f"Unknown phase: {phase}")
    return errors


def mark_phase(args: argparse.Namespace) -> int:
    root = project_root()
    config = read_config(root)
    slug = require_slug(root, config, args.task)
    path = task_dir(root, config, slug)
    metadata = read_task(path)
    phase = args.phase
    expected_status, next_status = TRANSITIONS[phase]
    current_status = metadata.get("status")

    if phase == "start" and current_status != "planning":
        raise TaskError("mark start is only valid while status is planning")
    if phase != "start" and current_status != expected_status:
        raise TaskError(
            f"Invalid transition for mark {phase}: expected {expected_status}, got {current_status}"
        )

    validation_errors = validate_phase(path, phase, slug)
    if validation_errors and not args.force:
        raise TaskError("Validation failed: " + "; ".join(validation_errors))
    if validation_errors and args.force:
        print("warning: --force bypassed validation: " + "; ".join(validation_errors))

    timestamp = now_iso()
    metadata["status"] = next_status
    metadata["updated_at"] = timestamp
    metadata.setdefault("phases", {})[phase] = {"completed": True, "completed_at": timestamp}
    write_task(path, metadata)
    print(f"Marked {phase}: {expected_status} -> {next_status}")
    print(f"Task: {slug}")
    return 0


def unique_archive_destination(month_root: Path, slug: str) -> Path:
    destination = month_root / slug
    if not destination.exists():
        return destination
    counter = 2
    while True:
        candidate = month_root / f"{slug}-{counter}"
        if not candidate.exists():
            return candidate
        counter += 1


def archive_task(args: argparse.Namespace) -> int:
    root = project_root()
    config = read_config(root)
    slug = require_slug(root, config, args.task)
    source = task_dir(root, config, slug)
    if not source.exists():
        raise TaskError(f"Task does not exist: {slug}")
    metadata = read_task(source)
    status = metadata.get("status")
    if status not in ("done", "archived") and not args.force:
        raise TaskError(f"Refusing to archive unfinished task {slug} ({status}). Use --force to override.")

    timestamp = now_iso()
    metadata["status"] = "archived"
    metadata["updated_at"] = timestamp
    metadata.setdefault("phases", {})["finish"] = {"completed": True, "completed_at": timestamp}
    write_task(source, metadata)

    month = datetime.now(timezone.utc).strftime("%Y-%m")
    destination_root = archive_root(root, config) / month
    destination_root.mkdir(parents=True, exist_ok=True)
    destination = unique_archive_destination(destination_root, slug)
    shutil.move(str(source), str(destination))
    clear_current(root, config, slug)

    print(f"Archived task: {slug}")
    print(f"Archive path: {destination.relative_to(root)}")
    return 0


def list_tasks(args: argparse.Namespace) -> int:
    root = project_root()
    config = read_config(root)
    current = current_slug(root, config)
    print("Active tasks:")
    active_root = task_root(root, config)
    if active_root.exists():
        for metadata_path in sorted(active_root.glob("*/task.json")):
            metadata = read_task(metadata_path.parent)
            slug = str(metadata.get("slug") or metadata_path.parent.name)
            marker = "*" if slug == current else "-"
            print(f"  {marker} {slug} [{metadata.get('status')}]")
    print("Archived tasks:")
    archive_base = archive_root(root, config)
    if archive_base.exists():
        for metadata_path in sorted(archive_base.glob("*/*/task.json")):
            metadata = read_task(metadata_path.parent)
            slug = str(metadata.get("slug") or metadata_path.parent.name)
            month = metadata_path.parent.parent.name
            print(f"  - {month}/{metadata_path.parent.name} [{slug}]")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage project-local agentic task state.")
    subparsers = parser.add_subparsers(dest="command")

    start = subparsers.add_parser("start", help="Create a task and set it as current.")
    start.add_argument("title", help="Task title.")
    start.add_argument("--slug", help="Explicit task slug. Defaults to a slugified title.")
    start.add_argument("--force", action="store_true", help="Allow switching current-task despite an unfinished active task.")
    start.set_defaults(func=create_task)

    current = subparsers.add_parser("current", help="Print the current task slug.")
    current.set_defaults(func=show_current)

    set_current_parser = subparsers.add_parser("set-current", help="Set the current task pointer.")
    set_current_parser.add_argument("slug", help="Existing task slug.")
    set_current_parser.set_defaults(func=set_current_command)

    status = subparsers.add_parser("status", help="Show task status.")
    status.add_argument("--task", help="Task slug. Defaults to .agent/current-task.")
    status.set_defaults(func=show_status)

    list_parser = subparsers.add_parser("list", help="List active and archived tasks.")
    list_parser.set_defaults(func=list_tasks)

    archive = subparsers.add_parser("archive", help="Move a completed task into .agent/archive/YYYY-MM/.")
    archive.add_argument("--task", help="Task slug. Defaults to .agent/current-task.")
    archive.add_argument("--force", action="store_true", help="Archive even when the task is unfinished.")
    archive.set_defaults(func=archive_task)

    mark = subparsers.add_parser("mark", help="Explicitly mark a phase complete and advance state.")
    mark.add_argument("phase", choices=PHASES, help="Phase to mark complete.")
    mark.add_argument("--task", help="Task slug. Defaults to .agent/current-task.")
    mark.add_argument("--force", action="store_true", help="Bypass artifact validation with a warning.")
    mark.set_defaults(func=mark_phase)

    for phase in ("plan", "prepare", "execute", "verify", "capture", "finish"):
        add_inspection_parser(subparsers, phase)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if not hasattr(args, "func"):
        parser.print_help()
        return 0
    try:
        return args.func(args)
    except TaskError as error:
        print(f"error: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
