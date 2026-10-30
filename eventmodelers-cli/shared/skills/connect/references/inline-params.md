# Step 0 — Inline parameters

Before reading the config file, scan the prompt/arguments that invoked this skill for inline overrides. Supported formats:

| Pattern | Example |
|---------|---------|
| `board=<uuid>` | `board=05cda19d-d5b8-4b51-ae88-c72f2611548a` |
| `token=<uuid>` | `token=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `org=<uuid>` | `org=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `baseUrl=<url>` | `baseUrl=http://localhost:3000` |
| `agent=<uuid>` | `agent=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (the agent id a parent agent hands a subagent, so the subagent's board writes are attributed to the same agent) |
| `session=<uuid>` | `session=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (the chat session a parent agent hands a subagent, as `CHAT_SESSION_ID`, so the subagent's writes are traced back to the same chat) |

If an inline `board=<uuid>` is found, use it as `BOARD_ID` — **it takes priority over the config file**. Same for `token`, `org`, `baseUrl`, and `agent` (as `AGENT_ID`, which then makes Step 0.5 a no-op). Record which values came from inline params so they are not overwritten in Step 3.

(`agent=<uuid>` and `session=<uuid>` are not among the four required values — both are optional, and their absence never makes this skill ask anything. Never persist `session=`: it belongs to the one piece of work it was handed with.)

**`token=$EVENTMODELERS_TOKEN` is an inline token too.** The build and modeling loops pass the env var's *name*, not its value, so the secret never sits in the prompt. Treat it exactly like a literal inline token: `TOKEN` is `$EVENTMODELERS_TOKEN` (it counts toward "all four inline" below). Keep using the reference, never its value — write curl headers as `-H "x-token: $EVENTMODELERS_TOKEN"` (double quotes, so the shell expands it), don't `echo` or print it, and hand it to a subagent as `token=$EVENTMODELERS_TOKEN` (it inherits the same environment). MCP calls need nothing extra — `.mcp.json` already reads the same variable. Never write the reference into a file either: if a later step would persist `TOKEN` (Step 3's `config.json`, Step 3.5's `settings.local.json`), leave the token out — the process that launched you already set the variable, and a file holding the literal `$EVENTMODELERS_TOKEN` text breaks auth for the next session.

**All four inline means this skill is already finished — stop here.** `token=`, `board=`, `org=` and `baseUrl=` arriving together is the shape a parent agent hands a subagent, and it resolves every required value in this one step. Do not walk the config file (Step 1), do not ask anything (Step 2), do not persist (Step 3), and do not make the verify call (Step 4): the parent resolved these values against this board and verified them there, so a subagent verifying them again learns nothing it wasn't just told and pays a round trip for it. Step 3.5 is a no-op too whenever `.mcp.json` already carries an `eventmodelers` entry — read the file, don't rewrite it, and don't re-register a server the session is already connected to. Print `Connected — board <BOARD_ID>` and return to the skill that invoked you.
