#!/bin/bash
# The t22-feedback harness's one hard guard (docs/design-feedback.md § 17.5):
# a run must never be able to write to Ten's real database. The runner
# therefore refuses to start unless the feedback URL it hands the agent is on
# the loopback address 127.0.0.1 — the stub it started itself.
#
# Sourced by run_t22.sh. Tested by tests/test_feedback_harness.py.

# require_loopback_feedback_url <url>
# Exits the calling shell with status 2 (a usage-class refusal, like
# lib_env.sh's bad-model refusals) unless <url> is http://127.0.0.1:<port>/…
# or http://127.0.0.1:<port>. Anything else — localhost, an IPv6 loopback,
# a name that merely starts with 127.0.0.1, userinfo tricks, https, a real
# supabase.co address, an empty value — is refused.
require_loopback_feedback_url() {
  local url="${1:-}"
  if [[ ! "$url" =~ ^http://127\.0\.0\.1:[0-9]{1,5}(/[A-Za-z0-9._~/-]*)?$ ]]; then
    echo "REFUSED: TEN_FEEDBACK_URL must be http://127.0.0.1:<port>/... (the local stub), got: ${url:-<empty>}" >&2
    echo "         t22-feedback never sends to a real address; it starts its own stub and uses that." >&2
    exit 2
  fi
}

# refuse_foreign_feedback_url_in_env
# If the operator's own environment already carries a TEN_FEEDBACK_URL, it
# must itself be loopback: a non-loopback value is a mistake worth stopping
# for, even though the runner would overwrite it for the agent.
refuse_foreign_feedback_url_in_env() {
  if [ -n "${TEN_FEEDBACK_URL:-}" ]; then
    require_loopback_feedback_url "$TEN_FEEDBACK_URL"
  fi
}
