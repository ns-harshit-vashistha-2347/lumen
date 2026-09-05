// Chat slash-command config + resolver. Extracted from app/chat/page.tsx
// so the 640-line page stops growing every time a new command lands, and
// so this list can be shared with the command palette in future.

export const CHAT_SAMPLES = [
  "summarize the key points across every document in scope",
  "what are the main risks mentioned?",
  "list every deadline referenced with its date",
  "compare the recommendations in my two most recent uploads",
] as const;

export type SlashDefinition = {
  cmd: string;
  desc: string;
};

export const CHAT_SLASH: SlashDefinition[] = [
  { cmd: "/help", desc: "show all commands" },
  { cmd: "/clear", desc: "wipe this conversation" },
  { cmd: "/scope", desc: "open library to select documents" },
  { cmd: "/summarize", desc: "summarise every doc in scope" },
];

export type SlashOutcome =
  | { kind: "help" }
  | { kind: "clear" }
  | { kind: "scope" }
  | { kind: "run"; prompt: string }
  | { kind: "unknown"; cmd: string }
  | { kind: "not-slash" };

/** Pure parse of a chat input into a slash action. The page decides how
 * to render it (toast, router.push, LLM submit) — keep this file free of
 * next/router / react so it stays trivially unit-testable. */
export function parseSlash(text: string): SlashOutcome {
  if (!text.startsWith("/")) return { kind: "not-slash" };
  const [cmd] = text.split(/\s+/);
  switch (cmd) {
    case "/help":
      return { kind: "help" };
    case "/clear":
      return { kind: "clear" };
    case "/scope":
      return { kind: "scope" };
    case "/summarize":
      return {
        kind: "run",
        prompt:
          "summarise every document currently in scope and highlight the key themes",
      };
    default:
      return { kind: "unknown", cmd };
  }
}
