import { memoryView } from "./shared/rpc";
import { readMemory } from "./server/read";

export default function contribute(server) {
  server.handle(memoryView, readMemory);
  return () => {};
}
