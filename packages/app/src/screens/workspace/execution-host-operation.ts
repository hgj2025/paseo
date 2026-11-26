interface ExecutionHostConnection {
  ensureConnected(): void;
  connect(): Promise<void>;
}

async function waitForConnection(client: ExecutionHostConnection): Promise<void> {
  client.ensureConnected();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Connection did not become ready within 10 seconds")),
          10_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runExecutionHostOperation<C extends ExecutionHostConnection, T>(
  serverId: string,
  stage: string,
  clientFor: () => C | null,
  operation: (client: C) => Promise<T>,
): Promise<T> {
  try {
    const client = clientFor();
    if (!client) throw new Error("Host client is unavailable");
    await waitForConnection(client);
    // Reconnection can replace a runtime client while the old one is awaiting readiness.
    const current = clientFor();
    if (!current) throw new Error("Host client is unavailable");
    if (current !== client) {
      await waitForConnection(current);
    }
    return await operation(current);
  } catch (error) {
    throw new Error(
      `${stage} [${serverId}]: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
