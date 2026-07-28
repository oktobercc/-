/* =====================================================
   页间集 · MD5

   只为一件事存在：百度网盘上传要先报每个 4MB 分片的 MD5，
   服务端才肯给 uploadid。WebCrypto 不提供 MD5（它被认为不安全，
   这里也不是拿来做安全用途的，纯粹是百度接口要的校验值），
   所以自己实现一份。

   WebDAV 那条路用不到这个文件。
===================================================== */
(function () {
  "use strict";

  // 每轮的左移位数
  var S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  // K[i] = floor(2^32 * abs(sin(i + 1)))
  var K = new Uint32Array(64);
  for (var i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

  function rotl(x, c) {
    return (x << c) | (x >>> (32 - c));
  }

  /**
   * @param {Uint8Array} bytes
   * @returns {string} 32 位小写十六进制
   */
  function md5(bytes) {
    var length = bytes.length;

    // 补 1 个 0x80，再补 0 到 56 mod 64，最后 8 字节放小端的比特长度
    var padded = (((length + 8) >> 6) + 1) << 6;
    var buffer = new Uint8Array(padded);
    buffer.set(bytes);
    buffer[length] = 0x80;

    var view = new DataView(buffer.buffer);
    var bits = length * 8;
    view.setUint32(padded - 8, bits % 4294967296, true);
    view.setUint32(padded - 4, Math.floor(bits / 4294967296), true);

    var a0 = 0x67452301;
    var b0 = 0xefcdab89;
    var c0 = 0x98badcfe;
    var d0 = 0x10325476;

    var chunk = new Uint32Array(16);

    for (var offset = 0; offset < padded; offset += 64) {
      for (var w = 0; w < 16; w++) chunk[w] = view.getUint32(offset + w * 4, true);

      var a = a0;
      var b = b0;
      var c = c0;
      var d = d0;

      for (var step = 0; step < 64; step++) {
        var f;
        var g;

        if (step < 16) {
          f = (b & c) | (~b & d);
          g = step;
        } else if (step < 32) {
          f = (d & b) | (~d & c);
          g = (5 * step + 1) % 16;
        } else if (step < 48) {
          f = b ^ c ^ d;
          g = (3 * step + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          g = (7 * step) % 16;
        }

        var temp = d;
        d = c;
        c = b;
        b = (b + rotl((a + f + K[step] + chunk[g]) | 0, S[step])) | 0;
        a = temp;
      }

      a0 = (a0 + a) | 0;
      b0 = (b0 + b) | 0;
      c0 = (c0 + c) | 0;
      d0 = (d0 + d) | 0;
    }

    var out = new DataView(new ArrayBuffer(16));
    out.setUint32(0, a0 >>> 0, true);
    out.setUint32(4, b0 >>> 0, true);
    out.setUint32(8, c0 >>> 0, true);
    out.setUint32(12, d0 >>> 0, true);

    var hex = "";
    for (var j = 0; j < 16; j++) hex += out.getUint8(j).toString(16).padStart(2, "0");
    return hex;
  }

  /** Blob 分片 → MD5 列表。大文件一片一片读，不一次性塞进内存 */
  async function md5Blocks(blob, blockSize) {
    var size = blockSize || 4 * 1024 * 1024;
    var list = [];

    for (var start = 0; start < blob.size; start += size) {
      var slice = blob.slice(start, Math.min(start + size, blob.size));
      list.push(md5(new Uint8Array(await slice.arrayBuffer())));
    }

    // 空文件也要有一个块，否则 precreate 不认
    if (!list.length) list.push(md5(new Uint8Array(0)));
    return list;
  }

  window.md5 = md5;
  window.md5Blocks = md5Blocks;
})();
