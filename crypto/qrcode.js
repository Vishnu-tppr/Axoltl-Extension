/*! QRCode.js - Local QR encoder for Manifest V3
 * Version 6-L encoder with real Reed-Solomon correction.
 */

(function () {
  const VERSION = 6;
  const MODULE_COUNT = 21 + ((VERSION - 1) * 4);
  const DATA_CODEWORDS = 136;
  const ECC_CODEWORDS_PER_BLOCK = 18;
  const BLOCK_SIZES = [68, 68];
  const QUIET_ZONE = 2;
  const EC_LEVEL_BITS = 0b01; // L
  const MASK_PATTERN = 0;
  const FORMAT_MASK = 0b101010000010010;
  const FORMAT_POLY = 0b10100110111;
  const VERSION_POLY = 0b1111100100101;

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
    while (num > 0) {
      num >>= 1;
      bits += 1;
    }
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

  function createBitBuffer() {
    const bits = [];
    return {
      put(num, length) {
        for (let i = length - 1; i >= 0; i -= 1) {
          bits.push((num >> i) & 1);
        }
      },
      getBits() {
        return bits;
      },
    };
  }

  function encodePayload(text) {
    const bytes = toUtf8Bytes(text);
    if (bytes.length > 255) {
      throw new Error('QR payload is too long for this pairing code');
    }

    const buffer = createBitBuffer();
    buffer.put(0b0100, 4);
    buffer.put(bytes.length, 8);

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

  function generateCodewords(text) {
    const dataCodewords = encodePayload(text);
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

  function createMatrix() {
    return Array.from({ length: MODULE_COUNT }, () => Array(MODULE_COUNT).fill(null));
  }

  function createReservedMatrix() {
    return Array.from({ length: MODULE_COUNT }, () => Array(MODULE_COUNT).fill(false));
  }

  function setModule(matrix, reserved, x, y, value, lock = true) {
    if (x < 0 || y < 0 || x >= MODULE_COUNT || y >= MODULE_COUNT) return;
    matrix[y][x] = value ? 1 : 0;
    if (lock) reserved[y][x] = true;
  }

  function reserveModule(reserved, x, y) {
    if (x < 0 || y < 0 || x >= MODULE_COUNT || y >= MODULE_COUNT) return;
    reserved[y][x] = true;
  }

  function drawFinder(matrix, reserved, x, y) {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= MODULE_COUNT || py >= MODULE_COUNT) continue;

        reserveModule(reserved, px, py);

        if (dx === -1 || dx === 7 || dy === -1 || dy === 7) {
          setModule(matrix, reserved, px, py, 0);
        } else if (dx === 0 || dx === 6 || dy === 0 || dy === 6) {
          setModule(matrix, reserved, px, py, 1);
        } else if (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4) {
          setModule(matrix, reserved, px, py, 1);
        } else {
          setModule(matrix, reserved, px, py, 0);
        }
      }
    }
  }

  function drawAlignment(matrix, reserved, centerX, centerY) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const px = centerX + dx;
        const py = centerY + dy;
        if (px < 0 || py < 0 || px >= MODULE_COUNT || py >= MODULE_COUNT) continue;
        reserveModule(reserved, px, py);

        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        setModule(matrix, reserved, px, py, distance === 0 || distance === 2 ? 1 : 0);
      }
    }
  }

  function reserveFormatAreas(reserved) {
    for (let i = 0; i <= 8; i += 1) {
      if (i !== 6) {
        reserveModule(reserved, 8, i);
        reserveModule(reserved, i, 8);
      }
    }

    for (let i = 0; i < 8; i += 1) {
      reserveModule(reserved, MODULE_COUNT - 1 - i, 8);
    }
    for (let i = 0; i < 7; i += 1) {
      reserveModule(reserved, 8, MODULE_COUNT - 7 + i);
    }
  }

  function placeFormatBits(matrix, reserved, bits) {
    const firstPositions = [
      [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
      [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
    ];

    const secondPositions = [
      [MODULE_COUNT - 1, 8], [MODULE_COUNT - 2, 8], [MODULE_COUNT - 3, 8], [MODULE_COUNT - 4, 8],
      [MODULE_COUNT - 5, 8], [MODULE_COUNT - 6, 8], [MODULE_COUNT - 7, 8], [MODULE_COUNT - 8, 8],
      [8, MODULE_COUNT - 7], [8, MODULE_COUNT - 6], [8, MODULE_COUNT - 5], [8, MODULE_COUNT - 4],
      [8, MODULE_COUNT - 3], [8, MODULE_COUNT - 2], [8, MODULE_COUNT - 1],
    ];

    for (let i = 0; i < 15; i += 1) {
      const bit = (bits >> i) & 1;
      const [x1, y1] = firstPositions[i];
      const [x2, y2] = secondPositions[i];
      setModule(matrix, reserved, x1, y1, bit, true);
      setModule(matrix, reserved, x2, y2, bit, true);
    }
  }

  function placeVersionBits(matrix, reserved, bits) {
    const topRight = [
      [MODULE_COUNT - 11, 0], [MODULE_COUNT - 11, 1], [MODULE_COUNT - 11, 2],
      [MODULE_COUNT - 10, 0], [MODULE_COUNT - 10, 1], [MODULE_COUNT - 10, 2],
      [MODULE_COUNT - 9, 0], [MODULE_COUNT - 9, 1], [MODULE_COUNT - 9, 2],
      [MODULE_COUNT - 8, 0], [MODULE_COUNT - 8, 1], [MODULE_COUNT - 8, 2],
      [MODULE_COUNT - 7, 0], [MODULE_COUNT - 7, 1], [MODULE_COUNT - 7, 2],
      [MODULE_COUNT - 6, 0], [MODULE_COUNT - 6, 1], [MODULE_COUNT - 6, 2],
    ];

    const bottomLeft = [
      [0, MODULE_COUNT - 11], [1, MODULE_COUNT - 11], [2, MODULE_COUNT - 11],
      [0, MODULE_COUNT - 10], [1, MODULE_COUNT - 10], [2, MODULE_COUNT - 10],
      [0, MODULE_COUNT - 9], [1, MODULE_COUNT - 9], [2, MODULE_COUNT - 9],
      [0, MODULE_COUNT - 8], [1, MODULE_COUNT - 8], [2, MODULE_COUNT - 8],
      [0, MODULE_COUNT - 7], [1, MODULE_COUNT - 7], [2, MODULE_COUNT - 7],
      [0, MODULE_COUNT - 6], [1, MODULE_COUNT - 6], [2, MODULE_COUNT - 6],
    ];

    for (let i = 0; i < 18; i += 1) {
      const bit = (bits >> i) & 1;
      const [x1, y1] = bottomLeft[i];
      const [x2, y2] = topRight[i];
      setModule(matrix, reserved, x1, y1, bit, true);
      setModule(matrix, reserved, x2, y2, bit, true);
    }
  }

  function placeData(matrix, reserved, dataBits) {
    let bitIndex = 0;
    let upward = true;

    for (let x = MODULE_COUNT - 1; x > 0; x -= 2) {
      if (x === 6) x -= 1;

      for (let offset = 0; offset < MODULE_COUNT; offset += 1) {
        const y = upward ? MODULE_COUNT - 1 - offset : offset;

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

  function applyMask(matrix, reserved, maskPattern) {
    for (let y = 0; y < MODULE_COUNT; y += 1) {
      for (let x = 0; x < MODULE_COUNT; x += 1) {
        if (reserved[y][x] || matrix[y][x] === null) continue;

        let invert = false;
        switch (maskPattern) {
          case 0:
            invert = (x + y) % 2 === 0;
            break;
          default:
            invert = false;
        }

        if (invert) matrix[y][x] = matrix[y][x] ? 0 : 1;
      }
    }
  }

  function buildMatrix(text) {
    const matrix = createMatrix();
    const reserved = createReservedMatrix();

    drawFinder(matrix, reserved, 0, 0);
    drawFinder(matrix, reserved, MODULE_COUNT - 7, 0);
    drawFinder(matrix, reserved, 0, MODULE_COUNT - 7);

    const alignmentCenters = [6, 34];
    for (let i = 0; i < alignmentCenters.length; i += 1) {
      for (let j = 0; j < alignmentCenters.length; j += 1) {
        const centerX = alignmentCenters[i];
        const centerY = alignmentCenters[j];

        if ((centerX === 6 && centerY === 6) || (centerX === 6 && centerY === MODULE_COUNT - 7) || (centerX === MODULE_COUNT - 7 && centerY === 6)) {
          continue;
        }

        drawAlignment(matrix, reserved, centerX, centerY);
      }
    }

    for (let i = 8; i < MODULE_COUNT - 8; i += 1) {
      reserveModule(reserved, i, 6);
      reserveModule(reserved, 6, i);
      setModule(matrix, reserved, i, 6, i % 2 === 0 ? 1 : 0);
      setModule(matrix, reserved, 6, i, i % 2 === 0 ? 1 : 0);
    }

    reserveModule(reserved, 8, 4 * VERSION + 9);
    setModule(matrix, reserved, 8, 4 * VERSION + 9, 1);

    reserveFormatAreas(reserved);

    if (VERSION >= 7) {
      placeVersionBits(matrix, reserved, versionBits(VERSION));
    }

    const interleavedCodewords = generateCodewords(text);
    const dataBits = [];
    for (let i = 0; i < interleavedCodewords.length; i += 1) {
      const codeword = interleavedCodewords[i];
      for (let bit = 7; bit >= 0; bit -= 1) {
        dataBits.push((codeword >> bit) & 1);
      }
    }

    placeData(matrix, reserved, dataBits);
    applyMask(matrix, reserved, MASK_PATTERN);
    placeFormatBits(matrix, reserved, formatBits(EC_LEVEL_BITS, MASK_PATTERN));

    return matrix;
  }

  function drawMatrixToCanvas(canvas, matrix, lightColor, darkColor, width, height) {
    const quietSize = matrix.length + (QUIET_ZONE * 2);
    const moduleSize = Math.max(1, Math.floor(Math.min(width, height) / quietSize));
    const drawnSize = quietSize * moduleSize;
    const offsetX = Math.floor((width - drawnSize) / 2);
    const offsetY = Math.floor((height - drawnSize) / 2);

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = lightColor;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = darkColor;
    for (let y = 0; y < matrix.length; y += 1) {
      for (let x = 0; x < matrix.length; x += 1) {
        if (matrix[y][x] === 1) {
          ctx.fillRect(
            offsetX + ((x + QUIET_ZONE) * moduleSize),
            offsetY + ((y + QUIET_ZONE) * moduleSize),
            moduleSize,
            moduleSize
          );
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

    if (!this._options.text) return;
    this._draw();
  };

  window.QRCode.prototype._draw = function () {
    const canvas = document.createElement('canvas');
    this._el.innerHTML = '';
    this._el.appendChild(canvas);

    const matrix = buildMatrix(this._options.text);
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
