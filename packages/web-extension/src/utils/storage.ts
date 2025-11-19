import { openDB } from 'idb';
import type { eventWithTime } from '@rrweb/types';
import type { Session } from '~/types';
import { ZstdCodec } from 'zstd-codec';

/**
 * Storage related functions with indexedDB.
 */

const EventStoreName = 'events';
type EventData = {
  id: string;
  events: eventWithTime[];
};

export async function getEventStore() {
  return openDB<EventData>(EventStoreName, 1, {
    upgrade(db) {
      db.createObjectStore(EventStoreName, {
        keyPath: 'id',
        autoIncrement: false,
      });
    },
  });
}

export async function getEvents(id: string) {
  const db = await getEventStore();
  const data = (await db.get(EventStoreName, id)) as EventData;
  return data.events;
}

const SessionStoreName = 'sessions';
export async function getSessionStore() {
  return openDB<Session>(SessionStoreName, 1, {
    upgrade(db) {
      // Create a store of objects
      db.createObjectStore(SessionStoreName, {
        // The 'id' property of the object will be the key.
        keyPath: 'id',
        // If it isn't explicitly set, create a value by auto incrementing.
        autoIncrement: false,
      });
    },
  });
}

export async function addSession(session: Session, events: eventWithTime[]) {
  const eventStore = await getEventStore();
  await eventStore.put(EventStoreName, { id: session.id, events });
  const store = await getSessionStore();
  await store.add(SessionStoreName, session);
}

export async function updateSession(
  session: Session,
  events?: eventWithTime[],
) {
  const eventStore = await getEventStore();
  if (events) {
    await eventStore.put(EventStoreName, { id: session.id, events });
  }
  const store = await getSessionStore();
  await store.put(SessionStoreName, session);
}

export async function getSession(id: string) {
  const store = await getSessionStore();
  return store.get(SessionStoreName, id) as Promise<Session>;
}

export async function getAllSessions() {
  const store = await getSessionStore();
  const sessions = (await store.getAll(SessionStoreName)) as Session[];
  return sessions.sort((a, b) => b.createTimestamp - a.createTimestamp);
}

export async function deleteSession(id: string) {
  const eventStore = await getEventStore();
  const sessionStore = await getSessionStore();
  await Promise.all([
    eventStore.delete(EventStoreName, id),
    sessionStore.delete(SessionStoreName, id),
  ]);
}

export async function deleteSessions(ids: string[]) {
  const eventStore = await getEventStore();
  const sessionStore = await getSessionStore();
  const eventTransition = eventStore.transaction(EventStoreName, 'readwrite');
  const sessionTransition = sessionStore.transaction(
    SessionStoreName,
    'readwrite',
  );
  const promises = [];
  for (const id of ids) {
    promises.push(eventTransition.store.delete(id));
    promises.push(sessionTransition.store.delete(id));
  }
  await Promise.all(promises).then(() => {
    return Promise.all([eventTransition.done, sessionTransition.done]);
  });
}

export async function downloadSessions(ids: string[]) {
  for (const sessionId of ids) {
    const events = await getEvents(sessionId);
    const session = await getSession(sessionId);
    const blob = new Blob([JSON.stringify({ session, events }, null, 2)], {
      type: 'application/json',
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.name}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export type SessionUploadResult = {
  id: string;
  name: string;
  ok: boolean;
  error?: string;
};

// const COMPRESSION_ENDPOINT = 'http://localhost:8787';
const COMPRESSION_ENDPOINT = 'https://api.rrwebcloud.com';

type ContentEncoding = 'zstd' | 'br' | 'gzip';

type CompressionResult = {
  buffer: ArrayBuffer;
  encoding: ContentEncoding;
};

type CompressionFormat = 'zstd' | 'brotli' | 'gzip';

let zstdSimplePromise:
  | Promise<{
      compress(
        content: Uint8Array,
        compressionLevel?: number,
      ): Uint8Array | null;
    }>
  | undefined;

async function compressWithCompressionStream(
  payload: string,
  format: CompressionFormat,
): Promise<CompressionResult> {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('CompressionStream is not available.');
  }
  const CompressionStreamCtor = CompressionStream as unknown as new (
    fmt: CompressionFormat,
  ) => CompressionStream;
  const compressionStream = new CompressionStreamCtor(format);
  const payloadStream = new Response(payload).body;
  if (!payloadStream) {
    throw new Error('Failed to create payload stream for compression.');
  }
  const compressedStream = payloadStream.pipeThrough(compressionStream);
  const buffer = await new Response(compressedStream).arrayBuffer();
  const encoding: ContentEncoding =
    format === 'zstd' ? 'zstd' : format === 'brotli' ? 'br' : 'gzip';
  return {
    buffer,
    encoding,
  };
}

async function getZstdSimple() {
  if (!zstdSimplePromise) {
    zstdSimplePromise = new Promise((resolve, reject) => {
      try {
        ZstdCodec.run((zstdModule) => {
          try {
            // eslint-disable-next-line new-cap
            const simple = new zstdModule.Simple();
            resolve(simple);
          } catch (error) {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }
  return zstdSimplePromise;
}

async function compressWithZstdWasm(
  payload: string,
): Promise<CompressionResult> {
  const encoder = new TextEncoder();
  const simple = await getZstdSimple();
  const encodedPayload = encoder.encode(payload);
  const compressed = simple.compress(encodedPayload);
  if (!compressed) {
    throw new Error('Zstandard compression failed.');
  }
  const buffer = compressed.buffer.slice(
    compressed.byteOffset,
    compressed.byteOffset + compressed.byteLength,
  );
  return {
    buffer,
    encoding: 'zstd',
  };
}

async function compressPayload(payload: string): Promise<CompressionResult> {
  if (typeof CompressionStream !== 'undefined') {
    try {
      return await compressWithCompressionStream(payload, 'zstd');
    } catch {
      // Fallback below.
    }
  }

  try {
    return await compressWithZstdWasm(payload);
  } catch {
    // Continue to other formats.
  }

  if (typeof CompressionStream !== 'undefined') {
    try {
      return await compressWithCompressionStream(payload, 'brotli');
    } catch {
      // Try gzip fallback below.
    }
    return compressWithCompressionStream(payload, 'gzip');
  }

  throw new Error('No supported compression format available.');
}

export async function uploadSessions(
  ids: string[],
): Promise<SessionUploadResult[]> {
  const results: SessionUploadResult[] = [];

  for (const sessionId of ids) {
    let session: Session | undefined;
    try {
      session = await getSession(sessionId);
      if (!session) {
        throw new Error('Session metadata not found.');
      }
      const events = await getEvents(sessionId);
      if (!Array.isArray(events)) {
        throw new Error('No recording events were found for this session.');
      }
      const payload = events.map((event) => JSON.stringify(event)).join('\n');
      const payloadSize = new TextEncoder().encode(payload).length;
      const payloadSizeMB = payloadSize / 1024 / 1024;
      const { buffer, encoding } = await compressPayload(payload);
      const compressedPayloadSize = buffer.byteLength;
      const compressedPayloadSizeMB = compressedPayloadSize / 1024 / 1024;
      console.log(
        `Uploading session payload (${session.id}, ${payloadSizeMB}MB)`,
        `Compressed payload size: ${compressedPayloadSizeMB}MB`,
        payload,
      );
      const response = await fetch(
        `${COMPRESSION_ENDPOINT}/recordings/${session.id}/ingest`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/ndjson',
            'Content-Encoding': encoding,
          },
          body: buffer,
        },
      );
      if (!response.ok) {
        throw new Error(
          `Upload failed with status ${response.status} ${
            response.statusText || ''
          }`.trim(),
        );
      }
      results.push({
        id: sessionId,
        name: session.name,
        ok: true,
      });
    } catch (error) {
      results.push({
        id: sessionId,
        name: session?.name ?? sessionId,
        ok: false,
        error: (error as Error).message,
      });
    }
  }

  return results;
}
