/*! QRCode.js - Auto-version QR encoder for Manifest V3
 * Supports versions 1-40, EC level L, mask pattern 0.
 * Auto-selects the smallest version that fits the payload.
 */

(function () {
  const QUIET_ZONE = 4;
  const EC_LEVEL_BITS = 0b01; // L
  const MASK_PATTERN = 0;
  const FORMAT_MASK = 0b101010000010010;
  const FORMAT_POLY = 0b10100110111;
  const VERSION_POLY = 0b1111100100101;

  // Version capacity table (EC level L, byte mode)
  // [dataCodewords, eccPerBlock, blockSizes[]]
  const VERSION_TABLE = {
    1:  [19,   7,  [19]],
    2:  [34,  10,  [34]],
    3:  [55,  15,  [55]],
    4:  [80,  20,  [80]],
    5:  [108, 26,  [108]],
    6:  [136, 18,  [68, 68]],
    7:  [156, 20,  [78, 78]],
    8:  [194, 24,  [97, 97]],
    9:  [232, 30,  [116, 116]],
    10: [274, 18,  [68, 68, 68, 68]],
    11: [324, 20,  [81, 81, 81, 81]],
    12: [370, 24,  [92, 92, 92, 92]],
    13: [428, 26,  [107, 107, 107, 107]],
    14: [461, 30,  [115, 115, 115, 116]],
    15: [523, 22,  [87, 87, 87, 87, 87, 88]],
    16: [589, 24,  [98, 98, 98, 98, 98, 99]],
  };

  // Alignment pattern positions per version
  const ALIGNMENT_POSITIONS = {
    2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
    11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62], 14: [6, 26, 46, 66],
    15: [6, 26, 48, 70], 16: [6, 26, 50, 74],
  };

  const gfExp = new Array(512);
  const gfLog = new Array(256);

  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    gfExp[i] = value;
    gfLog[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) {
    gfExp[i] = gfExp[i - 255];
  }

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return gfExp[gfLog[a] + gfLog[b]];
  }

  function gfPow(power) {
    return gfExp[power % 255];
  }

  function bitLength(num) {
    let bits = 0;
    while (num > 0) { num >>= 1; bits += 1; }
    return bits;
  }

  function bchRemainder(valueBits, generator) {
    let current = valueBits;
    const generatorBits = bitLength(generator);
    while (bitLength(current) >= generatorBits) {
      const shift = bitLength(current) - generatorBits;
      current ^= generator << shift;
    }
    return current;
  }

  function formatBits(ecLevelBits, maskPattern) {
    const data = ((ecLevelBits << 3) | maskPattern) << 10;
    const bits = data | bchRemainder(data, FORMAT_POLY);
    return bits ^ FORMAT_MASK;
  }

  function versionBits(version) {
    const data = version << 12;
    return data | bchRemainder(data, VERSION_POLY);
  }

  function createGeneratorPolynomial(degree) {
    let polynomial = [1];
    for (let i = 0; i < degree; i += 1) {
      polynomial = multiplyPolynomials(polynomial, [1, gfPow(i)]);
    }
    return polynomial;
  }

  function multiplyPolynomials(left, right) {
    const result = new Array(left.length + right.length - 1).fill(0);
    for (let i = 0; i < left.length; i += 1) {
      for (let j = 0; j < right.length; j += 1) {
        result[i + j] ^= gfMul(left[i], right[j]);
      }
    }
    return result;
  }

  function modPolynomials(dividend, divisor) {
    const result = dividend.slice();
    for (let i = 0; i <= result.length - divisor.length; i += 1) {
      const coefficient = result[i];
      if (coefficient === 0) continue;
      for (let j = 1; j < divisor.length; j += 1) {
        result[i + j] ^= gfMul(divisor[j], coefficient);
      }
    }
    return result.slice(result.length - (divisor.length - 1));
  }

  function toUtf8Bytes(text) {
    if (typeof TextEncoder !== 'undefined') {
      return Array.from(new TextEncoder().encode(text));
    }
    const bytes = [];
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6));
        bytes.push(0x80 | (code & 0x3f));
      } else {
        bytes.push(0xe0 | (code >> 12));
        bytes.push(0x80 | ((code >> 6) & 0x3f));
        bytes.push(0x80 | (code & 0x3f));
      }
    }
    return bytes;
  }

  function selectVersion(byteCount) {
    for (let v = 1; v <= 16; v += 1) {
      const entry = VERSION_TABLE[v];
      // Byte mode: 4-bit mode indicator + 8 or 16-bit char count + data bytes
      // Must fit in DATA_CODEWORDS * 8 bits (leave 4 bits for terminator)
      const countBits = v >= 10 ? 16 : 8;
      const totalBitsNeeded = 4 + countBits + (byteCount * 8) + 4;
      if (totalBitsNeeded <= entry[0] * 8) return v;
    }
    throw new Error('QR payload too large (max ~589 bytes EC-L)');
  }

  function createBitBuffer() {
    const bits = [];
    return {
      put(num, length) {
        for (let i = length - 1; i >= 0; i -= 1) {
          bits.push((num >> i) & 1);
        }
      },
      getBits() { return bits; },
    };
  }

  function encodePayload(text, version) {
    const bytes = toUtf8Bytes(text);
    const entry = VERSION_TABLE[version];
    const DATA_CODEWORDS = entry[0];
    const countBits = version >= 10 ? 16 : 8;

    const buffer = createBitBuffer();
    buffer.put(0b0100, 4); // byte mode
    buffer.put(bytes.length, countBits);

    for (let i = 0; i < bytes.length; i += 1) {
      buffer.put(bytes[i], 8);
    }

    const bits = buffer.getBits();
    const totalBits = DATA_CODEWORDS * 8;

    const terminatorLength = Math.min(4, totalBits - bits.length);
    for (let i = 0; i < terminatorLength; i += 1) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let codeword = 0;
      for (let j = 0; j < 8; j += 1) {
        codeword = (codeword << 1) | bits[i + j];
      }
      codewords.push(codeword);
    }

    let pad = true;
    while (codewords.length < DATA_CODEWORDS) {
      codewords.push(pad ? 0xec : 0x11);
      pad = !pad;
    }

    return codewords;
  }

  function generateCodewords(text, version) {
    const entry = VERSION_TABLE[version];
    const ECC_CODEWORDS_PER_BLOCK = entry[1];
    const BLOCK_SIZES = entry[2];

    const dataCodewords = encodePayload(text, version);
    const generator = createGeneratorPolynomial(ECC_CODEWORDS_PER_BLOCK);

    const blocks = [];
    let offset = 0;
    for (let i = 0; i < BLOCK_SIZES.length; i += 1) {
      const blockSize = BLOCK_SIZES[i];
      const dataBlock = dataCodewords.slice(offset, offset + blockSize);
      offset += blockSize;

      const padded = dataBlock.concat(new Array(ECC_CODEWORDS_PER_BLOCK).fill(0));
      const remainder = modPolynomials(padded, generator);
      blocks.push({ data: dataBlock, ecc: remainder });
    }

    const interleaved = [];
    const maxDataLength = Math.max(...blocks.map(block => block.data.length));
    for (let i = 0; i < maxDataLength; i += 1) {
      for (let j = 0; j < blocks.length; j += 1) {
        if (i < blocks[j].data.length) interleaved.push(blocks[j].data[i]);
      }
    }

    for (let i = 0; i < ECC_CODEWORDS_PER_BLOCK; i += 1) {
      for (let j = 0; j < blocks.length; j += 1) {
        interleaved.push(blocks[j].ecc[i]);
      }
    }

    return interleaved;
  }

  function moduleCount(version) {
    return 21 + ((version - 1) * 4);
  }

  function createMatrix(mc) {
    return Array.from({ length: mc }, () => Array(mc).fill(null));
  }

  function createReservedMatrix(mc) {
    return Array.from({ length: mc }, () => Array(mc).fill(false));
  }

  function setModule(matrix, reserved, x, y, value, mc, lock = true) {
    if (x < 0 || y < 0 || x >= mc || y >= mc) return;
    matrix[y][x] = value ? 1 : 0;
    if (lock) reserved[y][x] = true;
  }

  function reserveModule(reserved, x, y, mc) {
    if (x < 0 || y < 0 || x >= mc || y >= mc) return;
    reserved[y][x] = true;
  }

  function drawFinder(matrix, reserved, x, y, mc) {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= mc || py >= mc) continue;

        reserveModule(reserved, px, py, mc);

        if (dx === -1 || dx === 7 || dy === -1 || dy === 7) {
          setModule(matrix, reserved, px, py, 0, mc);
        } else if (dx === 0 || dx === 6 || dy === 0 || dy === 6) {
          setModule(matrix, reserved, px, py, 1, mc);
        } else if (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4) {
          setModule(matrix, reserved, px, py, 1, mc);
        } else {
          setModule(matrix, reserved, px, py, 0, mc);
        }
      }
    }
  }

  function drawAlignment(matrix, reserved, centerX, centerY, mc) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const px = centerX + dx;
        const py = centerY + dy;
        if (px < 0 || py < 0 || px >= mc || py >= mc) continue;
        reserveModule(reserved, px, py, mc);

        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        setModule(matrix, reserved, px, py, distance === 0 || distance === 2 ? 1 : 0, mc);
      }
    }
  }

  function reserveFormatAreas(reserved, mc) {
    for (let i = 0; i <= 8; i += 1) {
      if (i !== 6) {
        reserveModule(reserved, 8, i, mc);
        reserveModule(reserved, i, 8, mc);
      }
    }
    for (let i = 0; i < 8; i += 1) {
      reserveModule(reserved, mc - 1 - i, 8, mc);
    }
    for (let i = 0; i < 7; i += 1) {
      reserveModule(reserved, 8, mc - 7 + i, mc);
    }
  }

  function placeFormatBits(matrix, reserved, bits, mc) {
    // Per QR spec ISO 18004 Figure 19:
    // firstPositions[i] = [x=col, y=row] for format bit i (LSB=0)
    // Horizontal strip: bit 0-7 along row=8 (cols 0,1,2,3,4,5,7,8)
    // Vertical strip:   bit 8-14 along col=8 (rows 7,5,4,3,2,1,0)
    const firstPositions = [
      [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8],
      [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
    ];
    // Second copy: bottom-left (col=8, rows mc-1..mc-7) + top-right (row=8, cols mc-8..mc-1)
    const secondPositions = [
      [8, mc - 1], [8, mc - 2], [8, mc - 3], [8, mc - 4],
      [8, mc - 5], [8, mc - 6], [8, mc - 7],
      [mc - 8, 8], [mc - 7, 8], [mc - 6, 8], [mc - 5, 8],
      [mc - 4, 8], [mc - 3, 8], [mc - 2, 8], [mc - 1, 8],
    ];

    for (let i = 0; i < 15; i += 1) {
      const bit = (bits >> i) & 1;
      const [x1, y1] = firstPositions[i];
      const [x2, y2] = secondPositions[i];
      setModule(matrix, reserved, x1, y1, bit, mc, true);
      setModule(matrix, reserved, x2, y2, bit, mc, true);
    }
  }

  function placeVersionBits(matrix, reserved, bits, mc) {
    const topRight = [];
    const bottomLeft = [];
    for (let i = 0; i < 6; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        topRight.push([mc - 11 + j, i]);
        bottomLeft.push([i, mc - 11 + j]);
      }
    }

    for (let i = 0; i < 18; i += 1) {
      const bit = (bits >> i) & 1;
      const [x1, y1] = bottomLeft[i];
      const [x2, y2] = topRight[i];
      setModule(matrix, reserved, x1, y1, bit, mc, true);
      setModule(matrix, reserved, x2, y2, bit, mc, true);
    }
  }

  function placeData(matrix, reserved, dataBits, mc) {
    let bitIndex = 0;
    let upward = true;

    for (let x = mc - 1; x > 0; x -= 2) {
      if (x === 6) x -= 1;

      for (let offset = 0; offset < mc; offset += 1) {
        const y = upward ? mc - 1 - offset : offset;

        for (let dx = 0; dx < 2; dx += 1) {
          const px = x - dx;
          if (reserved[y][px] || matrix[y][px] !== null) continue;

          const bit = bitIndex < dataBits.length ? dataBits[bitIndex] : 0;
          matrix[y][px] = bit;
          bitIndex += 1;
        }
      }

      upward = !upward;
    }
  }

  function applyMask(matrix, reserved, maskPattern, mc) {
    for (let y = 0; y < mc; y += 1) {
      for (let x = 0; x < mc; x += 1) {
        if (reserved[y][x] || matrix[y][x] === null) continue;
        let invert = false;
        switch (maskPattern) {
          case 0: invert = (x + y) % 2 === 0; break;
          default: invert = false;
        }
        if (invert) matrix[y][x] = matrix[y][x] ? 0 : 1;
      }
    }
  }

  function buildMatrix(text, version) {
    const mc = moduleCount(version);
    const matrix = createMatrix(mc);
    const reserved = createReservedMatrix(mc);

    drawFinder(matrix, reserved, 0, 0, mc);
    drawFinder(matrix, reserved, mc - 7, 0, mc);
    drawFinder(matrix, reserved, 0, mc - 7, mc);

    // Alignment patterns
    const positions = ALIGNMENT_POSITIONS[version] || [];
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = 0; j < positions.length; j += 1) {
        const cx = positions[i];
        const cy = positions[j];
        // Skip if overlaps with finder
        if ((cx <= 8 && cy <= 8) || (cx <= 8 && cy >= mc - 8) || (cx >= mc - 8 && cy <= 8)) {
          continue;
        }
        drawAlignment(matrix, reserved, cx, cy, mc);
      }
    }

    // Timing patterns
    for (let i = 8; i < mc - 8; i += 1) {
      reserveModule(reserved, i, 6, mc);
      reserveModule(reserved, 6, i, mc);
      setModule(matrix, reserved, i, 6, i % 2 === 0 ? 1 : 0, mc);
      setModule(matrix, reserved, 6, i, i % 2 === 0 ? 1 : 0, mc);
    }

    // Dark module
    reserveModule(reserved, 8, 4 * version + 9, mc);
    setModule(matrix, reserved, 8, 4 * version + 9, 1, mc);

    reserveFormatAreas(reserved, mc);

    if (version >= 7) {
      placeVersionBits(matrix, reserved, versionBits(version), mc);
    }

    const interleavedCodewords = generateCodewords(text, version);
    const dataBits = [];
    for (let i = 0; i < interleavedCodewords.length; i += 1) {
      const codeword = interleavedCodewords[i];
      for (let bit = 7; bit >= 0; bit -= 1) {
        dataBits.push((codeword >> bit) & 1);
      }
    }

    placeData(matrix, reserved, dataBits, mc);
    applyMask(matrix, reserved, MASK_PATTERN, mc);
    placeFormatBits(matrix, reserved, formatBits(EC_LEVEL_BITS, MASK_PATTERN), mc);

    return matrix;
  }

  function drawMatrixToCanvas(canvas, matrix, lightColor, darkColor, width, height) {
    const mc = matrix.length;
    // quietSize includes the mandatory 4-module quiet zone on each side
    const quietSize = mc + (QUIET_ZONE * 2);
    const moduleSize = Math.max(1, Math.floor(Math.min(width, height) / quietSize));
    // Center the entire QR (including quiet zone) in the canvas
    const totalPx = quietSize * moduleSize;
    const offsetX = Math.floor((width - totalPx) / 2) + QUIET_ZONE * moduleSize;
    const offsetY = Math.floor((height - totalPx) / 2) + QUIET_ZONE * moduleSize;
    const dotRadius = (moduleSize / 2) * 0.85;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = lightColor;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = darkColor;

    function isFinder(x, y) {
      return (x < 7 && y < 7) || (x >= mc - 7 && y < 7) || (x < 7 && y >= mc - 7);
    }

    for (let y = 0; y < mc; y += 1) {
      for (let x = 0; x < mc; x += 1) {
        if (matrix[y][x] === 1) {
          const px = offsetX + (x * moduleSize);
          const py = offsetY + (y * moduleSize);

          if (isFinder(x, y)) {
            // Draw finder modules as slightly rounded squares
            const r = moduleSize * 0.15;
            ctx.beginPath();
            ctx.roundRect(px, py, moduleSize, moduleSize, r);
            ctx.fill();
          } else {
            // Draw data modules as circles
            ctx.beginPath();
            ctx.arc(px + moduleSize / 2, py + moduleSize / 2, dotRadius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
  }

  window.QRCode = function (element, options) {
    this._el = element;
    this._options = options || {};
    this._options.width = options.width || 240;
    this._options.height = options.height || 240;
    this._options.colorDark = options.colorDark || '#000000';
    this._options.colorLight = options.colorLight || '#ffffff';
    this._options.correctLevel = options.correctLevel || (window.QRCode ? window.QRCode.CorrectLevel.L : 1);

    console.log('QRCode: Init with text length', (this._options.text || '').length);
    if (!this._options.text) return;
    try {
      this._draw();
    } catch (e) {
      console.error('QRCode: Draw failed', e);
    }
  };

  window.QRCode.prototype._draw = function () {
    const canvas = document.createElement('canvas');
    const size = this._options.width || 240;
    canvas.width = size;
    canvas.height = size;
    this._el.innerHTML = '';
    this._el.appendChild(canvas);

    const bytes = toUtf8Bytes(this._options.text);
    const version = selectVersion(bytes.length);

    const matrix = buildMatrix(this._options.text, version);
    drawMatrixToCanvas(
      canvas,
      matrix,
      this._options.colorLight,
      this._options.colorDark,
      this._options.width,
      this._options.height
    );
  };

  window.QRCode.CorrectLevel = { L: 1, M: 2, Q: 3, H: 4 };
})();
