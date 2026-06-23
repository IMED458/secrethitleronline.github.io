import { DurableObject } from 'cloudflare:workers';

export interface Env {
  GAME_ROOM: DurableObjectNamespace<GameRoomObject>;
}

export default {
  fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/rooms\/([A-Z0-9]{6})\/websocket$/i);
    if (!match) return new Response('Secret Hitler realtime service', { status: 200 });

    const id = env.GAME_ROOM.idFromName(match[1].toUpperCase());
    return env.GAME_ROOM.get(id).fetch(request);
  },
};

export class GameRoomObject extends DurableObject<Env> {
  async fetch(request: Request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID() });
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    // The full room engine is attached in the next migration step; keeping this
    // endpoint hibernation-ready avoids a permanently running server.
    socket.send(typeof message === 'string' ? message : message);
  }
}
