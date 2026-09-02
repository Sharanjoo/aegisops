import WebSocket from "ws";

export class ConnectionHub {
  private readonly clients = new Set<WebSocket>();

  get size(): number {
    return this.clients.size;
  }

  add(client: WebSocket): void {
    this.clients.add(client);

    const removeClient = (): void => {
      this.clients.delete(client);
    };

    client.once("close", removeClient);
    client.once("error", removeClient);
  }

  broadcast(payload: unknown): number {
    const message = JSON.stringify(payload);
    let delivered = 0;

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
          delivered += 1;
        } catch {
          this.clients.delete(client);
          client.terminate();
        }

        continue;
      }

      if (
        client.readyState === WebSocket.CLOSING ||
        client.readyState === WebSocket.CLOSED
      ) {
        this.clients.delete(client);
      }
    }

    return delivered;
  }
}