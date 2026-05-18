/**
 * David Shim's qrcode.js ported to modern TypeScript.
 * Cleaned, fully-typed, and bundled as an ES module.
 */

// ── Constants & Enums ────────────────────────────────────────────────────────

export const QRMode = {
  MODE_NUMBER: 1,
  MODE_ALPHA_NUM: 2,
  MODE_8BIT_BYTE: 4,
  MODE_KANJI: 8,
} as const;

export const QRErrorCorrectLevel = {
  L: 1, // 7% recovery
  M: 0, // 15% recovery
  Q: 3, // 25% recovery
  H: 2, // 30% recovery
} as const;

export const QRMaskPattern = {
  PATTERN000: 0,
  PATTERN001: 1,
  PATTERN010: 2,
  PATTERN011: 3,
  PATTERN100: 4,
  PATTERN101: 5,
  PATTERN110: 6,
  PATTERN111: 7,
} as const;

// ── Types ───────────────────────────────────────────────────────────────────

export interface QRCodeOptions {
  text?: string;
  width?: number;
  height?: number;
  typeNumber?: number;
  colorDark?: string;
  colorLight?: string;
  correctLevel?: number;
}

// ── Galois Field GF(256) Math ───────────────────────────────────────────────

const EXP_TABLE = new Array<number>(256);
const LOG_TABLE = new Array<number>(256);

for (let i = 0; i < 8; i++) {
  EXP_TABLE[i] = 1 << i;
}
for (let i = 8; i < 256; i++) {
  EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
}
for (let i = 0; i < 255; i++) {
  LOG_TABLE[EXP_TABLE[i]] = i;
}

export const QRMath = {
  glog(n: number): number {
    if (n < 1) {
      throw new Error(`glog(${n})`);
    }
    return LOG_TABLE[n];
  },
  gexp(n: number): number {
    while (n < 0) {
      n += 255;
    }
    while (n >= 256) {
      n -= 255;
    }
    return EXP_TABLE[n];
  },
};

// ── Helpers & Polynomial Arithmetic ─────────────────────────────────────────

export class QRPolynomial {
  num: number[];

  constructor(num: number[], shift: number) {
    let offset = 0;
    while (offset < num.length && num[offset] === 0) {
      offset++;
    }
    this.num = new Array<number>(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i++) {
      this.num[i] = num[i + offset];
    }
  }

  get(index: number): number {
    return this.num[index];
  }

  getLength(): number {
    return this.num.length;
  }

  multiply(e: QRPolynomial): QRPolynomial {
    const len = this.getLength() + e.getLength() - 1;
    const num = new Array<number>(len).fill(0);
    for (let i = 0; i < this.getLength(); i++) {
      for (let j = 0; j < e.getLength(); j++) {
        num[i + j] ^= QRMath.gexp(QRMath.glog(this.get(i)) + QRMath.glog(e.get(j)));
      }
    }
    return new QRPolynomial(num, 0);
  }

  mod(e: QRPolynomial): QRPolynomial {
    if (this.getLength() - e.getLength() < 0) {
      return this;
    }
    const ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0));
    const num = new Array<number>(this.getLength());
    for (let i = 0; i < this.getLength(); i++) {
      num[i] = this.get(i);
    }
    for (let i = 0; i < e.getLength(); i++) {
      num[i] ^= QRMath.gexp(QRMath.glog(e.get(i)) + ratio);
    }
    return new QRPolynomial(num, 0).mod(e);
  }
}

// ── Bit Stream Buffer ────────────────────────────────────────────────────────

export class QRBitBuffer {
  buffer: number[];
  length: number;

  constructor() {
    this.buffer = [];
    this.length = 0;
  }

  get(index: number): boolean {
    const bufIdx = Math.floor(index / 8);
    return ((this.buffer[bufIdx] >>> (7 - (index % 8))) & 1) === 1;
  }

  put(num: number, length: number): void {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }

  getLengthInBits(): number {
    return this.length;
  }

  putBit(bit: boolean): void {
    const bufIdx = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIdx) {
      this.buffer.push(0);
    }
    if (bit) {
      this.buffer[bufIdx] |= 0x80 >>> (this.length % 8);
    }
    this.length++;
  }
}

// ── Byte Stream Encoder ──────────────────────────────────────────────────────

export class QR8BitByte {
  mode: number;
  data: string;
  parsedData: number[];

  constructor(data: string) {
    this.mode = QRMode.MODE_8BIT_BYTE;
    this.data = data;
    this.parsedData = [];

    const byteList: number[] = [];
    for (let i = 0, len = this.data.length; i < len; i++) {
      const code = this.data.charCodeAt(i);
      if (code > 0xffff) {
        byteList[0] = 0xf0 | ((0x1c0000 & code) >>> 18);
        byteList[1] = 0x80 | ((0x3f000 & code) >>> 12);
        byteList[2] = 0x80 | ((0xfc0 & code) >>> 6);
        byteList[3] = 0x80 | (0x3f & code);
      } else if (code > 0x7ff) {
        byteList[0] = 0xe0 | ((0xf000 & code) >>> 12);
        byteList[1] = 0x80 | ((0xfc0 & code) >>> 6);
        byteList[2] = 0x80 | (0x3f & code);
      } else if (code > 0x7f) {
        byteList[0] = 0xc0 | ((0x7c0 & code) >>> 6);
        byteList[1] = 0x80 | (0x3f & code);
      } else {
        byteList[0] = code;
      }
      this.parsedData = this.parsedData.concat(byteList.slice(0, code > 0xffff ? 4 : code > 0x7ff ? 3 : code > 0x7f ? 2 : 1));
    }

    if (this.parsedData.length !== this.data.length) {
      // Prepend UTF-8 BOM
      this.parsedData.unshift(191);
      this.parsedData.unshift(187);
      this.parsedData.unshift(239);
    }
  }

  getLength(): number {
    return this.parsedData.length;
  }

  write(buffer: QRBitBuffer): void {
    for (let i = 0, len = this.parsedData.length; i < len; i++) {
      buffer.put(this.parsedData[i], 8);
    }
  }
}

// ── Error Correction Block Structures ────────────────────────────────────────

export class QRRSBlock {
  totalCount: number;
  dataCount: number;

  constructor(totalCount: number, dataCount: number) {
    this.totalCount = totalCount;
    this.dataCount = dataCount;
  }

  static getRSBlocks(typeNumber: number, errorCorrectLevel: number): QRRSBlock[] {
    const list = QRRSBlock.getRsBlockTable(typeNumber, errorCorrectLevel);
    if (!list) {
      throw new Error(`bad rs block @ typeNumber:${typeNumber}/errorCorrectLevel:${errorCorrectLevel}`);
    }
    const count = list.length / 3;
    const blocks: QRRSBlock[] = [];
    for (let i = 0; i < count; i++) {
      const numBlocks = list[i * 3 + 0];
      const totalCount = list[i * 3 + 1];
      const dataCount = list[i * 3 + 2];
      for (let j = 0; j < numBlocks; j++) {
        blocks.push(new QRRSBlock(totalCount, dataCount));
      }
    }
    return blocks;
  }

  static getRsBlockTable(typeNumber: number, errorCorrectLevel: number): number[] | undefined {
    switch (errorCorrectLevel) {
      case QRErrorCorrectLevel.L:
        return QRRSBlock.RS_BLOCK_TABLE[4 * (typeNumber - 1) + 0];
      case QRErrorCorrectLevel.M:
        return QRRSBlock.RS_BLOCK_TABLE[4 * (typeNumber - 1) + 1];
      case QRErrorCorrectLevel.Q:
        return QRRSBlock.RS_BLOCK_TABLE[4 * (typeNumber - 1) + 2];
      case QRErrorCorrectLevel.H:
        return QRRSBlock.RS_BLOCK_TABLE[4 * (typeNumber - 1) + 3];
      default:
        return undefined;
    }
  }

  static RS_BLOCK_TABLE: number[][] = [
    [1, 26, 19], [1, 26, 16], [1, 26, 13], [1, 26, 9],
    [1, 44, 34], [1, 44, 28], [1, 44, 22], [1, 44, 16],
    [1, 70, 55], [1, 70, 44], [2, 35, 17], [2, 35, 13],
    [1, 100, 80], [2, 50, 32], [2, 50, 24], [4, 25, 9],
    [1, 134, 108], [2, 67, 43], [2, 33, 15, 2, 34, 16], [2, 33, 11, 2, 34, 12],
    [2, 86, 68], [4, 43, 27], [4, 43, 19], [4, 43, 15],
    [2, 98, 78], [4, 49, 31], [2, 32, 14, 4, 33, 15], [4, 39, 13, 1, 40, 14],
    [2, 121, 97], [2, 60, 38, 2, 61, 39], [4, 40, 18, 2, 41, 19], [4, 40, 14, 2, 41, 15],
    [2, 146, 116], [3, 58, 36, 2, 59, 37], [4, 36, 16, 4, 37, 17], [4, 36, 12, 4, 37, 13],
    [2, 86, 68, 2, 87, 69], [4, 69, 43, 1, 70, 44], [6, 43, 19, 2, 44, 20], [6, 43, 15, 2, 44, 16],
    [4, 101, 81], [1, 80, 50, 4, 81, 51], [4, 50, 22, 4, 51, 23], [3, 36, 12, 8, 37, 13],
    [2, 116, 92, 2, 117, 93], [6, 58, 36, 2, 59, 37], [4, 46, 20, 6, 47, 21], [7, 42, 14, 4, 43, 15],
    [4, 133, 107], [8, 59, 37, 1, 60, 38], [8, 44, 20, 4, 45, 21], [12, 33, 11, 4, 34, 12],
    [3, 145, 115, 1, 146, 116], [4, 64, 40, 5, 65, 41], [11, 36, 16, 5, 37, 17], [11, 36, 12, 5, 37, 13],
    [5, 109, 87, 1, 110, 88], [5, 65, 41, 5, 66, 42], [5, 54, 24, 7, 55, 25], [11, 36, 12],
    [5, 122, 98, 1, 123, 99], [7, 73, 45, 3, 74, 46], [15, 43, 19, 2, 44, 20], [3, 45, 15, 13, 46, 16],
    [1, 135, 107, 5, 136, 108], [10, 74, 46, 1, 75, 47], [1, 50, 22, 15, 51, 23], [2, 42, 14, 17, 43, 15],
    [5, 150, 120, 1, 151, 121], [9, 69, 43, 4, 70, 44], [17, 50, 22, 1, 51, 23], [2, 42, 14, 19, 43, 15],
    [3, 141, 113, 4, 142, 114], [3, 70, 44, 11, 71, 45], [17, 47, 21, 4, 48, 22], [9, 39, 13, 16, 40, 14],
    [3, 135, 107, 5, 136, 108], [3, 67, 41, 13, 68, 42], [15, 54, 24, 5, 55, 25], [15, 43, 15, 10, 44, 16],
    [4, 144, 116, 4, 145, 117], [17, 68, 42], [17, 50, 22, 6, 51, 23], [19, 46, 16, 6, 47, 17],
    [2, 139, 111, 7, 140, 112], [17, 74, 46], [7, 54, 24, 16, 55, 25], [34, 37, 13],
    [4, 151, 121, 5, 152, 122], [4, 75, 47, 14, 76, 48], [11, 54, 24, 14, 55, 25], [16, 45, 15, 14, 46, 16],
    [6, 147, 117, 4, 148, 118], [6, 73, 45, 14, 74, 46], [11, 54, 24, 16, 55, 25], [30, 46, 16, 2, 47, 17],
    [8, 132, 106, 4, 133, 107], [8, 75, 47, 13, 76, 48], [7, 54, 24, 22, 55, 25], [22, 45, 15, 13, 46, 16],
    [10, 142, 114, 2, 143, 115], [19, 74, 46, 4, 75, 47], [28, 50, 22, 6, 51, 23], [33, 46, 16, 4, 47, 17],
    [8, 152, 122, 4, 153, 123], [22, 73, 45, 3, 74, 46], [8, 53, 23, 26, 54, 24], [12, 45, 15, 28, 46, 16],
    [3, 147, 117, 10, 148, 118], [3, 73, 45, 23, 74, 46], [4, 54, 24, 31, 55, 25], [11, 45, 15, 31, 46, 16],
    [7, 146, 116, 7, 147, 117], [21, 73, 45, 7, 74, 46], [1, 53, 23, 37, 54, 24], [19, 45, 15, 26, 46, 16],
    [5, 145, 115, 10, 146, 116], [19, 75, 47, 10, 76, 48], [15, 54, 24, 25, 55, 25], [23, 45, 15, 25, 46, 16],
    [13, 145, 115, 3, 146, 116], [2, 74, 46, 29, 75, 47], [42, 54, 24, 1, 55, 25], [23, 45, 15, 28, 46, 16],
    [17, 145, 115], [10, 74, 46, 23, 75, 47], [10, 54, 24, 35, 55, 25], [19, 45, 15, 35, 46, 16],
    [17, 145, 115, 1, 146, 116], [14, 74, 46, 21, 75, 47], [29, 54, 24, 19, 55, 25], [11, 45, 15, 46, 46, 16],
    [13, 145, 115, 6, 146, 116], [14, 74, 46, 23, 75, 47], [44, 54, 24, 7, 55, 25], [59, 46, 16, 1, 47, 17],
    [12, 151, 121, 7, 152, 122], [12, 75, 47, 26, 76, 48], [39, 54, 24, 14, 55, 25], [22, 45, 15, 41, 46, 16],
    [6, 151, 121, 14, 152, 122], [6, 75, 47, 34, 76, 48], [46, 54, 24, 10, 55, 25], [2, 45, 15, 64, 46, 16],
    [17, 152, 122, 4, 153, 123], [29, 74, 46, 14, 75, 47], [49, 54, 24, 10, 55, 25], [24, 45, 15, 46, 46, 16],
    [4, 152, 122, 18, 153, 123], [13, 74, 46, 32, 75, 47], [48, 54, 24, 14, 55, 25], [42, 45, 15, 32, 46, 16],
    [20, 147, 117, 4, 148, 118], [40, 75, 47, 7, 76, 48], [43, 54, 24, 22, 55, 25], [10, 45, 15, 67, 46, 16],
    [19, 148, 118, 6, 149, 119], [18, 75, 47, 31, 76, 48], [34, 54, 24, 34, 55, 25], [20, 45, 15, 61, 46, 16],
  ];
}

// ── QR Utility Helper Functions ─────────────────────────────────────────────

export const QRUtil = {
  PATTERN_POSITION_TABLE: [
    [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
    [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78],
    [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98],
    [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134],
    [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150],
    [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162],
    [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170]
  ] as number[][],

  G15: 1335,
  G18: 7973,
  G15_MASK: 21522,

  getBCHTypeInfo(data: number): number {
    let r = data << 10;
    while (this.getBCHDigit(r) - this.getBCHDigit(this.G15) >= 0) {
      r ^= this.G15 << (this.getBCHDigit(r) - this.getBCHDigit(this.G15));
    }
    return ((data << 10) | r) ^ this.G15_MASK;
  },

  getBCHTypeNumber(data: number): number {
    let r = data << 12;
    while (this.getBCHDigit(r) - this.getBCHDigit(this.G18) >= 0) {
      r ^= this.G18 << (this.getBCHDigit(r) - this.getBCHDigit(this.G18));
    }
    return (data << 12) | r;
  },

  getBCHDigit(data: number): number {
    let digit = 0;
    let temp = data;
    while (temp !== 0) {
      digit++;
      temp >>>= 1;
    }
    return digit;
  },

  getPatternPosition(typeNumber: number): number[] {
    return this.PATTERN_POSITION_TABLE[typeNumber - 1];
  },

  getMask(maskPattern: number, i: number, j: number): boolean {
    switch (maskPattern) {
      case QRMaskPattern.PATTERN000:
        return (i + j) % 2 === 0;
      case QRMaskPattern.PATTERN001:
        return i % 2 === 0;
      case QRMaskPattern.PATTERN010:
        return j % 3 === 0;
      case QRMaskPattern.PATTERN011:
        return (i + j) % 3 === 0;
      case QRMaskPattern.PATTERN100:
        return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
      case QRMaskPattern.PATTERN101:
        return ((i * j) % 2) + ((i * j) % 3) === 0;
      case QRMaskPattern.PATTERN110:
        return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
      case QRMaskPattern.PATTERN111:
        return (((i * j) % 3) + ((i + j) % 2)) % 2 === 0;
      default:
        throw new Error(`bad maskPattern: ${maskPattern}`);
    }
  },

  getErrorCorrectPolynomial(errorCorrectLength: number): QRPolynomial {
    let a = new QRPolynomial([1], 0);
    for (let i = 0; i < errorCorrectLength; i++) {
      a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0));
    }
    return a;
  },

  getLengthInBits(mode: number, type: number): number {
    if (type >= 1 && type < 10) {
      switch (mode) {
        case QRMode.MODE_NUMBER: return 10;
        case QRMode.MODE_ALPHA_NUM: return 9;
        case QRMode.MODE_8BIT_BYTE: return 8;
        case QRMode.MODE_KANJI: return 8;
        default: throw new Error(`mode: ${mode}`);
      }
    } else if (type < 27) {
      switch (mode) {
        case QRMode.MODE_NUMBER: return 12;
        case QRMode.MODE_ALPHA_NUM: return 11;
        case QRMode.MODE_8BIT_BYTE: return 16;
        case QRMode.MODE_KANJI: return 10;
        default: throw new Error(`mode: ${mode}`);
      }
    } else if (type < 41) {
      switch (mode) {
        case QRMode.MODE_NUMBER: return 14;
        case QRMode.MODE_ALPHA_NUM: return 13;
        case QRMode.MODE_8BIT_BYTE: return 16;
        case QRMode.MODE_KANJI: return 12;
        default: throw new Error(`mode: ${mode}`);
      }
    } else {
      throw new Error(`type: ${type}`);
    }
  },

  getLostPoint(qrCode: QRCodeModel): number {
    const count = qrCode.getModuleCount();
    let lostPoint = 0;

    // Level 1
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        let sameCount = 0;
        const dark = qrCode.isDark(row, col);
        for (let r = -1; r <= 1; r++) {
          if (row + r < 0 || count <= row + r) continue;
          for (let c = -1; c <= 1; c++) {
            if (col + c < 0 || count <= col + c) continue;
            if (r === 0 && c === 0) continue;
            if (dark === qrCode.isDark(row + r, col + c)) {
              sameCount++;
            }
          }
        }
        if (sameCount > 5) {
          lostPoint += 3 + sameCount - 5;
        }
      }
    }

    // Level 2
    for (let row = 0; row < count - 1; row++) {
      for (let col = 0; col < count - 1; col++) {
        let countDark = 0;
        if (qrCode.isDark(row, col)) countDark++;
        if (qrCode.isDark(row + 1, col)) countDark++;
        if (qrCode.isDark(row, col + 1)) countDark++;
        if (qrCode.isDark(row + 1, col + 1)) countDark++;
        if (countDark === 0 || countDark === 4) {
          lostPoint += 3;
        }
      }
    }

    // Level 3
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count - 6; col++) {
        if (
          qrCode.isDark(row, col) &&
          !qrCode.isDark(row, col + 1) &&
          qrCode.isDark(row, col + 2) &&
          qrCode.isDark(row, col + 3) &&
          qrCode.isDark(row, col + 4) &&
          !qrCode.isDark(row, col + 5) &&
          qrCode.isDark(row, col + 6)
        ) {
          lostPoint += 40;
        }
      }
    }
    for (let col = 0; col < count; col++) {
      for (let row = 0; row < count - 6; row++) {
        if (
          qrCode.isDark(row, col) &&
          !qrCode.isDark(row + 1, col) &&
          qrCode.isDark(row + 2, col) &&
          qrCode.isDark(row + 3, col) &&
          qrCode.isDark(row + 4, col) &&
          !qrCode.isDark(row + 5, col) &&
          qrCode.isDark(row + 6, col)
        ) {
          lostPoint += 40;
        }
      }
    }

    // Level 4
    let darkCount = 0;
    for (let col = 0; col < count; col++) {
      for (let row = 0; row < count; row++) {
        if (qrCode.isDark(row, col)) {
          darkCount++;
        }
      }
    }
    const ratio = Math.abs((100 * darkCount) / count / count - 50) / 5;
    lostPoint += ratio * 10;

    return lostPoint;
  },
};

// ── QR Code State Model ──────────────────────────────────────────────────────

export class QRCodeModel {
  typeNumber: number;
  errorCorrectLevel: number;
  modules: (boolean | null)[][] | null;
  moduleCount: number;
  dataCache: number[] | null;
  dataList: QR8BitByte[];

  constructor(typeNumber: number, errorCorrectLevel: number) {
    this.typeNumber = typeNumber;
    this.errorCorrectLevel = errorCorrectLevel;
    this.modules = null;
    this.moduleCount = 0;
    this.dataCache = null;
    this.dataList = [];
  }

  addData(data: string): void {
    const newData = new QR8BitByte(data);
    this.dataList.push(newData);
    this.dataCache = null;
  }

  isDark(row: number, col: number): boolean {
    if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) {
      throw new Error(`Invalid row/col coordinate: ${row},${col}`);
    }
    if (!this.modules) {
      return false;
    }
    return this.modules[row][col] || false;
  }

  getModuleCount(): number {
    return this.moduleCount;
  }

  make(): void {
    this.makeImpl(false, this.getBestMaskPattern());
  }

  makeImpl(test: boolean, maskPattern: number): void {
    this.moduleCount = this.typeNumber * 4 + 17;
    this.modules = new Array<(boolean | null)[]>(this.moduleCount);
    for (let i = 0; i < this.moduleCount; i++) {
      this.modules[i] = new Array<boolean | null>(this.moduleCount).fill(null);
    }

    this.setupPositionProbePattern(0, 0);
    this.setupPositionProbePattern(this.moduleCount - 7, 0);
    this.setupPositionProbePattern(0, this.moduleCount - 7);
    this.setupPositionAdjustPattern();
    this.setupTimingPattern();
    this.setupTypeInfo(test, maskPattern);

    if (this.typeNumber >= 7) {
      this.setupTypeNumber(test);
    }

    if (this.dataCache === null) {
      this.dataCache = QRCodeModel.createData(this.typeNumber, this.errorCorrectLevel, this.dataList);
    }

    this.mapData(this.dataCache, maskPattern);
  }

  setupPositionProbePattern(row: number, col: number): void {
    for (let r = -1; r <= 7; r++) {
      if (row + r <= -1 || this.moduleCount <= row + r) continue;
      for (let c = -1; c <= 7; c++) {
        if (col + c <= -1 || this.moduleCount <= col + c) continue;
        if (!this.modules) continue;
        this.modules[row + r][col + c] =
          (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
          (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
          (2 <= r && r <= 4 && 2 <= c && c <= 4);
      }
    }
  }

  getBestMaskPattern(): number {
    let minLostPoint = 0;
    let bestMaskPattern = 0;
    for (let i = 0; i < 8; i++) {
      this.makeImpl(true, i);
      const lostPoint = QRUtil.getLostPoint(this);
      if (i === 0 || minLostPoint > lostPoint) {
        minLostPoint = lostPoint;
        bestMaskPattern = i;
      }
    }
    return bestMaskPattern;
  }

  setupTimingPattern(): void {
    if (!this.modules) return;
    for (let r = 8; r < this.moduleCount - 8; r++) {
      if (this.modules[r][6] !== null) continue;
      this.modules[r][6] = r % 2 === 0;
    }
    for (let c = 8; c < this.moduleCount - 8; c++) {
      if (this.modules[6][c] !== null) continue;
      this.modules[6][c] = c % 2 === 0;
    }
  }

  setupPositionAdjustPattern(): void {
    const pos = QRUtil.getPatternPosition(this.typeNumber);
    if (!this.modules) return;
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        const row = pos[i];
        const col = pos[j];
        if (this.modules[row][col] !== null) continue;
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            this.modules[row + r][col + c] = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
          }
        }
      }
    }
  }

  setupTypeNumber(test: boolean): void {
    const bits = QRUtil.getBCHTypeNumber(this.typeNumber);
    if (!this.modules) return;
    for (let i = 0; i < 18; i++) {
      const mod = !test && ((bits >> i) & 1) === 1;
      this.modules[Math.floor(i / 3)][(i % 3) + this.moduleCount - 8 - 3] = mod;
    }
    for (let i = 0; i < 18; i++) {
      const mod = !test && ((bits >> i) & 1) === 1;
      this.modules[(i % 3) + this.moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
    }
  }

  setupTypeInfo(test: boolean, maskPattern: number): void {
    const data = (this.errorCorrectLevel << 3) | maskPattern;
    const bits = QRUtil.getBCHTypeInfo(data);
    if (!this.modules) return;
    for (let i = 0; i < 15; i++) {
      const mod = !test && ((bits >> i) & 1) === 1;
      if (i < 6) {
        this.modules[i][8] = mod;
      } else if (i < 8) {
        this.modules[i + 1][8] = mod;
      } else {
        this.modules[this.moduleCount - 15 + i][8] = mod;
      }
    }
    for (let i = 0; i < 15; i++) {
      const mod = !test && ((bits >> i) & 1) === 1;
      if (i < 8) {
        this.modules[8][this.moduleCount - i - 1] = mod;
      } else if (i < 9) {
        this.modules[8][15 - i - 1 + 1] = mod;
      } else {
        this.modules[8][15 - i - 1] = mod;
      }
    }
    this.modules[this.moduleCount - 8][8] = !test;
  }

  mapData(data: number[], maskPattern: number): void {
    let inc = -1;
    let row = this.moduleCount - 1;
    let bitIndex = 7;
    let byteIndex = 0;
    if (!this.modules) return;

    for (let col = this.moduleCount - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      while (true) {
        for (let c = 0; c < 2; c++) {
          if (this.modules[row][col - c] === null) {
            let dark = false;
            if (byteIndex < data.length) {
              dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
            }
            const mask = QRUtil.getMask(maskPattern, row, col - c);
            if (mask) {
              dark = !dark;
            }
            this.modules[row][col - c] = dark;
            bitIndex--;
            if (bitIndex === -1) {
              byteIndex++;
              bitIndex = 7;
            }
          }
        }
        row += inc;
        if (row < 0 || this.moduleCount <= row) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  }

  static PAD0 = 236;
  static PAD1 = 17;

  static createData(typeNumber: number, errorCorrectLevel: number, dataList: QR8BitByte[]): number[] {
    const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectLevel);
    const buffer = new QRBitBuffer();

    for (let i = 0; i < dataList.length; i++) {
      const data = dataList[i];
      buffer.put(data.mode, 4);
      buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber));
      data.write(buffer);
    }

    let totalDataCount = 0;
    for (let i = 0; i < rsBlocks.length; i++) {
      totalDataCount += rsBlocks[i].dataCount;
    }

    if (buffer.getLengthInBits() > totalDataCount * 8) {
      throw new Error(`code length overflow. (${buffer.getLengthInBits()}>${totalDataCount * 8})`);
    }

    if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
      buffer.put(0, 4);
    }

    while (buffer.getLengthInBits() % 8 !== 0) {
      buffer.putBit(false);
    }

    while (true) {
      if (buffer.getLengthInBits() >= totalDataCount * 8) {
        break;
      }
      buffer.put(QRCodeModel.PAD0, 8);
      if (buffer.getLengthInBits() >= totalDataCount * 8) {
        break;
      }
      buffer.put(QRCodeModel.PAD1, 8);
    }

    return QRCodeModel.createBytes(buffer, rsBlocks);
  }

  static createBytes(buffer: QRBitBuffer, rsBlocks: QRRSBlock[]): number[] {
    let offset = 0;
    let maxDcCount = 0;
    let maxEcCount = 0;
    const dcData = new Array<number[]>(rsBlocks.length);
    const ecData = new Array<number[]>(rsBlocks.length);

    for (let r = 0; r < rsBlocks.length; r++) {
      const dcCount = rsBlocks[r].dataCount;
      const ecCount = rsBlocks[r].totalCount - dcCount;
      maxDcCount = Math.max(maxDcCount, dcCount);
      maxEcCount = Math.max(maxEcCount, ecCount);
      dcData[r] = new Array<number>(dcCount);
      for (let i = 0; i < dcData[r].length; i++) {
        dcData[r][i] = 0xff & buffer.buffer[i + offset];
      }
      offset += dcCount;

      const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
      const rawPoly = new QRPolynomial(dcData[r], rsPoly.getLength() - 1);
      const modPoly = rawPoly.mod(rsPoly);
      ecData[r] = new Array<number>(rsPoly.getLength() - 1);
      for (let i = 0; i < ecData[r].length; i++) {
        const modIdx = i + modPoly.getLength() - ecData[r].length;
        ecData[r][i] = modIdx >= 0 ? modPoly.get(modIdx) : 0;
      }
    }

    let totalCodeCount = 0;
    for (let i = 0; i < rsBlocks.length; i++) {
      totalCodeCount += rsBlocks[i].totalCount;
    }

    const data = new Array<number>(totalCodeCount);
    let index = 0;
    for (let i = 0; i < maxDcCount; i++) {
      for (let r = 0; r < rsBlocks.length; r++) {
        if (i < dcData[r].length) {
          data[index++] = dcData[r][i];
        }
      }
    }
    for (let i = 0; i < maxEcCount; i++) {
      for (let r = 0; r < rsBlocks.length; r++) {
        if (i < ecData[r].length) {
          data[index++] = ecData[r][i];
        }
      }
    }

    return data;
  }
}

// ── Vector & Raster Renderers ────────────────────────────────────────────────

class SVGDrawing {
  private _el: HTMLElement;
  private _htOption: Required<QRCodeOptions>;

  constructor(el: HTMLElement, htOption: Required<QRCodeOptions>) {
    this._el = el;
    this._htOption = htOption;
  }

  draw(qrCode: QRCodeModel): void {
    const opt = this._htOption;
    const el = this._el;
    const count = qrCode.getModuleCount();

    this.clear();

    const makeSvgElement = (name: string, attrs: Record<string, string>): SVGElement => {
      const element = document.createElementNS("http://www.w3.org/2000/svg", name);
      for (const key in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, key)) {
          element.setAttribute(key, attrs[key]);
        }
      }
      return element;
    };

    const svg = makeSvgElement("svg", {
      viewBox: `0 0 ${count} ${count}`,
      width: "100%",
      height: "100%",
      fill: opt.colorLight,
    });

    svg.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:xlink", "http://www.w3.org/1999/xlink");
    el.appendChild(svg);

    svg.appendChild(
      makeSvgElement("rect", {
        fill: opt.colorDark,
        width: "1",
        height: "1",
        id: "template",
      })
    );

    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qrCode.isDark(row, col)) {
          const use = makeSvgElement("use", {
            x: String(col),
            y: String(row),
          });
          use.setAttributeNS("http://www.w3.org/1999/xlink", "href", "#template");
          svg.appendChild(use);
        }
      }
    }
  }

  clear(): void {
    while (this._el.hasChildNodes()) {
      this._el.removeChild(this._el.lastChild!);
    }
  }
}

class CanvasDrawing {
  private _el: HTMLElement;
  private _htOption: Required<QRCodeOptions>;
  private _elCanvas: HTMLCanvasElement;
  private _oContext: CanvasRenderingContext2D;
  private _elImage: HTMLImageElement;
  private _bIsPainted = false;

  constructor(el: HTMLElement, htOption: Required<QRCodeOptions>) {
    this._el = el;
    this._htOption = htOption;
    this._elCanvas = document.createElement("canvas");
    this._elCanvas.width = htOption.width;
    this._elCanvas.height = htOption.height;
    el.appendChild(this._elCanvas);
    this._oContext = this._elCanvas.getContext("2d")!;
    this._elImage = document.createElement("img");
    this._elImage.style.display = "none";
    el.appendChild(this._elImage);
  }

  draw(qrCode: QRCodeModel): void {
    const opt = this._htOption;
    const ctx = this._oContext;
    const count = qrCode.getModuleCount();
    const cellWidth = opt.width / count;
    const cellHeight = opt.height / count;
    const roundW = Math.round(cellWidth);
    const roundH = Math.round(cellHeight);

    this._elImage.style.display = "none";
    this._elCanvas.style.display = "block";
    this.clear();

    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        const isDark = qrCode.isDark(row, col);
        const x = col * cellWidth;
        const y = row * cellHeight;

        ctx.strokeStyle = isDark ? opt.colorDark : opt.colorLight;
        ctx.lineWidth = 1;
        ctx.fillStyle = isDark ? opt.colorDark : opt.colorLight;

        ctx.fillRect(x, y, cellWidth, cellHeight);
        ctx.strokeRect(Math.floor(x) + 0.5, Math.floor(y) + 0.5, roundW, roundH);
        ctx.strokeRect(Math.ceil(x) - 0.5, Math.ceil(y) - 0.5, roundW, roundH);
      }
    }
    this._bIsPainted = true;
  }

  makeImage(): void {
    if (this._bIsPainted) {
      try {
        this._elImage.src = this._elCanvas.toDataURL("image/png");
        this._elImage.style.display = "block";
        this._elCanvas.style.display = "none";
      } catch (e) {
        console.error("Failed to generate QR image from canvas", e);
      }
    }
  }

  clear(): void {
    this._oContext.clearRect(0, 0, this._elCanvas.width, this._elCanvas.height);
    this._bIsPainted = false;
  }
}

class TableDrawing {
  private _el: HTMLElement;
  private _htOption: Required<QRCodeOptions>;

  constructor(el: HTMLElement, htOption: Required<QRCodeOptions>) {
    this._el = el;
    this._htOption = htOption;
  }

  draw(qrCode: QRCodeModel): void {
    const opt = this._htOption;
    const count = qrCode.getModuleCount();
    const cellWidth = Math.floor(opt.width / count);
    const cellHeight = Math.floor(opt.height / count);

    const html: string[] = ['<table style="border:0;border-collapse:collapse;">'];
    for (let row = 0; row < count; row++) {
      html.push("<tr>");
      for (let col = 0; col < count; col++) {
        const color = qrCode.isDark(row, col) ? opt.colorDark : opt.colorLight;
        html.push(
          `<td style="border:0;border-collapse:collapse;padding:0;margin:0;width:${cellWidth}px;height:${cellHeight}px;background-color:${color};"></td>`
        );
      }
      html.push("</tr>");
    }
    html.push("</table>");
    this._el.innerHTML = html.join("");

    const table = this._el.childNodes[0] as HTMLElement;
    const marginX = (opt.width - table.offsetWidth) / 2;
    const marginY = (opt.height - table.offsetHeight) / 2;
    if (marginX > 0 && marginY > 0) {
      table.style.margin = `${marginY}px ${marginX}px`;
    }
  }

  clear(): void {
    this._el.innerHTML = "";
  }
}

// ── Main Class ───────────────────────────────────────────────────────────────

const CAPACITY_TABLE = [
  [17, 14, 11, 7], [32, 26, 20, 14], [53, 42, 32, 24], [78, 62, 46, 34],
  [106, 84, 60, 44], [134, 106, 74, 58], [154, 122, 86, 64], [192, 152, 108, 84],
  [230, 180, 130, 98], [271, 213, 151, 119], [321, 251, 177, 137], [367, 287, 203, 155],
  [425, 331, 241, 177], [458, 362, 258, 194], [520, 412, 292, 220], [586, 450, 322, 250],
  [644, 504, 364, 280], [718, 560, 394, 310], [792, 624, 442, 338], [858, 666, 482, 382],
  [929, 711, 509, 403], [1003, 779, 565, 439], [1091, 857, 611, 461], [1171, 911, 661, 511],
  [1273, 997, 715, 535], [1367, 1059, 751, 593], [1465, 1125, 805, 625], [1528, 1190, 868, 658],
  [1628, 1264, 908, 698], [1732, 1370, 982, 742], [1840, 1452, 1030, 790], [1952, 1538, 1112, 842],
  [2068, 1628, 1168, 898], [2188, 1722, 1228, 958], [2303, 1809, 1283, 983], [2431, 1911, 1351, 1051],
  [2563, 1989, 1423, 1093], [2699, 2099, 1499, 1139], [2809, 2213, 1579, 1219], [2953, 2331, 1663, 1273]
];

function getBestVersion(text: string, correctLevel: number): number {
  const byteLen = encodeURI(text).toString().replace(/\%[0-9a-fA-F]{2}/g, "a").length;
  const len = byteLen + (byteLen !== text.length ? 3 : 0);

  for (let typeNum = 1; typeNum <= CAPACITY_TABLE.length; typeNum++) {
    let limit = 0;
    switch (correctLevel) {
      case QRErrorCorrectLevel.L: limit = CAPACITY_TABLE[typeNum - 1][0]; break;
      case QRErrorCorrectLevel.M: limit = CAPACITY_TABLE[typeNum - 1][1]; break;
      case QRErrorCorrectLevel.Q: limit = CAPACITY_TABLE[typeNum - 1][2]; break;
      case QRErrorCorrectLevel.H: limit = CAPACITY_TABLE[typeNum - 1][3]; break;
    }
    if (limit >= len) {
      return typeNum;
    }
  }
  throw new Error("Data is too long for QR Code capacity limit");
}

export class QRCode {
  private _htOption: Required<QRCodeOptions>;
  private _el: HTMLElement;
  private _oQRCode: QRCodeModel | null;
  private _oDrawing: SVGDrawing | CanvasDrawing | TableDrawing;

  static CorrectLevel = QRErrorCorrectLevel;

  constructor(el: HTMLElement, options: string | QRCodeOptions) {
    this._htOption = {
      width: 256,
      height: 256,
      typeNumber: 4,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRErrorCorrectLevel.H,
      text: "",
    };

    if (typeof options === "string") {
      this._htOption.text = options;
    } else if (options) {
      Object.assign(this._htOption, options);
    }

    this._el = el;
    this._oQRCode = null;

    const isSvg = typeof document !== "undefined" && document.documentElement && document.documentElement.tagName.toLowerCase() === "svg";
    const useCanvas = typeof HTMLCanvasElement !== "undefined";
    const DrawingClass = isSvg ? SVGDrawing : useCanvas ? CanvasDrawing : TableDrawing;

    this._oDrawing = new DrawingClass(this._el, this._htOption);

    if (this._htOption.text) {
      this.makeCode(this._htOption.text);
    }
  }

  makeCode(text: string): void {
    const version = getBestVersion(text, this._htOption.correctLevel);
    this._oQRCode = new QRCodeModel(version, this._htOption.correctLevel);
    this._oQRCode.addData(text);
    this._oQRCode.make();
    this._el.title = text;
    this._oDrawing.draw(this._oQRCode);
    this.makeImage();
  }

  makeImage(): void {
    if (this._oDrawing instanceof CanvasDrawing) {
      this._oDrawing.makeImage();
    }
  }

  clear(): void {
    this._oDrawing.clear();
  }
}
