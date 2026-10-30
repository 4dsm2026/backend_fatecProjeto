import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";
import type { NotifyUsers } from "./app-globals";

declare global {
  var app: FastifyInstance & {
    wsClients?: Map<string, WebSocket>;
    notifyUsers?: NotifyUsers;
  };
}

export {};
