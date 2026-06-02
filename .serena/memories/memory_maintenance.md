# Memory Maintenance

- Serena repo-local memory path: `D:/0_Client/QuickNote/.serena/memories/`.
- If `activate_project("D:/0_Client/QuickNote")` works but `onboarding` fails with `memory_maintenance.md` missing, the `memories/` directory was not initialized.
- Start QuickNote sessions by reading `mem:project_keywords` first, then inspect current git status before editing.
- Keep memory entries short and keyword-heavy. Prefer stable repo conventions, recurring regression notes, and verification commands over long narratives.
- Do not store secrets, AWS credentials, API keys, or user tokens in Serena memory.
- Serena CLI is installed as `serena-agent`; on Windows this repo uses a `serena.cmd` wrapper to force UTF-8 output for `serena memories check`.
