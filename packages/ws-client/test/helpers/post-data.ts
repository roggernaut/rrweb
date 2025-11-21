/**
 * Helper module to test postData in isolation
 */

class ArrayQueue<T> {
  private items: T[] = [];
  add(item: T) {
    this.items.push(item);
  }
  read(): T | undefined {
    return this.items.shift();
  }
  length() {
    return this.items.length;
  }
  clear() {
    this.items = [];
  }
}

export async function postData(
  postUrl: string,
  publicApiKey: string,
  buffer: ArrayQueue<string> | string,
) {
  const keepaliveLimit = 65000;
  let done = false;
  const responses = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let body;
    if (buffer instanceof ArrayQueue) {
      // this clears the buffer so no need to call buffer.clear()
      const toSend = [];
      let sendSize = 0;
      done = true;
      for (let ele = buffer.read(); ele !== undefined; ele = buffer.read()) {
        toSend.push(ele);
        sendSize += ele.length;
        if (sendSize > keepaliveLimit) {
          done = false;
          break;
        }
      }
      body = toSend.join('\n');
    } else {
      body = buffer;
      done = true;
    }
    try {
      const response = await fetch(postUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-ndjson',
          Authorization: `Bearer ${publicApiKey}`,
        },
        body,
        keepalive: body.length < keepaliveLimit, // don't abort POST after end of session (must be under the limit)
      });
      responses.push(response);
    } catch (error) {
      console.error('Error POSTing events:', error);
      return false;
    }
    if (done) {
      break;
    }
  }
  return responses;
}

export { ArrayQueue };
