import { Module } from 'modelence/server';
import { chatStatus, sendChat } from './service';

/** Single-operator hackathon chat. Memory identity is selected on the server, never accepted from the client. */
export default new Module('chat', {
  queries: { status: async () => chatStatus() },
  mutations: { send: async (args: unknown) => sendChat(args) },
});
