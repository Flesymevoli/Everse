# Security

Everse Alpha is a local, single-user application. It binds to 127.0.0.1 and has no public multi-user authentication. Do not expose it through a public reverse proxy.

Never attach API keys, databases, personal stories or unredacted logs to public issues. Windows persisted keys use current-user DPAPI; this does not isolate other programs running under the same account. Keep backups private.

Report a reproducible problem with synthetic data and redact credentials. For sensitive reports, use GitHub private vulnerability reporting if enabled; otherwise request a private contact without publishing exploit details or personal data.

Dependencies retain their own licenses. Reference projects were consulted for design; their runtime, prompts, skills and UI implementations are not bundled.
