from __future__ import annotations

import json
from typing import Any

from openai import OpenAI

from app.config import (
    AI_API_BASE_URL,
    AI_API_KEY,
    AI_MAX_RETRIES,
    AI_MODEL,
    AI_TIMEOUT_SECONDS,
)


class AIClient:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float | None = None,
        max_retries: int | None = None,
    ) -> None:
        self.api_key = api_key or AI_API_KEY
        self.base_url = base_url or AI_API_BASE_URL
        self.model = model or AI_MODEL
        self.timeout = timeout if timeout is not None else AI_TIMEOUT_SECONDS
        self.max_retries = max_retries if max_retries is not None else AI_MAX_RETRIES

    def is_configured(self) -> bool:
        return bool(self.api_key)

    def complete_json(self, *, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        client = self._create_client()
        completion = client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
        )
        content = completion.choices[0].message.content if completion.choices else None
        if not content:
            raise ValueError("empty ai response")
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            extracted = self._extract_json_object(content)
            if extracted is not None:
                return extracted
            raise ValueError(content)

    def complete_text(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> str:
        client = self._create_client()
        completion = client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
            stream=False,
        )
        return completion.choices[0].message.content if completion.choices and completion.choices[0].message.content else ""

    def complete_text_stream(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ):
        client = self._create_client()
        stream = client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
        )
        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            content = delta.content if delta else None
            if content:
                yield content

    def _create_client(self) -> OpenAI:
        return OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            timeout=self.timeout,
            max_retries=self.max_retries,
        )

    def _extract_json_object(self, content: str) -> dict[str, Any] | None:
        normalized = content.strip()
        if normalized.startswith("```"):
            normalized = normalized.strip("`")
            normalized = normalized.replace("json\n", "", 1).strip()

        start = normalized.find("{")
        if start < 0:
            return None

        depth = 0
        in_string = False
        escaped = False
        for index, char in enumerate(normalized[start:], start=start):
            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    in_string = False
                continue

            if char == '"':
                in_string = True
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    candidate = normalized[start : index + 1]
                    try:
                        return json.loads(candidate)
                    except json.JSONDecodeError:
                        return None
        return None
