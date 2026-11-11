// A NAT in front of the media server that can lose packets.
//
// Browsers reach the media server only through this relay. Each browser
// address gets an upstream socket of its own, so the media server sees one
// distinct address per browser, as behind a real NAT, and the address it
// advertises is not the one it is bound to. Losing every n-th packet of one
// payload type, on the way up or down, makes NACK and RTX do their work on
// each leg of the media server separately.

import { createSocket } from "node:dgram";

/** Whether a datagram is RTP (not STUN, DTLS or RTCP) of payload type `pt`. */
function isRtp(data, pt) {
  if (data.length < 12 || data[0] >> 6 !== 2) return false;
  const second = data[1];
  // RTCP packet types 192 to 223 fill the whole second byte.
  if (second >= 192 && second <= 223) return false;
  return (second & 0x7f) === pt;
}

export class LossyNat {
  static listen() {
    return new Promise((resolve, reject) => {
      const socket = createSocket("udp4");
      socket.once("error", reject);
      socket.bind(0, "127.0.0.1", () => resolve(new LossyNat(socket)));
    });
  }

  constructor(socket) {
    this.socket = socket;
    this.port = socket.address().port;
    this.target = null;
    this.upstreams = new Map();
    this.rule = null;
    this.seen = { up: 0, down: 0 };
    this.lost = { up: 0, down: 0 };
    socket.on("message", (data, from) => this.fromBrowser(data, from));
  }

  /** Loses every `every`-th RTP packet of payload type `pt` in both directions. */
  lose({ pt, every }) {
    this.rule = { pt, every };
  }

  dropped(direction, data) {
    if (!this.rule || !isRtp(data, this.rule.pt)) return false;
    this.seen[direction] += 1;
    if (this.seen[direction] % this.rule.every !== 0) return false;
    this.lost[direction] += 1;
    return true;
  }

  fromBrowser(data, from) {
    if (!this.target) return;
    const key = `${from.address}:${from.port}`;
    let upstream = this.upstreams.get(key);
    if (!upstream) {
      upstream = createSocket("udp4");
      upstream.bind(0, "127.0.0.1");
      upstream.on("message", (reply) => {
        if (!this.dropped("down", reply)) this.socket.send(reply, from.port, from.address);
      });
      this.upstreams.set(key, upstream);
    }
    if (!this.dropped("up", data)) upstream.send(data, this.target, "127.0.0.1");
  }

  close() {
    for (const upstream of this.upstreams.values()) upstream.close();
    this.socket.close();
  }
}
