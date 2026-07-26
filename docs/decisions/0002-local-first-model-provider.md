# 0002. Local-first model provider

## Status

Accepted

## Context

The agent needs a chat model with tool calling to interpret customer messages and choose tools. Paid hosted model APIs can work, but they introduce account setup, recurring cost, network dependency, and secrets that are unnecessary for local development and automated tests.

The repository must remain runnable with free, local, or official test resources. Tests must not require a live model or network access.

## Decision

Make Ollama the default runtime model provider, using its native chat and tool-calling interface. The recommended default model is `qwen3:4b`.

Implement a provider abstraction so an OpenAI-compatible provider could be added later. Do not require or configure a paid provider for the initial project.

Required providers:

- `OllamaProvider` for actual local execution
- `ScriptedModelProvider` for automated tests only

The scripted provider must never be presented as the real AI implementation. If Ollama is unavailable, return a clear health or runtime error. Do not silently fake model output.

## Consequences

- Local demos and development can run without paid API keys.
- Behaviour depends on the locally available model quality and tool-calling support.
- CI and unit tests stay deterministic by using scripted responses against temporary databases.
- Operator health checks must report degraded state when Ollama is down.
- A future paid provider can plug into the same interface without rewriting domain logic, provided vendor-specific details stay at the provider boundary.

## Alternatives considered

- **Paid hosted LLM as the default**: rejected for the initial product because it forces cost, credentials, and network dependency for basic local use.
- **No provider abstraction**: rejected because tests need a scripted implementation and future providers should not leak into domain code.
- **Scripted provider as the only runtime path**: rejected because it cannot support real conversational demos and must not be marketed as the AI implementation.
- **Heavyweight agent frameworks solely to obtain a model client**: rejected when a direct Ollama interface and a thin provider boundary are enough.
