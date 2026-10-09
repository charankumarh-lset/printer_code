#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/pngjs/lib/chunkstream.js
var require_chunkstream = __commonJS({
  "node_modules/pngjs/lib/chunkstream.js"(exports2, module2) {
    "use strict";
    var util = require("util");
    var Stream = require("stream");
    var ChunkStream = module2.exports = function() {
      Stream.call(this);
      this._buffers = [];
      this._buffered = 0;
      this._reads = [];
      this._paused = false;
      this._encoding = "utf8";
      this.writable = true;
    };
    util.inherits(ChunkStream, Stream);
    ChunkStream.prototype.read = function(length, callback) {
      this._reads.push({
        length: Math.abs(length),
        // if length < 0 then at most this length
        allowLess: length < 0,
        func: callback
      });
      process.nextTick(
        function() {
          this._process();
          if (this._paused && this._reads && this._reads.length > 0) {
            this._paused = false;
            this.emit("drain");
          }
        }.bind(this)
      );
    };
    ChunkStream.prototype.write = function(data, encoding) {
      if (!this.writable) {
        this.emit("error", new Error("Stream not writable"));
        return false;
      }
      let dataBuffer;
      if (Buffer.isBuffer(data)) {
        dataBuffer = data;
      } else {
        dataBuffer = Buffer.from(data, encoding || this._encoding);
      }
      this._buffers.push(dataBuffer);
      this._buffered += dataBuffer.length;
      this._process();
      if (this._reads && this._reads.length === 0) {
        this._paused = true;
      }
      return this.writable && !this._paused;
    };
    ChunkStream.prototype.end = function(data, encoding) {
      if (data) {
        this.write(data, encoding);
      }
      this.writable = false;
      if (!this._buffers) {
        return;
      }
      if (this._buffers.length === 0) {
        this._end();
      } else {
        this._buffers.push(null);
        this._process();
      }
    };
    ChunkStream.prototype.destroySoon = ChunkStream.prototype.end;
    ChunkStream.prototype._end = function() {
      if (this._reads.length > 0) {
        this.emit("error", new Error("Unexpected end of input"));
      }
      this.destroy();
    };
    ChunkStream.prototype.destroy = function() {
      if (!this._buffers) {
        return;
      }
      this.writable = false;
      this._reads = null;
      this._buffers = null;
      this.emit("close");
    };
    ChunkStream.prototype._processReadAllowingLess = function(read) {
      this._reads.shift();
      let smallerBuf = this._buffers[0];
      if (smallerBuf.length > read.length) {
        this._buffered -= read.length;
        this._buffers[0] = smallerBuf.slice(read.length);
        read.func.call(this, smallerBuf.slice(0, read.length));
      } else {
        this._buffered -= smallerBuf.length;
        this._buffers.shift();
        read.func.call(this, smallerBuf);
      }
    };
    ChunkStream.prototype._processRead = function(read) {
      this._reads.shift();
      let pos = 0;
      let count = 0;
      let data = Buffer.alloc(read.length);
      while (pos < read.length) {
        let buf = this._buffers[count++];
        let len = Math.min(buf.length, read.length - pos);
        buf.copy(data, pos, 0, len);
        pos += len;
        if (len !== buf.length) {
          this._buffers[--count] = buf.slice(len);
        }
      }
      if (count > 0) {
        this._buffers.splice(0, count);
      }
      this._buffered -= read.length;
      read.func.call(this, data);
    };
    ChunkStream.prototype._process = function() {
      try {
        while (this._buffered > 0 && this._reads && this._reads.length > 0) {
          let read = this._reads[0];
          if (read.allowLess) {
            this._processReadAllowingLess(read);
          } else if (this._buffered >= read.length) {
            this._processRead(read);
          } else {
            break;
          }
        }
        if (this._buffers && !this.writable) {
          this._end();
        }
      } catch (ex) {
        this.emit("error", ex);
      }
    };
  }
});

// node_modules/pngjs/lib/interlace.js
var require_interlace = __commonJS({
  "node_modules/pngjs/lib/interlace.js"(exports2) {
    "use strict";
    var imagePasses = [
      {
        // pass 1 - 1px
        x: [0],
        y: [0]
      },
      {
        // pass 2 - 1px
        x: [4],
        y: [0]
      },
      {
        // pass 3 - 2px
        x: [0, 4],
        y: [4]
      },
      {
        // pass 4 - 4px
        x: [2, 6],
        y: [0, 4]
      },
      {
        // pass 5 - 8px
        x: [0, 2, 4, 6],
        y: [2, 6]
      },
      {
        // pass 6 - 16px
        x: [1, 3, 5, 7],
        y: [0, 2, 4, 6]
      },
      {
        // pass 7 - 32px
        x: [0, 1, 2, 3, 4, 5, 6, 7],
        y: [1, 3, 5, 7]
      }
    ];
    exports2.getImagePasses = function(width, height) {
      let images = [];
      let xLeftOver = width % 8;
      let yLeftOver = height % 8;
      let xRepeats = (width - xLeftOver) / 8;
      let yRepeats = (height - yLeftOver) / 8;
      for (let i = 0; i < imagePasses.length; i++) {
        let pass = imagePasses[i];
        let passWidth = xRepeats * pass.x.length;
        let passHeight = yRepeats * pass.y.length;
        for (let j = 0; j < pass.x.length; j++) {
          if (pass.x[j] < xLeftOver) {
            passWidth++;
          } else {
            break;
          }
        }
        for (let j = 0; j < pass.y.length; j++) {
          if (pass.y[j] < yLeftOver) {
            passHeight++;
          } else {
            break;
          }
        }
        if (passWidth > 0 && passHeight > 0) {
          images.push({ width: passWidth, height: passHeight, index: i });
        }
      }
      return images;
    };
    exports2.getInterlaceIterator = function(width) {
      return function(x, y, pass) {
        let outerXLeftOver = x % imagePasses[pass].x.length;
        let outerX = (x - outerXLeftOver) / imagePasses[pass].x.length * 8 + imagePasses[pass].x[outerXLeftOver];
        let outerYLeftOver = y % imagePasses[pass].y.length;
        let outerY = (y - outerYLeftOver) / imagePasses[pass].y.length * 8 + imagePasses[pass].y[outerYLeftOver];
        return outerX * 4 + outerY * width * 4;
      };
    };
  }
});

// node_modules/pngjs/lib/paeth-predictor.js
var require_paeth_predictor = __commonJS({
  "node_modules/pngjs/lib/paeth-predictor.js"(exports2, module2) {
    "use strict";
    module2.exports = function paethPredictor(left, above, upLeft) {
      let paeth = left + above - upLeft;
      let pLeft = Math.abs(paeth - left);
      let pAbove = Math.abs(paeth - above);
      let pUpLeft = Math.abs(paeth - upLeft);
      if (pLeft <= pAbove && pLeft <= pUpLeft) {
        return left;
      }
      if (pAbove <= pUpLeft) {
        return above;
      }
      return upLeft;
    };
  }
});

// node_modules/pngjs/lib/filter-parse.js
var require_filter_parse = __commonJS({
  "node_modules/pngjs/lib/filter-parse.js"(exports2, module2) {
    "use strict";
    var interlaceUtils = require_interlace();
    var paethPredictor = require_paeth_predictor();
    function getByteWidth(width, bpp, depth) {
      let byteWidth = width * bpp;
      if (depth !== 8) {
        byteWidth = Math.ceil(byteWidth / (8 / depth));
      }
      return byteWidth;
    }
    var Filter = module2.exports = function(bitmapInfo, dependencies) {
      let width = bitmapInfo.width;
      let height = bitmapInfo.height;
      let interlace = bitmapInfo.interlace;
      let bpp = bitmapInfo.bpp;
      let depth = bitmapInfo.depth;
      this.read = dependencies.read;
      this.write = dependencies.write;
      this.complete = dependencies.complete;
      this._imageIndex = 0;
      this._images = [];
      if (interlace) {
        let passes = interlaceUtils.getImagePasses(width, height);
        for (let i = 0; i < passes.length; i++) {
          this._images.push({
            byteWidth: getByteWidth(passes[i].width, bpp, depth),
            height: passes[i].height,
            lineIndex: 0
          });
        }
      } else {
        this._images.push({
          byteWidth: getByteWidth(width, bpp, depth),
          height,
          lineIndex: 0
        });
      }
      if (depth === 8) {
        this._xComparison = bpp;
      } else if (depth === 16) {
        this._xComparison = bpp * 2;
      } else {
        this._xComparison = 1;
      }
    };
    Filter.prototype.start = function() {
      this.read(
        this._images[this._imageIndex].byteWidth + 1,
        this._reverseFilterLine.bind(this)
      );
    };
    Filter.prototype._unFilterType1 = function(rawData, unfilteredLine, byteWidth) {
      let xComparison = this._xComparison;
      let xBiggerThan = xComparison - 1;
      for (let x = 0; x < byteWidth; x++) {
        let rawByte = rawData[1 + x];
        let f1Left = x > xBiggerThan ? unfilteredLine[x - xComparison] : 0;
        unfilteredLine[x] = rawByte + f1Left;
      }
    };
    Filter.prototype._unFilterType2 = function(rawData, unfilteredLine, byteWidth) {
      let lastLine = this._lastLine;
      for (let x = 0; x < byteWidth; x++) {
        let rawByte = rawData[1 + x];
        let f2Up = lastLine ? lastLine[x] : 0;
        unfilteredLine[x] = rawByte + f2Up;
      }
    };
    Filter.prototype._unFilterType3 = function(rawData, unfilteredLine, byteWidth) {
      let xComparison = this._xComparison;
      let xBiggerThan = xComparison - 1;
      let lastLine = this._lastLine;
      for (let x = 0; x < byteWidth; x++) {
        let rawByte = rawData[1 + x];
        let f3Up = lastLine ? lastLine[x] : 0;
        let f3Left = x > xBiggerThan ? unfilteredLine[x - xComparison] : 0;
        let f3Add = Math.floor((f3Left + f3Up) / 2);
        unfilteredLine[x] = rawByte + f3Add;
      }
    };
    Filter.prototype._unFilterType4 = function(rawData, unfilteredLine, byteWidth) {
      let xComparison = this._xComparison;
      let xBiggerThan = xComparison - 1;
      let lastLine = this._lastLine;
      for (let x = 0; x < byteWidth; x++) {
        let rawByte = rawData[1 + x];
        let f4Up = lastLine ? lastLine[x] : 0;
        let f4Left = x > xBiggerThan ? unfilteredLine[x - xComparison] : 0;
        let f4UpLeft = x > xBiggerThan && lastLine ? lastLine[x - xComparison] : 0;
        let f4Add = paethPredictor(f4Left, f4Up, f4UpLeft);
        unfilteredLine[x] = rawByte + f4Add;
      }
    };
    Filter.prototype._reverseFilterLine = function(rawData) {
      let filter = rawData[0];
      let unfilteredLine;
      let currentImage = this._images[this._imageIndex];
      let byteWidth = currentImage.byteWidth;
      if (filter === 0) {
        unfilteredLine = rawData.slice(1, byteWidth + 1);
      } else {
        unfilteredLine = Buffer.alloc(byteWidth);
        switch (filter) {
          case 1:
            this._unFilterType1(rawData, unfilteredLine, byteWidth);
            break;
          case 2:
            this._unFilterType2(rawData, unfilteredLine, byteWidth);
            break;
          case 3:
            this._unFilterType3(rawData, unfilteredLine, byteWidth);
            break;
          case 4:
            this._unFilterType4(rawData, unfilteredLine, byteWidth);
            break;
          default:
            throw new Error("Unrecognised filter type - " + filter);
        }
      }
      this.write(unfilteredLine);
      currentImage.lineIndex++;
      if (currentImage.lineIndex >= currentImage.height) {
        this._lastLine = null;
        this._imageIndex++;
        currentImage = this._images[this._imageIndex];
      } else {
        this._lastLine = unfilteredLine;
      }
      if (currentImage) {
        this.read(currentImage.byteWidth + 1, this._reverseFilterLine.bind(this));
      } else {
        this._lastLine = null;
        this.complete();
      }
    };
  }
});

// node_modules/pngjs/lib/filter-parse-async.js
var require_filter_parse_async = __commonJS({
  "node_modules/pngjs/lib/filter-parse-async.js"(exports2, module2) {
    "use strict";
    var util = require("util");
    var ChunkStream = require_chunkstream();
    var Filter = require_filter_parse();
    var FilterAsync = module2.exports = function(bitmapInfo) {
      ChunkStream.call(this);
      let buffers = [];
      let that = this;
      this._filter = new Filter(bitmapInfo, {
        read: this.read.bind(this),
        write: function(buffer) {
          buffers.push(buffer);
        },
        complete: function() {
          that.emit("complete", Buffer.concat(buffers));
        }
      });
      this._filter.start();
    };
    util.inherits(FilterAsync, ChunkStream);
  }
});

// node_modules/pngjs/lib/constants.js
var require_constants = __commonJS({
  "node_modules/pngjs/lib/constants.js"(exports2, module2) {
    "use strict";
    module2.exports = {
      PNG_SIGNATURE: [137, 80, 78, 71, 13, 10, 26, 10],
      TYPE_IHDR: 1229472850,
      TYPE_IEND: 1229278788,
      TYPE_IDAT: 1229209940,
      TYPE_PLTE: 1347179589,
      TYPE_tRNS: 1951551059,
      // eslint-disable-line camelcase
      TYPE_gAMA: 1732332865,
      // eslint-disable-line camelcase
      // color-type bits
      COLORTYPE_GRAYSCALE: 0,
      COLORTYPE_PALETTE: 1,
      COLORTYPE_COLOR: 2,
      COLORTYPE_ALPHA: 4,
      // e.g. grayscale and alpha
      // color-type combinations
      COLORTYPE_PALETTE_COLOR: 3,
      COLORTYPE_COLOR_ALPHA: 6,
      COLORTYPE_TO_BPP_MAP: {
        0: 1,
        2: 3,
        3: 1,
        4: 2,
        6: 4
      },
      GAMMA_DIVISION: 1e5
    };
  }
});

// node_modules/pngjs/lib/crc.js
var require_crc = __commonJS({
  "node_modules/pngjs/lib/crc.js"(exports2, module2) {
    "use strict";
    var crcTable = [];
    (function() {
      for (let i = 0; i < 256; i++) {
        let currentCrc = i;
        for (let j = 0; j < 8; j++) {
          if (currentCrc & 1) {
            currentCrc = 3988292384 ^ currentCrc >>> 1;
          } else {
            currentCrc = currentCrc >>> 1;
          }
        }
        crcTable[i] = currentCrc;
      }
    })();
    var CrcCalculator = module2.exports = function() {
      this._crc = -1;
    };
    CrcCalculator.prototype.write = function(data) {
      for (let i = 0; i < data.length; i++) {
        this._crc = crcTable[(this._crc ^ data[i]) & 255] ^ this._crc >>> 8;
      }
      return true;
    };
    CrcCalculator.prototype.crc32 = function() {
      return this._crc ^ -1;
    };
    CrcCalculator.crc32 = function(buf) {
      let crc = -1;
      for (let i = 0; i < buf.length; i++) {
        crc = crcTable[(crc ^ buf[i]) & 255] ^ crc >>> 8;
      }
      return crc ^ -1;
    };
  }
});

// node_modules/pngjs/lib/parser.js
var require_parser = __commonJS({
  "node_modules/pngjs/lib/parser.js"(exports2, module2) {
    "use strict";
    var constants = require_constants();
    var CrcCalculator = require_crc();
    var Parser = module2.exports = function(options, dependencies) {
      this._options = options;
      options.checkCRC = options.checkCRC !== false;
      this._hasIHDR = false;
      this._hasIEND = false;
      this._emittedHeadersFinished = false;
      this._palette = [];
      this._colorType = 0;
      this._chunks = {};
      this._chunks[constants.TYPE_IHDR] = this._handleIHDR.bind(this);
      this._chunks[constants.TYPE_IEND] = this._handleIEND.bind(this);
      this._chunks[constants.TYPE_IDAT] = this._handleIDAT.bind(this);
      this._chunks[constants.TYPE_PLTE] = this._handlePLTE.bind(this);
      this._chunks[constants.TYPE_tRNS] = this._handleTRNS.bind(this);
      this._chunks[constants.TYPE_gAMA] = this._handleGAMA.bind(this);
      this.read = dependencies.read;
      this.error = dependencies.error;
      this.metadata = dependencies.metadata;
      this.gamma = dependencies.gamma;
      this.transColor = dependencies.transColor;
      this.palette = dependencies.palette;
      this.parsed = dependencies.parsed;
      this.inflateData = dependencies.inflateData;
      this.finished = dependencies.finished;
      this.simpleTransparency = dependencies.simpleTransparency;
      this.headersFinished = dependencies.headersFinished || function() {
      };
    };
    Parser.prototype.start = function() {
      this.read(constants.PNG_SIGNATURE.length, this._parseSignature.bind(this));
    };
    Parser.prototype._parseSignature = function(data) {
      let signature = constants.PNG_SIGNATURE;
      for (let i = 0; i < signature.length; i++) {
        if (data[i] !== signature[i]) {
          this.error(new Error("Invalid file signature"));
          return;
        }
      }
      this.read(8, this._parseChunkBegin.bind(this));
    };
    Parser.prototype._parseChunkBegin = function(data) {
      let length = data.readUInt32BE(0);
      let type = data.readUInt32BE(4);
      let name = "";
      for (let i = 4; i < 8; i++) {
        name += String.fromCharCode(data[i]);
      }
      let ancillary = Boolean(data[4] & 32);
      if (!this._hasIHDR && type !== constants.TYPE_IHDR) {
        this.error(new Error("Expected IHDR on beggining"));
        return;
      }
      this._crc = new CrcCalculator();
      this._crc.write(Buffer.from(name));
      if (this._chunks[type]) {
        return this._chunks[type](length);
      }
      if (!ancillary) {
        this.error(new Error("Unsupported critical chunk type " + name));
        return;
      }
      this.read(length + 4, this._skipChunk.bind(this));
    };
    Parser.prototype._skipChunk = function() {
      this.read(8, this._parseChunkBegin.bind(this));
    };
    Parser.prototype._handleChunkEnd = function() {
      this.read(4, this._parseChunkEnd.bind(this));
    };
    Parser.prototype._parseChunkEnd = function(data) {
      let fileCrc = data.readInt32BE(0);
      let calcCrc = this._crc.crc32();
      if (this._options.checkCRC && calcCrc !== fileCrc) {
        this.error(new Error("Crc error - " + fileCrc + " - " + calcCrc));
        return;
      }
      if (!this._hasIEND) {
        this.read(8, this._parseChunkBegin.bind(this));
      }
    };
    Parser.prototype._handleIHDR = function(length) {
      this.read(length, this._parseIHDR.bind(this));
    };
    Parser.prototype._parseIHDR = function(data) {
      this._crc.write(data);
      let width = data.readUInt32BE(0);
      let height = data.readUInt32BE(4);
      let depth = data[8];
      let colorType = data[9];
      let compr = data[10];
      let filter = data[11];
      let interlace = data[12];
      if (depth !== 8 && depth !== 4 && depth !== 2 && depth !== 1 && depth !== 16) {
        this.error(new Error("Unsupported bit depth " + depth));
        return;
      }
      if (!(colorType in constants.COLORTYPE_TO_BPP_MAP)) {
        this.error(new Error("Unsupported color type"));
        return;
      }
      if (compr !== 0) {
        this.error(new Error("Unsupported compression method"));
        return;
      }
      if (filter !== 0) {
        this.error(new Error("Unsupported filter method"));
        return;
      }
      if (interlace !== 0 && interlace !== 1) {
        this.error(new Error("Unsupported interlace method"));
        return;
      }
      this._colorType = colorType;
      let bpp = constants.COLORTYPE_TO_BPP_MAP[this._colorType];
      this._hasIHDR = true;
      this.metadata({
        width,
        height,
        depth,
        interlace: Boolean(interlace),
        palette: Boolean(colorType & constants.COLORTYPE_PALETTE),
        color: Boolean(colorType & constants.COLORTYPE_COLOR),
        alpha: Boolean(colorType & constants.COLORTYPE_ALPHA),
        bpp,
        colorType
      });
      this._handleChunkEnd();
    };
    Parser.prototype._handlePLTE = function(length) {
      this.read(length, this._parsePLTE.bind(this));
    };
    Parser.prototype._parsePLTE = function(data) {
      this._crc.write(data);
      let entries = Math.floor(data.length / 3);
      for (let i = 0; i < entries; i++) {
        this._palette.push([data[i * 3], data[i * 3 + 1], data[i * 3 + 2], 255]);
      }
      this.palette(this._palette);
      this._handleChunkEnd();
    };
    Parser.prototype._handleTRNS = function(length) {
      this.simpleTransparency();
      this.read(length, this._parseTRNS.bind(this));
    };
    Parser.prototype._parseTRNS = function(data) {
      this._crc.write(data);
      if (this._colorType === constants.COLORTYPE_PALETTE_COLOR) {
        if (this._palette.length === 0) {
          this.error(new Error("Transparency chunk must be after palette"));
          return;
        }
        if (data.length > this._palette.length) {
          this.error(new Error("More transparent colors than palette size"));
          return;
        }
        for (let i = 0; i < data.length; i++) {
          this._palette[i][3] = data[i];
        }
        this.palette(this._palette);
      }
      if (this._colorType === constants.COLORTYPE_GRAYSCALE) {
        this.transColor([data.readUInt16BE(0)]);
      }
      if (this._colorType === constants.COLORTYPE_COLOR) {
        this.transColor([
          data.readUInt16BE(0),
          data.readUInt16BE(2),
          data.readUInt16BE(4)
        ]);
      }
      this._handleChunkEnd();
    };
    Parser.prototype._handleGAMA = function(length) {
      this.read(length, this._parseGAMA.bind(this));
    };
    Parser.prototype._parseGAMA = function(data) {
      this._crc.write(data);
      this.gamma(data.readUInt32BE(0) / constants.GAMMA_DIVISION);
      this._handleChunkEnd();
    };
    Parser.prototype._handleIDAT = function(length) {
      if (!this._emittedHeadersFinished) {
        this._emittedHeadersFinished = true;
        this.headersFinished();
      }
      this.read(-length, this._parseIDAT.bind(this, length));
    };
    Parser.prototype._parseIDAT = function(length, data) {
      this._crc.write(data);
      if (this._colorType === constants.COLORTYPE_PALETTE_COLOR && this._palette.length === 0) {
        throw new Error("Expected palette not found");
      }
      this.inflateData(data);
      let leftOverLength = length - data.length;
      if (leftOverLength > 0) {
        this._handleIDAT(leftOverLength);
      } else {
        this._handleChunkEnd();
      }
    };
    Parser.prototype._handleIEND = function(length) {
      this.read(length, this._parseIEND.bind(this));
    };
    Parser.prototype._parseIEND = function(data) {
      this._crc.write(data);
      this._hasIEND = true;
      this._handleChunkEnd();
      if (this.finished) {
        this.finished();
      }
    };
  }
});

// node_modules/pngjs/lib/bitmapper.js
var require_bitmapper = __commonJS({
  "node_modules/pngjs/lib/bitmapper.js"(exports2) {
    "use strict";
    var interlaceUtils = require_interlace();
    var pixelBppMapper = [
      // 0 - dummy entry
      function() {
      },
      // 1 - L
      // 0: 0, 1: 0, 2: 0, 3: 0xff
      function(pxData, data, pxPos, rawPos) {
        if (rawPos === data.length) {
          throw new Error("Ran out of data");
        }
        let pixel = data[rawPos];
        pxData[pxPos] = pixel;
        pxData[pxPos + 1] = pixel;
        pxData[pxPos + 2] = pixel;
        pxData[pxPos + 3] = 255;
      },
      // 2 - LA
      // 0: 0, 1: 0, 2: 0, 3: 1
      function(pxData, data, pxPos, rawPos) {
        if (rawPos + 1 >= data.length) {
          throw new Error("Ran out of data");
        }
        let pixel = data[rawPos];
        pxData[pxPos] = pixel;
        pxData[pxPos + 1] = pixel;
        pxData[pxPos + 2] = pixel;
        pxData[pxPos + 3] = data[rawPos + 1];
      },
      // 3 - RGB
      // 0: 0, 1: 1, 2: 2, 3: 0xff
      function(pxData, data, pxPos, rawPos) {
        if (rawPos + 2 >= data.length) {
          throw new Error("Ran out of data");
        }
        pxData[pxPos] = data[rawPos];
        pxData[pxPos + 1] = data[rawPos + 1];
        pxData[pxPos + 2] = data[rawPos + 2];
        pxData[pxPos + 3] = 255;
      },
      // 4 - RGBA
      // 0: 0, 1: 1, 2: 2, 3: 3
      function(pxData, data, pxPos, rawPos) {
        if (rawPos + 3 >= data.length) {
          throw new Error("Ran out of data");
        }
        pxData[pxPos] = data[rawPos];
        pxData[pxPos + 1] = data[rawPos + 1];
        pxData[pxPos + 2] = data[rawPos + 2];
        pxData[pxPos + 3] = data[rawPos + 3];
      }
    ];
    var pixelBppCustomMapper = [
      // 0 - dummy entry
      function() {
      },
      // 1 - L
      // 0: 0, 1: 0, 2: 0, 3: 0xff
      function(pxData, pixelData, pxPos, maxBit) {
        let pixel = pixelData[0];
        pxData[pxPos] = pixel;
        pxData[pxPos + 1] = pixel;
        pxData[pxPos + 2] = pixel;
        pxData[pxPos + 3] = maxBit;
      },
      // 2 - LA
      // 0: 0, 1: 0, 2: 0, 3: 1
      function(pxData, pixelData, pxPos) {
        let pixel = pixelData[0];
        pxData[pxPos] = pixel;
        pxData[pxPos + 1] = pixel;
        pxData[pxPos + 2] = pixel;
        pxData[pxPos + 3] = pixelData[1];
      },
      // 3 - RGB
      // 0: 0, 1: 1, 2: 2, 3: 0xff
      function(pxData, pixelData, pxPos, maxBit) {
        pxData[pxPos] = pixelData[0];
        pxData[pxPos + 1] = pixelData[1];
        pxData[pxPos + 2] = pixelData[2];
        pxData[pxPos + 3] = maxBit;
      },
      // 4 - RGBA
      // 0: 0, 1: 1, 2: 2, 3: 3
      function(pxData, pixelData, pxPos) {
        pxData[pxPos] = pixelData[0];
        pxData[pxPos + 1] = pixelData[1];
        pxData[pxPos + 2] = pixelData[2];
        pxData[pxPos + 3] = pixelData[3];
      }
    ];
    function bitRetriever(data, depth) {
      let leftOver = [];
      let i = 0;
      function split() {
        if (i === data.length) {
          throw new Error("Ran out of data");
        }
        let byte = data[i];
        i++;
        let byte8, byte7, byte6, byte5, byte4, byte3, byte2, byte1;
        switch (depth) {
          default:
            throw new Error("unrecognised depth");
          case 16:
            byte2 = data[i];
            i++;
            leftOver.push((byte << 8) + byte2);
            break;
          case 4:
            byte2 = byte & 15;
            byte1 = byte >> 4;
            leftOver.push(byte1, byte2);
            break;
          case 2:
            byte4 = byte & 3;
            byte3 = byte >> 2 & 3;
            byte2 = byte >> 4 & 3;
            byte1 = byte >> 6 & 3;
            leftOver.push(byte1, byte2, byte3, byte4);
            break;
          case 1:
            byte8 = byte & 1;
            byte7 = byte >> 1 & 1;
            byte6 = byte >> 2 & 1;
            byte5 = byte >> 3 & 1;
            byte4 = byte >> 4 & 1;
            byte3 = byte >> 5 & 1;
            byte2 = byte >> 6 & 1;
            byte1 = byte >> 7 & 1;
            leftOver.push(byte1, byte2, byte3, byte4, byte5, byte6, byte7, byte8);
            break;
        }
      }
      return {
        get: function(count) {
          while (leftOver.length < count) {
            split();
          }
          let returner = leftOver.slice(0, count);
          leftOver = leftOver.slice(count);
          return returner;
        },
        resetAfterLine: function() {
          leftOver.length = 0;
        },
        end: function() {
          if (i !== data.length) {
            throw new Error("extra data found");
          }
        }
      };
    }
    function mapImage8Bit(image, pxData, getPxPos, bpp, data, rawPos) {
      let imageWidth = image.width;
      let imageHeight = image.height;
      let imagePass = image.index;
      for (let y = 0; y < imageHeight; y++) {
        for (let x = 0; x < imageWidth; x++) {
          let pxPos = getPxPos(x, y, imagePass);
          pixelBppMapper[bpp](pxData, data, pxPos, rawPos);
          rawPos += bpp;
        }
      }
      return rawPos;
    }
    function mapImageCustomBit(image, pxData, getPxPos, bpp, bits, maxBit) {
      let imageWidth = image.width;
      let imageHeight = image.height;
      let imagePass = image.index;
      for (let y = 0; y < imageHeight; y++) {
        for (let x = 0; x < imageWidth; x++) {
          let pixelData = bits.get(bpp);
          let pxPos = getPxPos(x, y, imagePass);
          pixelBppCustomMapper[bpp](pxData, pixelData, pxPos, maxBit);
        }
        bits.resetAfterLine();
      }
    }
    exports2.dataToBitMap = function(data, bitmapInfo) {
      let width = bitmapInfo.width;
      let height = bitmapInfo.height;
      let depth = bitmapInfo.depth;
      let bpp = bitmapInfo.bpp;
      let interlace = bitmapInfo.interlace;
      let bits;
      if (depth !== 8) {
        bits = bitRetriever(data, depth);
      }
      let pxData;
      if (depth <= 8) {
        pxData = Buffer.alloc(width * height * 4);
      } else {
        pxData = new Uint16Array(width * height * 4);
      }
      let maxBit = Math.pow(2, depth) - 1;
      let rawPos = 0;
      let images;
      let getPxPos;
      if (interlace) {
        images = interlaceUtils.getImagePasses(width, height);
        getPxPos = interlaceUtils.getInterlaceIterator(width, height);
      } else {
        let nonInterlacedPxPos = 0;
        getPxPos = function() {
          let returner = nonInterlacedPxPos;
          nonInterlacedPxPos += 4;
          return returner;
        };
        images = [{ width, height }];
      }
      for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
        if (depth === 8) {
          rawPos = mapImage8Bit(
            images[imageIndex],
            pxData,
            getPxPos,
            bpp,
            data,
            rawPos
          );
        } else {
          mapImageCustomBit(
            images[imageIndex],
            pxData,
            getPxPos,
            bpp,
            bits,
            maxBit
          );
        }
      }
      if (depth === 8) {
        if (rawPos !== data.length) {
          throw new Error("extra data found");
        }
      } else {
        bits.end();
      }
      return pxData;
    };
  }
});

// node_modules/pngjs/lib/format-normaliser.js
var require_format_normaliser = __commonJS({
  "node_modules/pngjs/lib/format-normaliser.js"(exports2, module2) {
    "use strict";
    function dePalette(indata, outdata, width, height, palette) {
      let pxPos = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let color = palette[indata[pxPos]];
          if (!color) {
            throw new Error("index " + indata[pxPos] + " not in palette");
          }
          for (let i = 0; i < 4; i++) {
            outdata[pxPos + i] = color[i];
          }
          pxPos += 4;
        }
      }
    }
    function replaceTransparentColor(indata, outdata, width, height, transColor) {
      let pxPos = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let makeTrans = false;
          if (transColor.length === 1) {
            if (transColor[0] === indata[pxPos]) {
              makeTrans = true;
            }
          } else if (transColor[0] === indata[pxPos] && transColor[1] === indata[pxPos + 1] && transColor[2] === indata[pxPos + 2]) {
            makeTrans = true;
          }
          if (makeTrans) {
            for (let i = 0; i < 4; i++) {
              outdata[pxPos + i] = 0;
            }
          }
          pxPos += 4;
        }
      }
    }
    function scaleDepth(indata, outdata, width, height, depth) {
      let maxOutSample = 255;
      let maxInSample = Math.pow(2, depth) - 1;
      let pxPos = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          for (let i = 0; i < 4; i++) {
            outdata[pxPos + i] = Math.floor(
              indata[pxPos + i] * maxOutSample / maxInSample + 0.5
            );
          }
          pxPos += 4;
        }
      }
    }
    module2.exports = function(indata, imageData, skipRescale = false) {
      let depth = imageData.depth;
      let width = imageData.width;
      let height = imageData.height;
      let colorType = imageData.colorType;
      let transColor = imageData.transColor;
      let palette = imageData.palette;
      let outdata = indata;
      if (colorType === 3) {
        dePalette(indata, outdata, width, height, palette);
      } else {
        if (transColor) {
          replaceTransparentColor(indata, outdata, width, height, transColor);
        }
        if (depth !== 8 && !skipRescale) {
          if (depth === 16) {
            outdata = Buffer.alloc(width * height * 4);
          }
          scaleDepth(indata, outdata, width, height, depth);
        }
      }
      return outdata;
    };
  }
});

// node_modules/pngjs/lib/parser-async.js
var require_parser_async = __commonJS({
  "node_modules/pngjs/lib/parser-async.js"(exports2, module2) {
    "use strict";
    var util = require("util");
    var zlib = require("zlib");
    var ChunkStream = require_chunkstream();
    var FilterAsync = require_filter_parse_async();
    var Parser = require_parser();
    var bitmapper = require_bitmapper();
    var formatNormaliser = require_format_normaliser();
    var ParserAsync = module2.exports = function(options) {
      ChunkStream.call(this);
      this._parser = new Parser(options, {
        read: this.read.bind(this),
        error: this._handleError.bind(this),
        metadata: this._handleMetaData.bind(this),
        gamma: this.emit.bind(this, "gamma"),
        palette: this._handlePalette.bind(this),
        transColor: this._handleTransColor.bind(this),
        finished: this._finished.bind(this),
        inflateData: this._inflateData.bind(this),
        simpleTransparency: this._simpleTransparency.bind(this),
        headersFinished: this._headersFinished.bind(this)
      });
      this._options = options;
      this.writable = true;
      this._parser.start();
    };
    util.inherits(ParserAsync, ChunkStream);
    ParserAsync.prototype._handleError = function(err) {
      this.emit("error", err);
      this.writable = false;
      this.destroy();
      if (this._inflate && this._inflate.destroy) {
        this._inflate.destroy();
      }
      if (this._filter) {
        this._filter.destroy();
        this._filter.on("error", function() {
        });
      }
      this.errord = true;
    };
    ParserAsync.prototype._inflateData = function(data) {
      if (!this._inflate) {
        if (this._bitmapInfo.interlace) {
          this._inflate = zlib.createInflate();
          this._inflate.on("error", this.emit.bind(this, "error"));
          this._filter.on("complete", this._complete.bind(this));
          this._inflate.pipe(this._filter);
        } else {
          let rowSize = (this._bitmapInfo.width * this._bitmapInfo.bpp * this._bitmapInfo.depth + 7 >> 3) + 1;
          let imageSize = rowSize * this._bitmapInfo.height;
          let chunkSize = Math.max(imageSize, zlib.Z_MIN_CHUNK);
          this._inflate = zlib.createInflate({ chunkSize });
          let leftToInflate = imageSize;
          let emitError = this.emit.bind(this, "error");
          this._inflate.on("error", function(err) {
            if (!leftToInflate) {
              return;
            }
            emitError(err);
          });
          this._filter.on("complete", this._complete.bind(this));
          let filterWrite = this._filter.write.bind(this._filter);
          this._inflate.on("data", function(chunk) {
            if (!leftToInflate) {
              return;
            }
            if (chunk.length > leftToInflate) {
              chunk = chunk.slice(0, leftToInflate);
            }
            leftToInflate -= chunk.length;
            filterWrite(chunk);
          });
          this._inflate.on("end", this._filter.end.bind(this._filter));
        }
      }
      this._inflate.write(data);
    };
    ParserAsync.prototype._handleMetaData = function(metaData) {
      this._metaData = metaData;
      this._bitmapInfo = Object.create(metaData);
      this._filter = new FilterAsync(this._bitmapInfo);
    };
    ParserAsync.prototype._handleTransColor = function(transColor) {
      this._bitmapInfo.transColor = transColor;
    };
    ParserAsync.prototype._handlePalette = function(palette) {
      this._bitmapInfo.palette = palette;
    };
    ParserAsync.prototype._simpleTransparency = function() {
      this._metaData.alpha = true;
    };
    ParserAsync.prototype._headersFinished = function() {
      this.emit("metadata", this._metaData);
    };
    ParserAsync.prototype._finished = function() {
      if (this.errord) {
        return;
      }
      if (!this._inflate) {
        this.emit("error", "No Inflate block");
      } else {
        this._inflate.end();
      }
    };
    ParserAsync.prototype._complete = function(filteredData) {
      if (this.errord) {
        return;
      }
      let normalisedBitmapData;
      try {
        let bitmapData = bitmapper.dataToBitMap(filteredData, this._bitmapInfo);
        normalisedBitmapData = formatNormaliser(
          bitmapData,
          this._bitmapInfo,
          this._options.skipRescale
        );
        bitmapData = null;
      } catch (ex) {
        this._handleError(ex);
        return;
      }
      this.emit("parsed", normalisedBitmapData);
    };
  }
});

// node_modules/pngjs/lib/bitpacker.js
var require_bitpacker = __commonJS({
  "node_modules/pngjs/lib/bitpacker.js"(exports2, module2) {
    "use strict";
    var constants = require_constants();
    module2.exports = function(dataIn, width, height, options) {
      let outHasAlpha = [constants.COLORTYPE_COLOR_ALPHA, constants.COLORTYPE_ALPHA].indexOf(
        options.colorType
      ) !== -1;
      if (options.colorType === options.inputColorType) {
        let bigEndian = (function() {
          let buffer = new ArrayBuffer(2);
          new DataView(buffer).setInt16(
            0,
            256,
            true
            /* littleEndian */
          );
          return new Int16Array(buffer)[0] !== 256;
        })();
        if (options.bitDepth === 8 || options.bitDepth === 16 && bigEndian) {
          return dataIn;
        }
      }
      let data = options.bitDepth !== 16 ? dataIn : new Uint16Array(dataIn.buffer);
      let maxValue = 255;
      let inBpp = constants.COLORTYPE_TO_BPP_MAP[options.inputColorType];
      if (inBpp === 4 && !options.inputHasAlpha) {
        inBpp = 3;
      }
      let outBpp = constants.COLORTYPE_TO_BPP_MAP[options.colorType];
      if (options.bitDepth === 16) {
        maxValue = 65535;
        outBpp *= 2;
      }
      let outData = Buffer.alloc(width * height * outBpp);
      let inIndex = 0;
      let outIndex = 0;
      let bgColor = options.bgColor || {};
      if (bgColor.red === void 0) {
        bgColor.red = maxValue;
      }
      if (bgColor.green === void 0) {
        bgColor.green = maxValue;
      }
      if (bgColor.blue === void 0) {
        bgColor.blue = maxValue;
      }
      function getRGBA() {
        let red;
        let green;
        let blue;
        let alpha = maxValue;
        switch (options.inputColorType) {
          case constants.COLORTYPE_COLOR_ALPHA:
            alpha = data[inIndex + 3];
            red = data[inIndex];
            green = data[inIndex + 1];
            blue = data[inIndex + 2];
            break;
          case constants.COLORTYPE_COLOR:
            red = data[inIndex];
            green = data[inIndex + 1];
            blue = data[inIndex + 2];
            break;
          case constants.COLORTYPE_ALPHA:
            alpha = data[inIndex + 1];
            red = data[inIndex];
            green = red;
            blue = red;
            break;
          case constants.COLORTYPE_GRAYSCALE:
            red = data[inIndex];
            green = red;
            blue = red;
            break;
          default:
            throw new Error(
              "input color type:" + options.inputColorType + " is not supported at present"
            );
        }
        if (options.inputHasAlpha) {
          if (!outHasAlpha) {
            alpha /= maxValue;
            red = Math.min(
              Math.max(Math.round((1 - alpha) * bgColor.red + alpha * red), 0),
              maxValue
            );
            green = Math.min(
              Math.max(Math.round((1 - alpha) * bgColor.green + alpha * green), 0),
              maxValue
            );
            blue = Math.min(
              Math.max(Math.round((1 - alpha) * bgColor.blue + alpha * blue), 0),
              maxValue
            );
          }
        }
        return { red, green, blue, alpha };
      }
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let rgba = getRGBA(data, inIndex);
          switch (options.colorType) {
            case constants.COLORTYPE_COLOR_ALPHA:
            case constants.COLORTYPE_COLOR:
              if (options.bitDepth === 8) {
                outData[outIndex] = rgba.red;
                outData[outIndex + 1] = rgba.green;
                outData[outIndex + 2] = rgba.blue;
                if (outHasAlpha) {
                  outData[outIndex + 3] = rgba.alpha;
                }
              } else {
                outData.writeUInt16BE(rgba.red, outIndex);
                outData.writeUInt16BE(rgba.green, outIndex + 2);
                outData.writeUInt16BE(rgba.blue, outIndex + 4);
                if (outHasAlpha) {
                  outData.writeUInt16BE(rgba.alpha, outIndex + 6);
                }
              }
              break;
            case constants.COLORTYPE_ALPHA:
            case constants.COLORTYPE_GRAYSCALE: {
              let grayscale = (rgba.red + rgba.green + rgba.blue) / 3;
              if (options.bitDepth === 8) {
                outData[outIndex] = grayscale;
                if (outHasAlpha) {
                  outData[outIndex + 1] = rgba.alpha;
                }
              } else {
                outData.writeUInt16BE(grayscale, outIndex);
                if (outHasAlpha) {
                  outData.writeUInt16BE(rgba.alpha, outIndex + 2);
                }
              }
              break;
            }
            default:
              throw new Error("unrecognised color Type " + options.colorType);
          }
          inIndex += inBpp;
          outIndex += outBpp;
        }
      }
      return outData;
    };
  }
});

// node_modules/pngjs/lib/filter-pack.js
var require_filter_pack = __commonJS({
  "node_modules/pngjs/lib/filter-pack.js"(exports2, module2) {
    "use strict";
    var paethPredictor = require_paeth_predictor();
    function filterNone(pxData, pxPos, byteWidth, rawData, rawPos) {
      for (let x = 0; x < byteWidth; x++) {
        rawData[rawPos + x] = pxData[pxPos + x];
      }
    }
    function filterSumNone(pxData, pxPos, byteWidth) {
      let sum = 0;
      let length = pxPos + byteWidth;
      for (let i = pxPos; i < length; i++) {
        sum += Math.abs(pxData[i]);
      }
      return sum;
    }
    function filterSub(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
      for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let val = pxData[pxPos + x] - left;
        rawData[rawPos + x] = val;
      }
    }
    function filterSumSub(pxData, pxPos, byteWidth, bpp) {
      let sum = 0;
      for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let val = pxData[pxPos + x] - left;
        sum += Math.abs(val);
      }
      return sum;
    }
    function filterUp(pxData, pxPos, byteWidth, rawData, rawPos) {
      for (let x = 0; x < byteWidth; x++) {
        let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
        let val = pxData[pxPos + x] - up;
        rawData[rawPos + x] = val;
      }
    }
    function filterSumUp(pxData, pxPos, byteWidth) {
      let sum = 0;
      let length = pxPos + byteWidth;
      for (let x = pxPos; x < length; x++) {
        let up = pxPos > 0 ? pxData[x - byteWidth] : 0;
        let val = pxData[x] - up;
        sum += Math.abs(val);
      }
      return sum;
    }
    function filterAvg(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
      for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
        let val = pxData[pxPos + x] - (left + up >> 1);
        rawData[rawPos + x] = val;
      }
    }
    function filterSumAvg(pxData, pxPos, byteWidth, bpp) {
      let sum = 0;
      for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
        let val = pxData[pxPos + x] - (left + up >> 1);
        sum += Math.abs(val);
      }
      return sum;
    }
    function filterPaeth(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
      for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
        let upleft = pxPos > 0 && x >= bpp ? pxData[pxPos + x - (byteWidth + bpp)] : 0;
        let val = pxData[pxPos + x] - paethPredictor(left, up, upleft);
        rawData[rawPos + x] = val;
      }
    }
    function filterSumPaeth(pxData, pxPos, byteWidth, bpp) {
      let sum = 0;
      for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
        let upleft = pxPos > 0 && x >= bpp ? pxData[pxPos + x - (byteWidth + bpp)] : 0;
        let val = pxData[pxPos + x] - paethPredictor(left, up, upleft);
        sum += Math.abs(val);
      }
      return sum;
    }
    var filters = {
      0: filterNone,
      1: filterSub,
      2: filterUp,
      3: filterAvg,
      4: filterPaeth
    };
    var filterSums = {
      0: filterSumNone,
      1: filterSumSub,
      2: filterSumUp,
      3: filterSumAvg,
      4: filterSumPaeth
    };
    module2.exports = function(pxData, width, height, options, bpp) {
      let filterTypes;
      if (!("filterType" in options) || options.filterType === -1) {
        filterTypes = [0, 1, 2, 3, 4];
      } else if (typeof options.filterType === "number") {
        filterTypes = [options.filterType];
      } else {
        throw new Error("unrecognised filter types");
      }
      if (options.bitDepth === 16) {
        bpp *= 2;
      }
      let byteWidth = width * bpp;
      let rawPos = 0;
      let pxPos = 0;
      let rawData = Buffer.alloc((byteWidth + 1) * height);
      let sel = filterTypes[0];
      for (let y = 0; y < height; y++) {
        if (filterTypes.length > 1) {
          let min = Infinity;
          for (let i = 0; i < filterTypes.length; i++) {
            let sum = filterSums[filterTypes[i]](pxData, pxPos, byteWidth, bpp);
            if (sum < min) {
              sel = filterTypes[i];
              min = sum;
            }
          }
        }
        rawData[rawPos] = sel;
        rawPos++;
        filters[sel](pxData, pxPos, byteWidth, rawData, rawPos, bpp);
        rawPos += byteWidth;
        pxPos += byteWidth;
      }
      return rawData;
    };
  }
});

// node_modules/pngjs/lib/packer.js
var require_packer = __commonJS({
  "node_modules/pngjs/lib/packer.js"(exports2, module2) {
    "use strict";
    var constants = require_constants();
    var CrcStream = require_crc();
    var bitPacker = require_bitpacker();
    var filter = require_filter_pack();
    var zlib = require("zlib");
    var Packer = module2.exports = function(options) {
      this._options = options;
      options.deflateChunkSize = options.deflateChunkSize || 32 * 1024;
      options.deflateLevel = options.deflateLevel != null ? options.deflateLevel : 9;
      options.deflateStrategy = options.deflateStrategy != null ? options.deflateStrategy : 3;
      options.inputHasAlpha = options.inputHasAlpha != null ? options.inputHasAlpha : true;
      options.deflateFactory = options.deflateFactory || zlib.createDeflate;
      options.bitDepth = options.bitDepth || 8;
      options.colorType = typeof options.colorType === "number" ? options.colorType : constants.COLORTYPE_COLOR_ALPHA;
      options.inputColorType = typeof options.inputColorType === "number" ? options.inputColorType : constants.COLORTYPE_COLOR_ALPHA;
      if ([
        constants.COLORTYPE_GRAYSCALE,
        constants.COLORTYPE_COLOR,
        constants.COLORTYPE_COLOR_ALPHA,
        constants.COLORTYPE_ALPHA
      ].indexOf(options.colorType) === -1) {
        throw new Error(
          "option color type:" + options.colorType + " is not supported at present"
        );
      }
      if ([
        constants.COLORTYPE_GRAYSCALE,
        constants.COLORTYPE_COLOR,
        constants.COLORTYPE_COLOR_ALPHA,
        constants.COLORTYPE_ALPHA
      ].indexOf(options.inputColorType) === -1) {
        throw new Error(
          "option input color type:" + options.inputColorType + " is not supported at present"
        );
      }
      if (options.bitDepth !== 8 && options.bitDepth !== 16) {
        throw new Error(
          "option bit depth:" + options.bitDepth + " is not supported at present"
        );
      }
    };
    Packer.prototype.getDeflateOptions = function() {
      return {
        chunkSize: this._options.deflateChunkSize,
        level: this._options.deflateLevel,
        strategy: this._options.deflateStrategy
      };
    };
    Packer.prototype.createDeflate = function() {
      return this._options.deflateFactory(this.getDeflateOptions());
    };
    Packer.prototype.filterData = function(data, width, height) {
      let packedData = bitPacker(data, width, height, this._options);
      let bpp = constants.COLORTYPE_TO_BPP_MAP[this._options.colorType];
      let filteredData = filter(packedData, width, height, this._options, bpp);
      return filteredData;
    };
    Packer.prototype._packChunk = function(type, data) {
      let len = data ? data.length : 0;
      let buf = Buffer.alloc(len + 12);
      buf.writeUInt32BE(len, 0);
      buf.writeUInt32BE(type, 4);
      if (data) {
        data.copy(buf, 8);
      }
      buf.writeInt32BE(
        CrcStream.crc32(buf.slice(4, buf.length - 4)),
        buf.length - 4
      );
      return buf;
    };
    Packer.prototype.packGAMA = function(gamma) {
      let buf = Buffer.alloc(4);
      buf.writeUInt32BE(Math.floor(gamma * constants.GAMMA_DIVISION), 0);
      return this._packChunk(constants.TYPE_gAMA, buf);
    };
    Packer.prototype.packIHDR = function(width, height) {
      let buf = Buffer.alloc(13);
      buf.writeUInt32BE(width, 0);
      buf.writeUInt32BE(height, 4);
      buf[8] = this._options.bitDepth;
      buf[9] = this._options.colorType;
      buf[10] = 0;
      buf[11] = 0;
      buf[12] = 0;
      return this._packChunk(constants.TYPE_IHDR, buf);
    };
    Packer.prototype.packIDAT = function(data) {
      return this._packChunk(constants.TYPE_IDAT, data);
    };
    Packer.prototype.packIEND = function() {
      return this._packChunk(constants.TYPE_IEND, null);
    };
  }
});

// node_modules/pngjs/lib/packer-async.js
var require_packer_async = __commonJS({
  "node_modules/pngjs/lib/packer-async.js"(exports2, module2) {
    "use strict";
    var util = require("util");
    var Stream = require("stream");
    var constants = require_constants();
    var Packer = require_packer();
    var PackerAsync = module2.exports = function(opt) {
      Stream.call(this);
      let options = opt || {};
      this._packer = new Packer(options);
      this._deflate = this._packer.createDeflate();
      this.readable = true;
    };
    util.inherits(PackerAsync, Stream);
    PackerAsync.prototype.pack = function(data, width, height, gamma) {
      this.emit("data", Buffer.from(constants.PNG_SIGNATURE));
      this.emit("data", this._packer.packIHDR(width, height));
      if (gamma) {
        this.emit("data", this._packer.packGAMA(gamma));
      }
      let filteredData = this._packer.filterData(data, width, height);
      this._deflate.on("error", this.emit.bind(this, "error"));
      this._deflate.on(
        "data",
        function(compressedData) {
          this.emit("data", this._packer.packIDAT(compressedData));
        }.bind(this)
      );
      this._deflate.on(
        "end",
        function() {
          this.emit("data", this._packer.packIEND());
          this.emit("end");
        }.bind(this)
      );
      this._deflate.end(filteredData);
    };
  }
});

// node_modules/pngjs/lib/sync-inflate.js
var require_sync_inflate = __commonJS({
  "node_modules/pngjs/lib/sync-inflate.js"(exports2, module2) {
    "use strict";
    var assert = require("assert").ok;
    var zlib = require("zlib");
    var util = require("util");
    var kMaxLength = require("buffer").kMaxLength;
    function Inflate(opts) {
      if (!(this instanceof Inflate)) {
        return new Inflate(opts);
      }
      if (opts && opts.chunkSize < zlib.Z_MIN_CHUNK) {
        opts.chunkSize = zlib.Z_MIN_CHUNK;
      }
      zlib.Inflate.call(this, opts);
      this._offset = this._offset === void 0 ? this._outOffset : this._offset;
      this._buffer = this._buffer || this._outBuffer;
      if (opts && opts.maxLength != null) {
        this._maxLength = opts.maxLength;
      }
    }
    function createInflate(opts) {
      return new Inflate(opts);
    }
    function _close(engine, callback) {
      if (callback) {
        process.nextTick(callback);
      }
      if (!engine._handle) {
        return;
      }
      engine._handle.close();
      engine._handle = null;
    }
    Inflate.prototype._processChunk = function(chunk, flushFlag, asyncCb) {
      if (typeof asyncCb === "function") {
        return zlib.Inflate._processChunk.call(this, chunk, flushFlag, asyncCb);
      }
      let self = this;
      let availInBefore = chunk && chunk.length;
      let availOutBefore = this._chunkSize - this._offset;
      let leftToInflate = this._maxLength;
      let inOff = 0;
      let buffers = [];
      let nread = 0;
      let error;
      this.on("error", function(err) {
        error = err;
      });
      function handleChunk(availInAfter, availOutAfter) {
        if (self._hadError) {
          return;
        }
        let have = availOutBefore - availOutAfter;
        assert(have >= 0, "have should not go down");
        if (have > 0) {
          let out = self._buffer.slice(self._offset, self._offset + have);
          self._offset += have;
          if (out.length > leftToInflate) {
            out = out.slice(0, leftToInflate);
          }
          buffers.push(out);
          nread += out.length;
          leftToInflate -= out.length;
          if (leftToInflate === 0) {
            return false;
          }
        }
        if (availOutAfter === 0 || self._offset >= self._chunkSize) {
          availOutBefore = self._chunkSize;
          self._offset = 0;
          self._buffer = Buffer.allocUnsafe(self._chunkSize);
        }
        if (availOutAfter === 0) {
          inOff += availInBefore - availInAfter;
          availInBefore = availInAfter;
          return true;
        }
        return false;
      }
      assert(this._handle, "zlib binding closed");
      let res;
      do {
        res = this._handle.writeSync(
          flushFlag,
          chunk,
          // in
          inOff,
          // in_off
          availInBefore,
          // in_len
          this._buffer,
          // out
          this._offset,
          //out_off
          availOutBefore
        );
        res = res || this._writeState;
      } while (!this._hadError && handleChunk(res[0], res[1]));
      if (this._hadError) {
        throw error;
      }
      if (nread >= kMaxLength) {
        _close(this);
        throw new RangeError(
          "Cannot create final Buffer. It would be larger than 0x" + kMaxLength.toString(16) + " bytes"
        );
      }
      let buf = Buffer.concat(buffers, nread);
      _close(this);
      return buf;
    };
    util.inherits(Inflate, zlib.Inflate);
    function zlibBufferSync(engine, buffer) {
      if (typeof buffer === "string") {
        buffer = Buffer.from(buffer);
      }
      if (!(buffer instanceof Buffer)) {
        throw new TypeError("Not a string or buffer");
      }
      let flushFlag = engine._finishFlushFlag;
      if (flushFlag == null) {
        flushFlag = zlib.Z_FINISH;
      }
      return engine._processChunk(buffer, flushFlag);
    }
    function inflateSync(buffer, opts) {
      return zlibBufferSync(new Inflate(opts), buffer);
    }
    module2.exports = exports2 = inflateSync;
    exports2.Inflate = Inflate;
    exports2.createInflate = createInflate;
    exports2.inflateSync = inflateSync;
  }
});

// node_modules/pngjs/lib/sync-reader.js
var require_sync_reader = __commonJS({
  "node_modules/pngjs/lib/sync-reader.js"(exports2, module2) {
    "use strict";
    var SyncReader = module2.exports = function(buffer) {
      this._buffer = buffer;
      this._reads = [];
    };
    SyncReader.prototype.read = function(length, callback) {
      this._reads.push({
        length: Math.abs(length),
        // if length < 0 then at most this length
        allowLess: length < 0,
        func: callback
      });
    };
    SyncReader.prototype.process = function() {
      while (this._reads.length > 0 && this._buffer.length) {
        let read = this._reads[0];
        if (this._buffer.length && (this._buffer.length >= read.length || read.allowLess)) {
          this._reads.shift();
          let buf = this._buffer;
          this._buffer = buf.slice(read.length);
          read.func.call(this, buf.slice(0, read.length));
        } else {
          break;
        }
      }
      if (this._reads.length > 0) {
        throw new Error("There are some read requests waitng on finished stream");
      }
      if (this._buffer.length > 0) {
        throw new Error("unrecognised content at end of stream");
      }
    };
  }
});

// node_modules/pngjs/lib/filter-parse-sync.js
var require_filter_parse_sync = __commonJS({
  "node_modules/pngjs/lib/filter-parse-sync.js"(exports2) {
    "use strict";
    var SyncReader = require_sync_reader();
    var Filter = require_filter_parse();
    exports2.process = function(inBuffer, bitmapInfo) {
      let outBuffers = [];
      let reader = new SyncReader(inBuffer);
      let filter = new Filter(bitmapInfo, {
        read: reader.read.bind(reader),
        write: function(bufferPart) {
          outBuffers.push(bufferPart);
        },
        complete: function() {
        }
      });
      filter.start();
      reader.process();
      return Buffer.concat(outBuffers);
    };
  }
});

// node_modules/pngjs/lib/parser-sync.js
var require_parser_sync = __commonJS({
  "node_modules/pngjs/lib/parser-sync.js"(exports2, module2) {
    "use strict";
    var hasSyncZlib = true;
    var zlib = require("zlib");
    var inflateSync = require_sync_inflate();
    if (!zlib.deflateSync) {
      hasSyncZlib = false;
    }
    var SyncReader = require_sync_reader();
    var FilterSync = require_filter_parse_sync();
    var Parser = require_parser();
    var bitmapper = require_bitmapper();
    var formatNormaliser = require_format_normaliser();
    module2.exports = function(buffer, options) {
      if (!hasSyncZlib) {
        throw new Error(
          "To use the sync capability of this library in old node versions, please pin pngjs to v2.3.0"
        );
      }
      let err;
      function handleError(_err_) {
        err = _err_;
      }
      let metaData;
      function handleMetaData(_metaData_) {
        metaData = _metaData_;
      }
      function handleTransColor(transColor) {
        metaData.transColor = transColor;
      }
      function handlePalette(palette) {
        metaData.palette = palette;
      }
      function handleSimpleTransparency() {
        metaData.alpha = true;
      }
      let gamma;
      function handleGamma(_gamma_) {
        gamma = _gamma_;
      }
      let inflateDataList = [];
      function handleInflateData(inflatedData2) {
        inflateDataList.push(inflatedData2);
      }
      let reader = new SyncReader(buffer);
      let parser = new Parser(options, {
        read: reader.read.bind(reader),
        error: handleError,
        metadata: handleMetaData,
        gamma: handleGamma,
        palette: handlePalette,
        transColor: handleTransColor,
        inflateData: handleInflateData,
        simpleTransparency: handleSimpleTransparency
      });
      parser.start();
      reader.process();
      if (err) {
        throw err;
      }
      let inflateData = Buffer.concat(inflateDataList);
      inflateDataList.length = 0;
      let inflatedData;
      if (metaData.interlace) {
        inflatedData = zlib.inflateSync(inflateData);
      } else {
        let rowSize = (metaData.width * metaData.bpp * metaData.depth + 7 >> 3) + 1;
        let imageSize = rowSize * metaData.height;
        inflatedData = inflateSync(inflateData, {
          chunkSize: imageSize,
          maxLength: imageSize
        });
      }
      inflateData = null;
      if (!inflatedData || !inflatedData.length) {
        throw new Error("bad png - invalid inflate data response");
      }
      let unfilteredData = FilterSync.process(inflatedData, metaData);
      inflateData = null;
      let bitmapData = bitmapper.dataToBitMap(unfilteredData, metaData);
      unfilteredData = null;
      let normalisedBitmapData = formatNormaliser(
        bitmapData,
        metaData,
        options.skipRescale
      );
      metaData.data = normalisedBitmapData;
      metaData.gamma = gamma || 0;
      return metaData;
    };
  }
});

// node_modules/pngjs/lib/packer-sync.js
var require_packer_sync = __commonJS({
  "node_modules/pngjs/lib/packer-sync.js"(exports2, module2) {
    "use strict";
    var hasSyncZlib = true;
    var zlib = require("zlib");
    if (!zlib.deflateSync) {
      hasSyncZlib = false;
    }
    var constants = require_constants();
    var Packer = require_packer();
    module2.exports = function(metaData, opt) {
      if (!hasSyncZlib) {
        throw new Error(
          "To use the sync capability of this library in old node versions, please pin pngjs to v2.3.0"
        );
      }
      let options = opt || {};
      let packer = new Packer(options);
      let chunks = [];
      chunks.push(Buffer.from(constants.PNG_SIGNATURE));
      chunks.push(packer.packIHDR(metaData.width, metaData.height));
      if (metaData.gamma) {
        chunks.push(packer.packGAMA(metaData.gamma));
      }
      let filteredData = packer.filterData(
        metaData.data,
        metaData.width,
        metaData.height
      );
      let compressedData = zlib.deflateSync(
        filteredData,
        packer.getDeflateOptions()
      );
      filteredData = null;
      if (!compressedData || !compressedData.length) {
        throw new Error("bad png - invalid compressed data response");
      }
      chunks.push(packer.packIDAT(compressedData));
      chunks.push(packer.packIEND());
      return Buffer.concat(chunks);
    };
  }
});

// node_modules/pngjs/lib/png-sync.js
var require_png_sync = __commonJS({
  "node_modules/pngjs/lib/png-sync.js"(exports2) {
    "use strict";
    var parse = require_parser_sync();
    var pack = require_packer_sync();
    exports2.read = function(buffer, options) {
      return parse(buffer, options || {});
    };
    exports2.write = function(png, options) {
      return pack(png, options);
    };
  }
});

// node_modules/pngjs/lib/png.js
var require_png = __commonJS({
  "node_modules/pngjs/lib/png.js"(exports2) {
    "use strict";
    var util = require("util");
    var Stream = require("stream");
    var Parser = require_parser_async();
    var Packer = require_packer_async();
    var PNGSync = require_png_sync();
    var PNG2 = exports2.PNG = function(options) {
      Stream.call(this);
      options = options || {};
      this.width = options.width | 0;
      this.height = options.height | 0;
      this.data = this.width > 0 && this.height > 0 ? Buffer.alloc(4 * this.width * this.height) : null;
      if (options.fill && this.data) {
        this.data.fill(0);
      }
      this.gamma = 0;
      this.readable = this.writable = true;
      this._parser = new Parser(options);
      this._parser.on("error", this.emit.bind(this, "error"));
      this._parser.on("close", this._handleClose.bind(this));
      this._parser.on("metadata", this._metadata.bind(this));
      this._parser.on("gamma", this._gamma.bind(this));
      this._parser.on(
        "parsed",
        function(data) {
          this.data = data;
          this.emit("parsed", data);
        }.bind(this)
      );
      this._packer = new Packer(options);
      this._packer.on("data", this.emit.bind(this, "data"));
      this._packer.on("end", this.emit.bind(this, "end"));
      this._parser.on("close", this._handleClose.bind(this));
      this._packer.on("error", this.emit.bind(this, "error"));
    };
    util.inherits(PNG2, Stream);
    PNG2.sync = PNGSync;
    PNG2.prototype.pack = function() {
      if (!this.data || !this.data.length) {
        this.emit("error", "No data provided");
        return this;
      }
      process.nextTick(
        function() {
          this._packer.pack(this.data, this.width, this.height, this.gamma);
        }.bind(this)
      );
      return this;
    };
    PNG2.prototype.parse = function(data, callback) {
      if (callback) {
        let onParsed, onError;
        onParsed = function(parsedData) {
          this.removeListener("error", onError);
          this.data = parsedData;
          callback(null, this);
        }.bind(this);
        onError = function(err) {
          this.removeListener("parsed", onParsed);
          callback(err, null);
        }.bind(this);
        this.once("parsed", onParsed);
        this.once("error", onError);
      }
      this.end(data);
      return this;
    };
    PNG2.prototype.write = function(data) {
      this._parser.write(data);
      return true;
    };
    PNG2.prototype.end = function(data) {
      this._parser.end(data);
    };
    PNG2.prototype._metadata = function(metadata) {
      this.width = metadata.width;
      this.height = metadata.height;
      this.emit("metadata", metadata);
    };
    PNG2.prototype._gamma = function(gamma) {
      this.gamma = gamma;
    };
    PNG2.prototype._handleClose = function() {
      if (!this._parser.writable && !this._packer.readable) {
        this.emit("close");
      }
    };
    PNG2.bitblt = function(src, dst, srcX, srcY, width, height, deltaX, deltaY) {
      srcX |= 0;
      srcY |= 0;
      width |= 0;
      height |= 0;
      deltaX |= 0;
      deltaY |= 0;
      if (srcX > src.width || srcY > src.height || srcX + width > src.width || srcY + height > src.height) {
        throw new Error("bitblt reading outside image");
      }
      if (deltaX > dst.width || deltaY > dst.height || deltaX + width > dst.width || deltaY + height > dst.height) {
        throw new Error("bitblt writing outside image");
      }
      for (let y = 0; y < height; y++) {
        src.data.copy(
          dst.data,
          (deltaY + y) * dst.width + deltaX << 2,
          (srcY + y) * src.width + srcX << 2,
          (srcY + y) * src.width + srcX + width << 2
        );
      }
    };
    PNG2.prototype.bitblt = function(dst, srcX, srcY, width, height, deltaX, deltaY) {
      PNG2.bitblt(this, dst, srcX, srcY, width, height, deltaX, deltaY);
      return this;
    };
    PNG2.adjustGamma = function(src) {
      if (src.gamma) {
        for (let y = 0; y < src.height; y++) {
          for (let x = 0; x < src.width; x++) {
            let idx = src.width * y + x << 2;
            for (let i = 0; i < 3; i++) {
              let sample = src.data[idx + i] / 255;
              sample = Math.pow(sample, 1 / 2.2 / src.gamma);
              src.data[idx + i] = Math.round(sample * 255);
            }
          }
        }
        src.gamma = 0;
      }
    };
    PNG2.prototype.adjustGamma = function() {
      PNG2.adjustGamma(this);
    };
  }
});

// src/cli.ts
var import_node_fs3 = require("node:fs");
var import_node_path2 = require("node:path");
var import_node_util = require("node:util");

// src/agent.ts
var import_node_http = require("node:http");

// src/discover.ts
var import_node_dgram = require("node:dgram");
var import_node_net = require("node:net");
var import_node_os = require("node:os");

// src/vendors.ts
var BY_VENDOR = {
  1208: "escpos",
  // Epson
  1046: "escpos",
  // Winbond — used by Xprinter and many generic printers
  1155: "escpos",
  // STMicro — generic
  3540: "escpos",
  // Custom
  4070: "escpos",
  // ICS — generic
  5380: "escpos",
  // Bixolon
  5455: "escpos",
  // SNBC
  8137: "escpos",
  // NXP — generic
  8401: "escpos",
  // Rongta
  10473: "escpos",
  // GigaDevice — generic
  2655: "zpl",
  // Zebra
  4611: "tspl"
  // TSC
};
var THERMAL_NAME = /\bTM-|\bZ[DTQ]\d|\bG[KX]\d|zebra|\bTSC\b|\bT[EAT]\d{3}|\bXP-|\bPOS|thermal|receipt|label/i;
function guessDriver({ vendorId, commandSet = "", name = "" }) {
  const cmd = commandSet.toUpperCase();
  if (cmd.includes("ZPL")) return "zpl";
  if (cmd.includes("TSPL")) return "tspl";
  if (/ESC\/?POS/.test(cmd)) return "escpos";
  if (vendorId !== void 0 && BY_VENDOR[vendorId]) return BY_VENDOR[vendorId];
  if (/zebra|\bZ[DTQ]\d|\bG[KX]\d/i.test(name)) return "zpl";
  if (/\bTSC\b|\bT[EAT]\d{3}/i.test(name)) return "tspl";
  return "escpos";
}
function isKnownThermal({ vendorId, commandSet = "", name = "" }) {
  return vendorId !== void 0 && vendorId in BY_VENDOR || /ESC\/?POS|ZPL|TSPL/i.test(commandSet) || THERMAL_NAME.test(name);
}
function parseDeviceId(id) {
  const fields = /* @__PURE__ */ new Map();
  for (const part of id.split(";")) {
    const at = part.indexOf(":");
    if (at > 0) fields.set(part.slice(0, at).trim().toUpperCase(), part.slice(at + 1).trim());
  }
  return {
    manufacturer: fields.get("MFG") ?? fields.get("MANUFACTURER"),
    model: fields.get("MDL") ?? fields.get("MODEL"),
    commandSet: fields.get("CMD") ?? fields.get("COMMAND SET")
  };
}

// src/discover.ts
var RAW_PORT_MIN = 9100;
var RAW_PORT_MAX = 9109;
var ipToInt = (ip) => ip.split(".").reduce((n, octet) => n * 256 + Number(octet), 0);
var intToIp = (n) => [24, 16, 8, 0].map((shift) => Math.floor(n / 2 ** shift) % 256).join(".");
function scanNetworks(interfaces = (0, import_node_os.networkInterfaces)()) {
  const networks = [];
  for (const [iface, addrs] of Object.entries(interfaces)) {
    for (const a of addrs ?? []) {
      if (!["IPv4", "4"].includes(String(a.family)) || a.internal || a.address.startsWith("169.254.")) continue;
      const ip = ipToInt(a.address);
      const prefix = Math.max(24, a.netmask.split(".").reduce((bits, o) => bits + (Number(o).toString(2).match(/1/g)?.length ?? 0), 0));
      const size = 2 ** (32 - prefix);
      const first = ip - ip % size;
      networks.push({ iface, address: a.address, cidr: `${intToIp(first)}/${prefix}`, first, size, self: ip });
    }
  }
  return networks;
}
function scanTargets(interfaces) {
  const hosts = /* @__PURE__ */ new Set();
  for (const n of scanNetworks(interfaces)) {
    for (let h = n.first + 1; h < n.first + n.size - 1; h++) if (h !== n.self) hosts.add(intToIp(h));
  }
  return [...hosts];
}
function portOpen(host, port, timeoutMs) {
  return new Promise((resolve2) => {
    const socket = (0, import_node_net.connect)({ host, port });
    const done = (open) => {
      socket.destroy();
      resolve2(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}
var OID_DEVICE_DESCR = [1, 3, 6, 1, 2, 1, 25, 3, 2, 1, 3, 1];
var OID_SYS_DESCR = [1, 3, 6, 1, 2, 1, 1, 1, 0];
function tlv(tag, body) {
  return Buffer.concat([Buffer.from([tag, body.length]), body]);
}
function oidTlv(oid) {
  return tlv(6, Buffer.from([40 * oid[0] + oid[1], ...oid.slice(2)]));
}
function snmpGetRequest(oid, requestId) {
  const id = Buffer.alloc(4);
  id.writeInt32BE(requestId);
  const varbind = tlv(48, Buffer.concat([oidTlv(oid), Buffer.from([5, 0])]));
  const pdu = tlv(160, Buffer.concat([tlv(2, id), Buffer.from([2, 1, 0, 2, 1, 0]), tlv(48, varbind)]));
  return tlv(48, Buffer.concat([Buffer.from([2, 1, 0]), tlv(4, Buffer.from("public")), pdu]));
}
function parseSnmpString(response, oid) {
  const at = response.indexOf(oidTlv(oid));
  if (at < 0) return void 0;
  let i = at + oidTlv(oid).length;
  if (response[i] !== 4) return void 0;
  let len = response[i + 1];
  i += 2;
  if (len & 128) {
    const bytes = len & 127;
    len = 0;
    for (let k = 0; k < bytes; k++) len = len * 256 + response[i++];
  }
  return response.subarray(i, i + len).toString("utf8").replace(/\0/g, "").trim() || void 0;
}
function snmpGet(host, oid, timeoutMs) {
  return new Promise((resolve2) => {
    const socket = (0, import_node_dgram.createSocket)("udp4");
    const finish = (value) => {
      clearTimeout(timer);
      socket.close();
      resolve2(value);
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    socket.on("message", (msg) => finish(parseSnmpString(msg, oid)));
    socket.on("error", () => finish());
    socket.send(snmpGetRequest(oid, Math.floor(Math.random() * 2147483647)), 161, host);
  });
}
async function printerModel(host, timeoutMs = 1e3) {
  const [device, system] = await Promise.all([
    snmpGet(host, OID_DEVICE_DESCR, timeoutMs),
    snmpGet(host, OID_SYS_DESCR, timeoutMs)
  ]);
  return device ?? system;
}
async function discoverNetworkPrinters(opts = {}) {
  const targets = (opts.hosts ?? scanTargets()).flatMap((host) => (opts.ports ?? [9100]).map((port) => ({ host, port })));
  const open = [];
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const t = targets[next++];
      if (await portOpen(t.host, t.port, opts.timeoutMs ?? 400)) open.push(t);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 64, targets.length) }, worker));
  open.sort((a, b) => ipToInt(a.host) - ipToInt(b.host) || a.port - b.port);
  return Promise.all(
    open.map(async (t) => {
      const model = await printerModel(t.host);
      return { ...t, model, driver: guessDriver({ name: model }) };
    })
  );
}

// src/mono.ts
function rgbaToMono(rgba, width, height, threshold = 128) {
  const paddedWidth = Math.ceil(width / 8) * 8;
  const bytesPerRow = paddedWidth / 8;
  const data = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3] / 255;
      const lum = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * a + 255 * (1 - a);
      if (lum < threshold) data[y * bytesPerRow + (x >> 3)] |= 128 >> (x & 7);
    }
  }
  return { width: paddedWidth, height, data };
}
function assertRaster(r) {
  if (r.width <= 0 || r.width % 8 !== 0) throw new Error("raster width must be a positive multiple of 8");
  if (r.data.length !== r.width / 8 * r.height) {
    throw new Error(`raster length ${r.data.length} != ${r.width / 8} * ${r.height}`);
  }
}
function testPattern(width, height) {
  const w = Math.ceil(width / 8) * 8;
  const bytesPerRow = w / 8;
  const data = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const border = x < 4 || y < 4 || x >= width - 4 || y >= height - 4;
      const diagonal = Math.abs(Math.round(x * height / width) - y) < 2;
      const checker = y > height * 0.75 && ((x >> 4) + (y >> 4)) % 2 === 0;
      if (border || diagonal || checker) data[y * bytesPerRow + (x >> 3)] |= 128 >> (x & 7);
    }
  }
  return { width: w, height, data };
}

// src/drivers/epos.ts
var EposDriver = class {
  encode(r) {
    assertRaster(r);
    return Buffer.from(
      `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"><image width="${r.width}" height="${r.height}" color="color_1" mode="mono">${r.data.toString("base64")}</image><cut type="feed"/></epos-print>`,
      "utf8"
    );
  }
};

// src/drivers/escpos.ts
var BAND_ROWS = 1024;
var EscPosDriver = class {
  constructor(opts = {}) {
    this.opts = opts;
  }
  opts;
  encode(r) {
    assertRaster(r);
    const bytesPerRow = r.width / 8;
    const parts = [Buffer.from([27, 64])];
    for (let y = 0; y < r.height; y += BAND_ROWS) {
      const h = Math.min(BAND_ROWS, r.height - y);
      parts.push(
        Buffer.from([29, 118, 48, 0, bytesPerRow & 255, bytesPerRow >> 8 & 255, h & 255, h >> 8 & 255]),
        r.data.subarray(y * bytesPerRow, (y + h) * bytesPerRow)
      );
    }
    parts.push(Buffer.from([27, 100, this.opts.feedLines ?? 3]));
    const cut = this.opts.cut ?? "full";
    if (cut !== "none") parts.push(Buffer.from([29, 86, cut === "full" ? 0 : 1]));
    return Buffer.concat(parts);
  }
};

// src/drivers/tspl.ts
var TsplDriver = class {
  constructor(opts = {}) {
    this.opts = opts;
  }
  opts;
  encode(r) {
    assertRaster(r);
    const dpi = this.opts.dpi ?? 203;
    const mm = (dots) => (dots / dpi * 25.4).toFixed(1);
    const head = `SIZE ${mm(r.width)} mm,${mm(r.height)} mm\r
GAP ${this.opts.gapMm ?? 2} mm,0 mm\r
DIRECTION 1\r
CLS\r
BITMAP 0,0,${r.width / 8},${r.height},0,`;
    const inverted = Buffer.from(r.data.map((b) => b ^ 255));
    return Buffer.concat([Buffer.from(head, "ascii"), inverted, Buffer.from("\r\nPRINT 1,1\r\n", "ascii")]);
  }
};

// src/drivers/zpl.ts
var ZplDriver = class {
  encode(r) {
    assertRaster(r);
    const total = r.data.length;
    const hex = r.data.toString("hex").toUpperCase();
    return Buffer.from(
      `^XA^PW${r.width}^LL${r.height}^FO0,0^GFA,${total},${total},${r.width / 8},${hex}^FS^XZ`,
      "ascii"
    );
  }
};

// src/raster.ts
var import_pngjs = __toESM(require_png());
function pngToMono(png, threshold = 128) {
  const img = import_pngjs.PNG.sync.read(png);
  return rgbaToMono(img.data, img.width, img.height, threshold);
}

// src/transports/device.ts
var import_promises = require("node:fs/promises");
var DeviceTransport = class {
  constructor(opts) {
    this.opts = opts;
    if (!opts.path) throw new Error('device transport needs "path"');
  }
  opts;
  send(payload) {
    return (0, import_promises.writeFile)(this.opts.path, payload);
  }
};

// src/transports/epos-http.ts
var EposHttpTransport = class {
  constructor(opts) {
    this.opts = opts;
    if (!opts.host) throw new Error('epos-http transport needs "host"');
  }
  opts;
  async send(payload) {
    const { host, port, ssl = false, devid = "local_printer", timeoutMs = 15e3 } = this.opts;
    const origin = `${ssl ? "https" : "http"}://${host}${port ? `:${port}` : ""}`;
    const url = `${origin}/cgi-bin/epos/service.cgi?devid=${encodeURIComponent(devid)}&timeout=${timeoutMs}`;
    const body = '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>' + payload.toString("utf8") + "</s:Body></s:Envelope>";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "If-Modified-Since": "Thu, 01 Jan 1970 00:00:00 GMT",
        SOAPAction: '""'
      },
      body,
      signal: AbortSignal.timeout(timeoutMs + 5e3)
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`ePOS HTTP ${res.status} from ${origin}`);
    if (!/success="true"/.test(text)) {
      const code = /code="([^"]*)"/.exec(text)?.[1] || "unknown";
      throw new Error(`ePOS print failed at ${origin} (${code})`);
    }
  }
};

// src/transports/spooler.ts
var import_node_child_process = require("node:child_process");
var import_promises2 = require("node:fs/promises");
var SpoolerTransport = class {
  constructor(opts) {
    this.opts = opts;
    if (!opts.queue) throw new Error('spooler transport needs "queue"');
  }
  opts;
  send(payload) {
    if (process.platform === "win32") {
      return (0, import_promises2.writeFile)(`\\\\${this.opts.host ?? "localhost"}\\${this.opts.queue}`, payload);
    }
    return new Promise((resolve2, reject) => {
      const lp = (0, import_node_child_process.spawn)("lp", ["-d", this.opts.queue, "-o", "raw"], { stdio: ["pipe", "ignore", "pipe"] });
      let stderr = "";
      lp.stderr.on("data", (d) => stderr += d);
      lp.on("error", reject);
      lp.on(
        "close",
        (code) => code === 0 ? resolve2() : reject(new Error(`lp exited with ${code}: ${stderr.trim()}`))
      );
      lp.stdin.end(payload);
    });
  }
};

// src/transports/tcp.ts
var import_node_net2 = require("node:net");
var TcpTransport = class {
  constructor(opts) {
    this.opts = opts;
    if (!opts.host) throw new Error('tcp transport needs "host"');
  }
  opts;
  send(payload) {
    const { host, port = 9100, timeoutMs = 1e4 } = this.opts;
    return new Promise((resolve2, reject) => {
      let flushed = false;
      const socket = (0, import_node_net2.createConnection)({ host, port }, () => socket.end(payload));
      socket.on("finish", () => flushed = true);
      socket.setTimeout(timeoutMs, () => {
        if (flushed) {
          socket.destroy();
          resolve2();
        } else {
          socket.destroy(new Error(`Printer at ${host}:${port} did not respond (timed out)`));
        }
      });
      socket.on("error", reject);
      socket.on("close", (hadError) => {
        if (!hadError) resolve2();
      });
    });
  }
};

// src/detect.ts
var import_node_child_process2 = require("node:child_process");
var import_node_fs = require("node:fs");
function detectPrinters() {
  const found = [];
  if (process.platform === "linux") found.push(...linuxUsbLp());
  if (process.platform === "darwin") addMacUsbPrinters();
  if (process.platform !== "win32") found.push(...cupsUsbQueues());
  return found;
}
var GENERIC_PPD = "/System/Library/Frameworks/ApplicationServices.framework/Versions/A/Frameworks/PrintCore.framework/Versions/A/Resources/Generic.ppd";
var MAC_SCAN_INTERVAL_MS = 5e3;
var lastMacScan = 0;
function parseLpinfoUsb(output) {
  return output.split("\n").map((line) => /^direct\s+(usb:\/\/\S+)/.exec(line.trim())?.[1]).filter((uri) => !!uri);
}
function addMacUsbPrinters() {
  if (Date.now() - lastMacScan < MAC_SCAN_INTERVAL_MS) return;
  lastMacScan = Date.now();
  const run = (cmd, args) => (0, import_node_child_process2.execFileSync)(cmd, args, {
    encoding: "utf8",
    timeout: 5e3,
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, LANG: "C" }
  });
  let devices;
  try {
    devices = parseLpinfoUsb(run("lpinfo", ["--include-schemes", "usb", "-v"]));
  } catch {
    return;
  }
  let queues = "";
  try {
    queues = run("lpstat", ["-v"]);
  } catch {
  }
  for (const uri of devices) {
    const model = decodeURIComponent(uri.replace(/^usb:\/\/|\?.*$/g, ""));
    if (queues.includes(uri) || !isKnownThermal({ name: model })) continue;
    try {
      run("lpadmin", ["-p", model.replace(/[^A-Za-z0-9]+/g, "_"), "-E", "-v", uri, "-P", GENERIC_PPD, "-o", "printer-is-shared=false"]);
    } catch {
    }
  }
}
function readOr(path) {
  try {
    return (0, import_node_fs.readFileSync)(path, "utf8").trim();
  } catch {
    return void 0;
  }
}
function linuxUsbLp() {
  let nodes;
  try {
    nodes = (0, import_node_fs.readdirSync)("/dev/usb").filter((n) => /^lp\d+$/.test(n));
  } catch {
    return [];
  }
  return nodes.map((node) => {
    const sys = ["usbmisc", "usb"].map((cls) => `/sys/class/${cls}/${node}/device`).find((p) => readOr(`${p}/../idVendor`) !== void 0);
    const vid = sys ? readOr(`${sys}/../idVendor`) : void 0;
    const id = parseDeviceId((sys && readOr(`${sys}/ieee1284_id`)) ?? "");
    const vendorId = vid ? parseInt(vid, 16) : void 0;
    const label = [id.manufacturer, id.model].filter(Boolean).join(" ") || `USB printer ${vid ?? "?"}`;
    const driver = guessDriver({ vendorId, commandSet: id.commandSet, name: label });
    return {
      name: `usb-${node}`,
      description: `${label} (/dev/usb/${node}, ${driver})`,
      config: { driver: { type: driver }, transport: { type: "device", path: `/dev/usb/${node}` } }
    };
  });
}
function parseLpstatDevices(output) {
  const queues = [];
  for (const line of output.split("\n")) {
    const m = /^device for (.+?):\s*usb:\/\/([^?\s]+)/.exec(line.trim());
    if (m) queues.push({ queue: m[1], model: decodeURIComponent(m[2]).replace("/", " ") });
  }
  return queues;
}
function cupsUsbQueues() {
  let output;
  try {
    output = (0, import_node_child_process2.execFileSync)("lpstat", ["-v"], {
      encoding: "utf8",
      timeout: 3e3,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, LANG: "C" }
    });
  } catch {
    return [];
  }
  return parseLpstatDevices(output).filter(({ queue, model }) => isKnownThermal({ name: `${queue} ${model}` })).map(({ queue, model }) => {
    const driver = guessDriver({ name: `${queue} ${model}` });
    return {
      name: `cups-${queue}`,
      description: `${model} (CUPS queue ${queue}, ${driver})`,
      config: { driver: { type: driver }, transport: { type: "spooler", queue } }
    };
  });
}

// src/saved.ts
var import_node_fs2 = require("node:fs");
var import_node_path = require("node:path");
var SavedPrinters = class {
  constructor(file) {
    this.file = file;
  }
  file;
  list() {
    try {
      return JSON.parse((0, import_node_fs2.readFileSync)(this.file, "utf8")).printers ?? {};
    } catch {
      return {};
    }
  }
  set(name, printer) {
    this.write({ ...this.list(), [name]: printer });
  }
  remove(name) {
    const printers = this.list();
    if (!(name in printers)) return false;
    delete printers[name];
    this.write(printers);
    return true;
  }
  write(printers) {
    (0, import_node_fs2.mkdirSync)((0, import_node_path.dirname)(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    (0, import_node_fs2.writeFileSync)(tmp, JSON.stringify({ printers }, null, 2));
    (0, import_node_fs2.renameSync)(tmp, this.file);
  }
};

// src/index.ts
var drivers = /* @__PURE__ */ new Map([
  ["escpos", (o) => new EscPosDriver(o)],
  ["zpl", () => new ZplDriver()],
  ["tspl", (o) => new TsplDriver(o)],
  ["epos", () => new EposDriver()]
]);
var transports = /* @__PURE__ */ new Map([
  ["tcp", (o) => new TcpTransport(o)],
  ["device", (o) => new DeviceTransport(o)],
  ["spooler", (o) => new SpoolerTransport(o)],
  ["epos-http", (o) => new EposHttpTransport(o)]
]);
function registerDriver(type, factory) {
  drivers.set(type, factory);
}
function registerTransport(type, factory) {
  transports.set(type, factory);
}
function listDrivers() {
  return [...drivers.keys()];
}
function listTransports() {
  return [...transports.keys()];
}
var Printer = class {
  constructor(driver, transport, widthDots) {
    this.driver = driver;
    this.transport = transport;
    this.widthDots = widthDots;
  }
  driver;
  transport;
  widthDots;
  /**
   * Print labels in order, ONE job per label, each sent only after the
   * previous one was accepted. Batching many raster labels into one job
   * overflows small printer buffers (Epson TM ≈128KB ≈ 3 labels) and the
   * printer silently truncates mid-label.
   *
   * Every label is decoded and encoded before anything is sent, so a bad
   * image fails the whole call instead of half-printing a batch.
   */
  async print(labels, copies = 1) {
    const list = Array.isArray(labels) ? labels : [labels];
    const payloads = list.map((label, i) => {
      const raster = Buffer.isBuffer(label) ? pngToMono(label) : label;
      if (this.widthDots && raster.width > this.widthDots) {
        throw new Error(`label ${i + 1} is ${raster.width} dots wide; printer max is ${this.widthDots}`);
      }
      return this.driver.encode(raster);
    });
    for (const payload of payloads) {
      for (let c = 0; c < copies; c++) await this.transport.send(payload);
    }
  }
};
function createPrinter(config) {
  const { type: driverType, ...driverOpts } = config.driver;
  const { type: transportType, ...transportOpts } = config.transport;
  const driver = drivers.get(driverType);
  if (!driver) throw new Error(`Unknown driver "${driverType}". Known: ${listDrivers().join(", ")}`);
  const transport = transports.get(transportType);
  if (!transport) throw new Error(`Unknown transport "${transportType}". Known: ${listTransports().join(", ")}`);
  if (driverType === "epos" !== (transportType === "epos-http") && transportType !== "device") {
    throw new Error('The "epos" driver and the "epos-http" transport must be used together');
  }
  return new Printer(driver(driverOpts), transport(transportOpts), config.widthDots);
}

// src/agent.ts
var NETWORK_DRIVERS = ["escpos", "zpl", "tspl"];
function summary(name, p, saved) {
  const network = p.transport.type === "tcp" || p.transport.type === "epos-http";
  return {
    name,
    driver: p.driver.type,
    transport: p.transport.type,
    description: p.description,
    connection: p.connection ?? (network ? "network" : "usb"),
    host: network ? p.transport.host : void 0,
    saved
  };
}
async function readJson(req) {
  try {
    const value = JSON.parse((await readBody(req)).toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
var MAX_BODY = 10 * 1024 * 1024;
function readBody(req) {
  return new Promise((resolve2, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("label image too large (max 10 MB)"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve2(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
function startAgent(opts) {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 9123;
  const allow = opts.allowOrigins ?? ["*"];
  let queue = Promise.resolve();
  let scanning = null;
  const discover = opts.discover ?? (() => discoverNetworkPrinters());
  const server = (0, import_node_http.createServer)(async (req, res) => {
    const hostname = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname)) return json(res, 403, { ok: false, error: "bad host" });
    const origin = req.headers.origin;
    const originAllowed = !origin || allow.includes("*") || allow.includes(origin);
    if (origin && originAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST",
        "Access-Control-Allow-Headers": "Content-Type",
        // Chrome Private Network Access: lets an https site call this localhost service.
        "Access-Control-Allow-Private-Network": "true"
      });
      return res.end();
    }
    if (!originAllowed) return json(res, 403, { ok: false, error: `origin ${origin} not allowed` });
    const url = new URL(req.url ?? "/", "http://agent");
    try {
      const printers = opts.getPrinters();
      const saved = opts.store?.list() ?? {};
      if (req.method === "GET" && url.pathname === "/status") {
        return json(res, 200, {
          ok: true,
          printers: Object.entries(printers).map(([name, p]) => summary(name, p, name in saved))
        });
      }
      if (req.method === "GET" && url.pathname === "/discover") {
        scanning ??= discover().finally(() => scanning = null);
        const found = await scanning;
        const savedHosts = new Set(Object.values(saved).map((p) => `${p.transport.host}:${p.transport.port}`));
        return json(res, 200, {
          ok: true,
          printers: found.map((p) => ({ ...p, saved: savedHosts.has(`${p.host}:${p.port}`) })),
          // What was searched, so a printer on a different network (e.g. wired vs Wi‑Fi VLAN) is diagnosable.
          networks: scanNetworks().map(({ iface, address, cidr }) => ({ iface, address, cidr }))
        });
      }
      if (req.method === "POST" && url.pathname === "/printers/add") {
        if (!opts.store) return json(res, 501, { ok: false, error: "this agent cannot save printers" });
        const body = await readJson(req);
        const printerHost = typeof body?.host === "string" ? body.host.trim() : "";
        const printerPort = body?.port === void 0 ? RAW_PORT_MIN : Number(body.port);
        if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(printerHost)) {
          return json(res, 400, { ok: false, error: "Enter a valid printer IP address or hostname" });
        }
        if (!Number.isInteger(printerPort) || printerPort < RAW_PORT_MIN || printerPort > RAW_PORT_MAX) {
          return json(res, 400, { ok: false, error: `Port must be ${RAW_PORT_MIN}\u2013${RAW_PORT_MAX}` });
        }
        if (!await portOpen(printerHost, printerPort, 2e3)) {
          return json(res, 400, { ok: false, error: `No printer answered at ${printerHost}:${printerPort}` });
        }
        const model = typeof body?.model === "string" ? body.model.slice(0, 80) : void 0;
        const driver = NETWORK_DRIVERS.includes(body?.driver) ? body?.driver : guessDriver({ name: model });
        const name = `net-${printerHost}${printerPort === RAW_PORT_MIN ? "" : `-${printerPort}`}`;
        const printer = {
          driver: { type: driver },
          transport: { type: "tcp", host: printerHost, port: printerPort },
          description: `${model || "Network printer"} (${printerHost})`,
          connection: body?.connection === "wifi" ? "wifi" : "ethernet"
        };
        opts.store.set(name, printer);
        return json(res, 200, { ok: true, printer: summary(name, printer, true) });
      }
      if (req.method === "POST" && url.pathname === "/printers/remove") {
        const body = await readJson(req);
        const name = typeof body?.name === "string" ? body.name : "";
        if (!opts.store?.remove(name)) return json(res, 404, { ok: false, error: `no saved printer "${name}"` });
        return json(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(SETUP_PAGE);
      }
      if (req.method === "POST" && (url.pathname === "/print" || url.pathname === "/test")) {
        const name = url.searchParams.get("printer") || Object.keys(printers)[0];
        const cfg = name ? printers[name] : void 0;
        if (!cfg) return json(res, 404, { ok: false, error: name ? `no printer "${name}"` : "no printer connected" });
        const label = url.pathname === "/test" ? testPattern(cfg.widthDots ?? 384, 240) : await readBody(req);
        const copies = Math.max(1, Math.min(100, Number(url.searchParams.get("copies")) || 1));
        const job = queue.then(() => createPrinter(cfg).print(label, copies));
        queue = job.catch(() => void 0);
        await job;
        return json(res, 200, { ok: true, printer: name });
      }
      return json(res, 404, { ok: false, error: "not found" });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  });
  server.listen(port, host);
  return server;
}
var SETUP_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Printer agent</title><style>
body{font:16px system-ui,sans-serif;margin:24px;max-width:640px}button{font-size:16px;padding:8px 14px;margin:4px 0}
li{margin:8px 0}code{background:#eee;padding:1px 4px}#msg{margin-top:12px;font-weight:600}</style></head><body>
<h1>Printer agent is running</h1><p>Connected printers (plug one in and reload):</p><ul id="list"><li>Loading\u2026</li></ul><div id="msg"></div>
<script>
const msg = document.getElementById('msg');
fetch('/status').then(r => r.json()).then(s => {
  const list = document.getElementById('list');
  list.innerHTML = s.printers.length ? '' : '<li>No printer found. Check the USB cable, or add one to printers.json.</li>';
  for (const p of s.printers) {
    const li = document.createElement('li');
    li.innerHTML = '<code></code> <span></span><br><button>Print test page</button>';
    li.querySelector('code').textContent = p.name;
    li.querySelector('span').textContent = p.description || p.driver + ' via ' + p.transport;
    li.querySelector('button').onclick = async () => {
      msg.textContent = 'Printing\u2026';
      const r = await fetch('/test?printer=' + encodeURIComponent(p.name), { method: 'POST' }).then(r => r.json());
      msg.textContent = r.ok ? 'Sent to ' + p.name : 'Failed: ' + r.error;
    };
    list.appendChild(li);
  }
});
</script></body></html>`;

// src/cli.ts
var USAGE = `Usage:
  printer-code print <label.png> [more.png ...] [--printer <name>] [--copies N]
  printer-code test  [--printer <name>] [--height DOTS]
  printer-code list                 configured + auto-detected printers
  printer-code detect               only auto-detected (USB / CUPS) printers
  printer-code discover             scan this computer's networks (Ethernet / Wi-Fi) for printers
  printer-code agent [--port 9123]  run the local print service for kiosk browsers

Options:
  --config <file>   printers config (default: $PRINTER_CONFIG or ./printers.json; optional \u2014
                    without it, locally connected printers are auto-detected)
  --printer <name>  which printer (default: the first configured, else the first detected)
  --state <file>    network printers connected from the app (default: saved-printers.json
                    next to the config, or in the current directory)`;
function loadConfig(path) {
  const file = (0, import_node_path2.resolve)(path ?? "printers.json");
  if (!path && !(0, import_node_fs3.existsSync)(file)) return {};
  const cfg = JSON.parse((0, import_node_fs3.readFileSync)(file, "utf8"));
  for (const plugin of cfg.plugins ?? []) {
    const mod = require((0, import_node_path2.resolve)((0, import_node_path2.dirname)(file), plugin));
    (mod.default ?? mod)({ registerDriver, registerTransport });
  }
  return cfg;
}
function allPrinters(cfg, store) {
  const printers = { ...cfg.printers };
  for (const [name, p] of Object.entries(store.list())) printers[name] ??= p;
  for (const d of detectPrinters()) {
    printers[d.name] ??= { ...d.config, description: d.description, connection: "usb" };
  }
  return printers;
}
async function main() {
  const { values, positionals } = (0, import_node_util.parseArgs)({
    allowPositionals: true,
    options: {
      config: { type: "string", default: process.env.PRINTER_CONFIG },
      printer: { type: "string" },
      copies: { type: "string", default: "1" },
      height: { type: "string", default: "240" },
      port: { type: "string" },
      state: { type: "string" },
      help: { type: "boolean", short: "h" }
    }
  });
  const [command, ...files] = positionals;
  if (!command || values.help) {
    console.log(USAGE);
    return;
  }
  const cfg = loadConfig(values.config);
  const store = new SavedPrinters(
    (0, import_node_path2.resolve)(values.state ?? (0, import_node_path2.resolve)(values.config ? (0, import_node_path2.dirname)((0, import_node_path2.resolve)(values.config)) : ".", "saved-printers.json"))
  );
  if (command === "detect" || command === "list") {
    const printers2 = command === "detect" ? Object.fromEntries(detectPrinters().map((d) => [d.name, { ...d.config, description: d.description }])) : allPrinters(cfg, store);
    const names2 = Object.keys(printers2);
    if (names2.length === 0) console.log("No printers found.");
    for (const name2 of names2) {
      const p = printers2[name2];
      console.log(`${name2}	${p.driver.type} via ${p.transport.type}${p.description ? `	${p.description}` : ""}`);
    }
    console.log(`
drivers: ${listDrivers().join(", ")}
transports: ${listTransports().join(", ")}`);
    return;
  }
  if (command === "discover") {
    const nets = scanNetworks();
    console.log(`Scanning ${nets.map((n) => `${n.cidr} (${n.iface}, this machine ${n.address})`).join(", ") || "no networks"} for printers on port 9100...`);
    const found = await discoverNetworkPrinters();
    if (found.length === 0) console.log("No network printers found.");
    for (const p of found) console.log(`${p.host}:${p.port}	${p.driver}	${p.model ?? "(model unknown)"}`);
    return;
  }
  if (command === "agent") {
    const port = Number(values.port ?? cfg.agent?.port ?? 9123);
    startAgent({ port, allowOrigins: cfg.agent?.allowOrigins, store, getPrinters: () => allPrinters(cfg, store) }).on(
      "listening",
      () => console.log(`Printer agent on http://127.0.0.1:${port} \u2014 printers: ${Object.keys(allPrinters(cfg, store)).join(", ") || "none yet"}`)
    );
    return;
  }
  const printers = allPrinters(cfg, store);
  const names = Object.keys(printers);
  const name = values.printer ?? names[0];
  const printerCfg = name ? printers[name] : void 0;
  if (!printerCfg) throw new Error(`No printer "${name ?? ""}". Have: ${names.join(", ") || "none (connect one or add printers.json)"}`);
  const printer = createPrinter(printerCfg);
  if (command === "print") {
    if (files.length === 0) throw new Error("print needs at least one PNG file");
    await printer.print(files.map((f) => (0, import_node_fs3.readFileSync)(f)), Number(values.copies));
    console.log(`Printed ${files.length} label(s) on ${name}`);
  } else if (command === "test") {
    await printer.print(testPattern(printerCfg.widthDots ?? 384, Number(values.height)));
    console.log(`Test pattern sent to ${name}`);
  } else {
    throw new Error(`Unknown command "${command}"

${USAGE}`);
  }
}
main().catch((err) => {
  console.error(`printer-code: ${err.message}`);
  process.exit(1);
});
