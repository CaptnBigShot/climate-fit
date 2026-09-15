#!/bin/bash
# PostToolUse (Edit/Write): run Prettier on the file Claude just changed. Files outside the
# project, types Prettier doesn't handle, and paths in .prettierignore are left alone.
f=$(jq -r '.tool_input.file_path // empty')
case "$f" in "$CLAUDE_PROJECT_DIR"/*) ;; *) exit 0 ;; esac
cd "$CLAUDE_PROJECT_DIR" && node_modules/.bin/prettier --write --ignore-unknown --log-level warn "$f"
