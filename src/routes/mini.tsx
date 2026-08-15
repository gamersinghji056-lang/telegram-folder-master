import { createFileRoute } from "@tanstack/react-router";

import { MiniApp } from "./mini-app";

export const Route = createFileRoute("/mini")({
  head: () => ({
    meta: [
      { title: "Telegram Folder Mini App" },
      {
        name: "description",
        content: "Connect Telegram, analyze folder links, and create a clean shareable folder.",
      },
    ],
  }),
  component: MiniApp,
});
