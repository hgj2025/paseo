import { useCallback } from "react";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { MemoryPage } from "./client/page";

function MemoryItem({ currentScreen, openScreen }) {
  const openMemory = useCallback(() => openScreen({ screenId: "memory" }), [openScreen]);
  return (
    <SidebarRow
      icon="Brain"
      label="项目记忆"
      active={currentScreen?.screenId === "memory"}
      onPress={openMemory}
    />
  );
}

export default function contribute(client) {
  client.addScreen({ id: "memory", title: "项目记忆", Component: MemoryPage });
  client.addSidebarHeaderItem({ id: "memory", title: "项目记忆", Component: MemoryItem });
  return () => {};
}
