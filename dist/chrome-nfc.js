/*
 * Copyright 2014 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 *     http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var base64 = (function () {

  this.inmap =
  [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 63, 0, 0,
   53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 0, 0, 0, 0, 0, 0,
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
   16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 0, 0, 0, 0, 64,
    0, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41,
   42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 0, 0, 0, 0, 0
  ];

  /**
   * Base64 encoder.
   * @param  {ArrayBuffer}  bytes
   * @param  {Number}       optLength
   * @param  {Boolean}      safe Wheter the result should be websafe.
   * @return {String}
   */
  this.encode = function (bytes, optLength, safe) {

    optLength = typeof optLength === 'undefined' ? bytes.length: optLength;
    safe = typeof safe === 'undefined' ? true: safe;

    var b64out = safe ?
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_":
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    var result = "";
    var shift = 0;
    var accu = 0;
    var input_index = 0;

    while (optLength--) {
      accu <<= 8;
      accu |= bytes[input_index++];
      shift += 8;
      while (shift >= 6) {
        var i = (accu >> (shift - 6)) & 63;
        result += b64out.charAt(i);
        shift -= 6;
      }
    }

    if (shift) {
      accu <<= 8;
      shift += 8;
      var i = (accu >> (shift - 6)) & 63;
      result += b64out.charAt(i);
    }

    if (!safe) while (result.length % 4) result += '=';

    return result;
  };

  /**
   * Base64 decoder.
   * @param {String} string
   */
  this.decode = function(string) {
    var bytes = [];
    var accu = 0;
    var shift = 0;
    for (var i = 0; i < string.length; ++i) {
      var c = string.charCodeAt(i);
      if (c < 32 || c > 127 || !this.inmap[c - 32]) return [];
      accu <<= 6;
      accu |= (this.inmap[c - 32] - 1);
      shift += 6;
      if (shift >= 8) {
        bytes.push((accu >> (shift - 8)) & 255);
        shift -= 8;
      }
    }
    return bytes;
  };

})();

/*
 * Copyright 2014 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 *     http://www.apache.org/licenses/LICENSE-2.0
  
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @fileoverview USB device manager.
 *
 * +-----------------+
 * | Reader-specific |
 * |   driver, like  |  The "who" in the open() function.
 * |    scl3711.js   |
 * +-----------------+  For low level driver, this is "client".
 *         |
 *         v
 * +-----------------+
 * |  dev_manager:   |
 * | open and enum   |
 * | low level devs  |
 * +-----------------+
 *     |         |
 *     v         v
 * +-------+ +-------+  The "which" in the open() function.
 * |llSCL37| |llSCL37|
 * |       | |       |  Low level USB driver.
 * |       | |       |  each maps to a physical device instance.
 * |       | |       |  handling Tx/Rx queues.
 * +-------+ +-------+
 *
 */

'use strict';


// List of enumerated usb devices.
function DevManager() {
  this.devs = [];         // array storing the low level device.
  this.enumerators = [];  // array storing the pending callers of enumerate().
}

// Remove a device from devs[] list.
DevManager.prototype.dropDevice = function(dev) {
  var tmp = this.devs;
  this.devs = [];

  var present = false;
  for (var i = 0; i < tmp.length; ++i) {
    if (tmp[i] !== dev) {
      this.devs.push(tmp[i]);
    } else {
      present = true;
    }
  }
  if (!present) return;  // Done.

  if (dev.dev) {
    chrome.usb.releaseInterface(dev.dev, 0,
        function() { console.log(NFC.util.fmt('released')); });
    chrome.usb.closeDevice(dev.dev,
        function() { console.log(NFC.util.fmt('closed')); });
    dev.dev = null;
  }

  console.log(this.devs.length + ' devices remaining');
};

// Close all enumerated devices.
DevManager.prototype.closeAll = function(cb) {

  console.debug("DevManager.closeAll() is called");

  // First close and stop talking to any device we already
  // have enumerated.
  var d = this.devs.slice(0);
  for (var i = 0; i < d.length; ++i) {
    d[i].close();
  }

  if (cb) {
    cb();
  }
};

// When an app needs a device, it must claim before use (so that kernel
// can handle the lock).
DevManager.prototype.enumerate = function(cb) {
  var self = this;

  function enumerated(d, acr122) {
    var nDevice = 0;

    if (d && d.length != 0) {
      console.log(NFC.util.fmt('Enumerated ' + d.length + ' devices'));
      console.log(d);
      nDevice = d.length;
    } else {
      if (d) {
        console.log('No devices found');
      } else {
        /* TODO(yjlou): Review this case later (d==undefined).
         *              Is this real lacking permission.
         */
        console.log('Lacking permission?');
        do {
          (function(cb) {
            if (cb) window.setTimeout(function() { cb(-666); }, 0);
          })(self.enumerators.shift());
        } while (self.enumerators.length);
        return;
      }
    }

    // Found multiple devices. Create a low level SCL3711 per device.
    for (var i = 0; i < nDevice; ++i) {
      (function(dev, i) {
        window.setTimeout(function() {
            chrome.usb.claimInterface(dev, 0, function(result) {
              console.log(NFC.util.fmt('claimed'));
              console.log(dev);

              // Push the new low level device to the devs[].
              self.devs.push(new llSCL3711(dev, acr122));

              // Only callback after the last device is claimed.
              if (i == (nDevice - 1)) {
                var u8 = new Uint8Array(4);
                u8[0] = nDevice >> 24;
                u8[1] = nDevice >> 16;
                u8[2] = nDevice >> 8;
                u8[3] = nDevice;

                // Notify all enumerators.
                while (self.enumerators.length) {
                  (function(cb) {
                    window.setTimeout(function() { if (cb) cb(0, u8); }, 20);
                  })(self.enumerators.shift());
                }
              }
            });
          }, 0);
      })(d[i], i);
    }
  };
  /* end of enumerated() */

  if (this.devs.length != 0) {
    // Already have devices. Report number right away.
    // TODO(yjlou): The new plugged-in NFC reader may not be detected after
    //              the first time enumerate() is called.
    var u8 = new Uint8Array(4);
    u8[0] = this.devs.length >> 24;
    u8[1] = this.devs.length >> 16;
    u8[2] = this.devs.length >> 8;
    u8[3] = this.devs.length;
    if (cb) cb(0, u8);
  } else {
    var first = this.enumerators.length == 0;

    // Queue callback.
    this.enumerators.push(cb);

    if (first) {
      // Only first requester calls actual low level.
      window.setTimeout(function() {
          chrome.usb.findDevices({'vendorId': 0x04e6, 'productId': 0x5591},
            function (d) {
              if (d && d.length != 0) {
                enumerated(d, false);
              } else {
                chrome.usb.findDevices(
                    {'vendorId': 0x072f, 'productId': 0x2200},
                    function (d) {
                      if (d && d.length != 0) {
                        enumerated(d, true);
                      }
                    });
              }
          });
      }, 0);
    }
  }
};

DevManager.prototype.open = function(which, who, cb) {
  var self = this;
  // Make sure we have enumerated devices.
  this.enumerate(function() {
    var dev = self.devs[which];
    if (dev) dev.registerClient(who);
    if (cb) { cb(dev || null); }
  });
};

DevManager.prototype.close = function(singledev, who) {
  // De-register client from all known devices,
  // since the client might have opened them implicitly w/ enumerate().
  // This will thus release any device without active clients.
  var alldevs = this.devs;
  for (var i = 0; i < alldevs.length; ++i) {
    var dev = alldevs[i];
    var nremaining = dev.deregisterClient(who);
    // TODO: uncomment when Chrome stabilizes.
    /*
    if (nremaining == 0) {
      // This device has no active clients remaining.
      // Close it so libusb releases its claim and other processes
      // can try attach to the device.
      this.dropDevice(dev);
    }
    */
  }
};

// For console interaction.
//  rc   - a number.
//  data - an ArrayBuffer.
DevManager.DevManager.defaultCallback = function(rc, data) {
  var msg = 'DevManager.defaultCallback('+rc;
  if (data) msg += ', ' + NFC.util.BytesToHex(new Uint8Array(data));
  msg += ')';
  console.log(NFC.util.fmt(msg));
};


// Singleton tracking available devices.
var devManager = new DevManager();


/*
 * Copyright 2014 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 *     http://www.apache.org/licenses/LICENSE-2.0
  
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @fileoverview Mifare Classic driver
 */

'use strict';

// TODO: support Classic 4K

/*
 * AN1305 - MIFARE Classic as NFC Type MIFARE Classic Tag
 *
 *          +--------------------+
 *          | Manufacturer Block |  Physical Block 0
 *          |--------------------|
 *          |   Logic block 0    |  Physical Block 1 (MAD1)
 * Sector 0 |--------------------|
 *          |   Logic block 1    |  Physical Block 2 (MAD1)
 *          |--------------------|
 *          |   Sector Trailer   |  Physical Block 3
 *        --+--------------------+
 *          |   Logic block 2    |  Physical Block 4
 *          |--------------------|
 *          |   Logic block 3    |  Physical Block 5
 * Sector 1 |--------------------|
 *          |   Logic block 4    |  Physical Block 6
 *          |--------------------|
 *          |   Sector Trailer   |  Physical Block 7
 *        --+--------------------+
 *          |   Logic block 5    |  Physical Block 8
 *          |--------------------|
 *          |   Logic block 6    |  Physical Block 9
 * Sector 2 |--------------------|
 *          |   Logic block 7    |  Physical Block 10
 *          |--------------------|
 *          |   Sector Trailer   |  Physical Block 11
 *          +--------------------+
 *          |        ...         |        ...
 *
 *
 *
 *
 *
 */

function MifareClassic(tag_id) {
  this.tag_id = new Uint8Array(tag_id);
  this.type_name = "MIFARE Classic 1K";

  this.WRITE_COMMAND = 0xA0;  // differ to type 2's 0xA2.
}

// private functions

// Logic block number to sector number
MifareClassic.prototype.log2sec = function(logic_blknum) {
  if (logic_blknum < 2) return 0;
  return Math.floor((logic_blknum - 2) / 3) + 1;
}

// Logic block number to physical block number
MifareClassic.prototype.log2phy = function(logic_blknum) {
  if (logic_blknum < 2) return logic_blknum + 1;

  var sector = this.log2sec(logic_blknum);
  return sector * 4 + ((logic_blknum - 2) % 3);
}

// input: Uint8Array
MifareClassic.prototype.mif_calc_crc8 = function(input) {
  var crc = 0xc7; // bit-swapped 0xe3

  for (var i = 0; i < input.length; i++) {
    crc = crc ^ input[i];

    for (var j = 0; j < 8; j++) {
      if (crc & 0x80)
        crc = (crc << 1) ^ 0x1d;
      else
        crc = crc << 1;
    }
  }
  return crc;
}

// input: Uint8Array
MifareClassic.prototype.mif_calc_crc16 = function(input) {
  var crc = 0xc78c;  // bit-swapped 0x31e3
  for (var i = 0; i < input.length; i++) {
    crc = crc ^ (input[i] << 8);
    for (var j = 0; j < 8; j++) {
      if (crc & 0x8000)
        crc = (crc << 1) ^ 0x1021;
      else
        crc = crc << 1;
    }
  }
  return crc;
}


/* Since the Key A is not readable so that we need to copy that from the
 * successfully authenticated key storage.
 * We keep key B all-0xff until one day we decide to use it.
 */
MifareClassic.prototype.copy_auth_keys = function(data, dev) {
  for (var i = 0; i < 6; i++) {
    data[i] = dev.auth_key[i];
  }
  // Leave KEY B as default. TODO: don't overwrite if key B is readable.
  for (var i = 0; i < 6; i++) {
    data[i + 10] = 0xff;
  }

  return data;
}


MifareClassic.prototype.read_physical = function(device, phy_block, cnt, cb) {
  var self = this;
  var callback = cb;
  var dev = device;
  var readed = new Uint8Array();  // for closure
  var max_block = 1024 / 16;  // TODO: assume Classic 1K

  if (cnt != null) max_block = phy_block + cnt;

  // Reading whole card is too long (~4secs). This function would return
  // a smaller max_block value if MAD is read and NDEF sectors are recognized.
  function fast_read(phy_block, data, max_block) {
    if (phy_block == 3 && data[0x39] != 0x69 ) {  // personalized GBP
      // TODO: check CRC in MAD.
      var nfc_cnt;
      for (nfc_cnt = 0;  // assume the NDEF is in the 1st sector.
           data[0x12 + nfc_cnt * 2 + 0] == 0x03 &&
           data[0x12 + nfc_cnt * 2 + 1] == 0xE1;
           nfc_cnt++) {};
      var new_num = (nfc_cnt + 1) * 4;
      if (new_num < max_block)
        return new_num;
      else
        return max_block;
    } else {
      return max_block;
    }
  }

  function read_next(phy_block) {
    var blk_no = phy_block;
    dev.publicAuthentication(blk_no, function(rc, data) {
      if (rc) return callback(rc);
      dev.read_block(blk_no, function(rc, bn) {
        if (rc) return callback(rc);
        var bn = new Uint8Array(bn);

        // copy KEY A with auth_key from device.
        if ((blk_no % 4) == 3) {
          bn = self.copy_auth_keys(bn, dev);
        }

        readed = NFC.util.concat(readed, bn);

        max_block = fast_read(blk_no, readed, max_block);
        if ((blk_no + 1)>= max_block)
          return callback(readed);
        else
          return read_next(blk_no + 1, cb);
      });
    });
  }
  read_next(phy_block);
}


// The callback is called with cb(NDEF Uint8Array).
MifareClassic.prototype.read = function(device, cb) {
  var self = this;
  if (!cb) cb = DevManager.defaultCallback;
  var callback = cb;
  var card = new Uint8Array();

  self.read_physical(device, 0, null, function(data) {
    for(var i = 0; i < Math.ceil(data.length / 16); i++) {
      console.log(NFC.util.fmt("[DEBUG] Sector[" + NFC.util.BytesToHex([i]) + "] " +
                  NFC.util.BytesToHex(data.subarray(i * 16,
                                                i * 16 + 16))));
    }

    var GPB = data[0x39];  /* the first GPB */
    if (GPB == 0x69) {
      console.log("[DEBUG] Sector 0 is non-personalized (0x69).");
    } else {
      var DA = (GPB & 0x80) >> 7;   // MAD available: 1 for yes.
      var MA = (GPB & 0x40) >> 6;   // Multiapplication card: 1 for yes.
      var ADV = (GPB & 0x03) >> 0;  // (MAD version code: 1 for v1, 2 for v2)

      // TODO: check CRC in MAD.
      var nfc_cnt;
      for (nfc_cnt = 0;  // assume the NDEF is in the 1st sector.
           data[0x12 + nfc_cnt * 2 + 0] == 0x03 &&
           data[0x12 + nfc_cnt * 2 + 1] == 0xE1;
           nfc_cnt++) {};
      var tlv = new Uint8Array();
      for(var i = 1; i <= nfc_cnt; i++) {
        tlv = NFC.util.concat(tlv, data.subarray(i * 0x40, i * 0x40 + 0x30));
      }

      // TODO: move to tlv.js
      for (var i = 0; i < tlv.length; i++) {
        switch (tlv[i]) {
        case 0x00:  /* NULL */
          console.log("[DEBUG] NULL TLV.");
          break;
        case 0xFE:  /* Terminator */
          console.log("[DEBUG] Terminator TLV.");
          return;
        case 0x03: /* NDEF */
          var len = tlv[i + 1];
          if ((len + 2) > tlv.length) {
            console.log("[WARN] Vlen:" + len + " > totla len:" + tlv.length);
          }
          return callback(0,
              new Uint8Array(tlv.subarray(i + 2, i + 2 + len)).buffer);
          /* TODO: now pass NDEF only. Support non-NDEF in the future. */
          // i += len + 1;
        default:
          console.log("[ERROR] Unsupported TLV: " + NFC.util.BytesToHex(tlv[0]));
          return;
        }
      }
    }
  });
}


MifareClassic.prototype.read_logic = function(device, logic_block, cnt, cb) {
  var self = this;
  var callback = cb;
  var card = new Uint8Array();
  
  function next_logic(logic_block, cnt) {
    var blk_no = logic_block;
    var count = cnt;
    if (count <= 0) return callback(card);
    self.read_physical(device, self.log2phy(logic_block), 1, function(data) {
      card = NFC.util.concat(card, data);
      next_logic(blk_no + 1, count - 1);
    });
  }
  next_logic(logic_block, cnt);
}


// TODO: support multiple data set
/* Input:
 *   ndef - Uint8Array
 *
 * Output:
 *   Whole tag image.
 */
MifareClassic.prototype.compose = function(ndef) {
  var self = this;

  /* ====== Build up TLV blocks first ====== */
  var ndef_tlv = new Uint8Array([
    0x03, ndef.length        /* NDEF Message TLV */
  ]);
  var terminator_tlv = new Uint8Array([
    0xfe
  ]);
  var TLV = NFC.util.concat(ndef_tlv,
            NFC.util.concat(new Uint8Array(ndef),
                        terminator_tlv));

  /* frag into sectors */
  var TLV_sector_num = Math.ceil(TLV.length / 0x30);
  var TLV_blocks = new Uint8Array();
  for (var i = 0; i < TLV_sector_num; i++) {
    TLV_blocks = NFC.util.concat(TLV_blocks,
                             TLV.subarray(i * 0x30, (i + 1) * 0x30));

    var padding;
    if ((i + 1) == TLV_sector_num) {  // last sector
      padding = new Uint8Array(0x30 - (TLV.length % 0x30));
    } else {
      padding = new Uint8Array(0);
    }
    TLV_blocks = NFC.util.concat(TLV_blocks, padding);
    TLV_blocks = NFC.util.concat(TLV_blocks, new Uint8Array([  // Sector Trailer
      0xd3, 0xf7, 0xd3, 0xf7, 0xd3, 0xf7,  // NFC pub key
      0x7f, 0x07, 0x88, 0x40,              // access bits, GPB
      0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,  // KEY B
    ]));
  }

  /* ====== Build up MAD ====== */
  var classic_header = new Uint8Array([
    /* Manufacturer Block */
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,

    /* MAD1 */
    0x00, 0x00, 0x03, 0xe1,  // CRC, info, AID 1
    0x00, 0x00, 0x00, 0x00,  // AID 2, AID 3
    0x00, 0x00, 0x00, 0x00,  // AID 4, AID 5
    0x00, 0x00, 0x00, 0x00,  // AID 6, AID 7
    0x00, 0x00, 0x00, 0x00,  // AID 8, AID 9
    0x00, 0x00, 0x00, 0x00,  // AID a, AID b
    0x00, 0x00, 0x00, 0x00,  // AID c, AID d
    0x00, 0x00, 0x00, 0x00,  // AID e, AID f

    /* Sector Trailer */
    0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5,  // MAD access key
    0x78, 0x77, 0x88, 0xc1,              // access bits, GPB
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,  // KEY B
  ]);

  for (var i = 0; i < TLV_sector_num; i++) {
    classic_header[0x10 + (i + 1) * 2 + 0] = 0x03;
    classic_header[0x10 + (i + 1) * 2 + 1] = 0xe1;
  }
  classic_header[0x10] =
      self.mif_calc_crc8(classic_header.subarray(0x11, 0x30));

  var ret = NFC.util.concat(classic_header, TLV_blocks);
  return ret;
}


// Input:
//   block_no: starting physical block number
//   data: Uint8Array of data to write. Reminding data will be write to
//         next block continously.
MifareClassic.prototype.write_physical = function(device, block_no, key,
                                                  all_data, cb) {
  var dev = device;
  var blk_no = block_no;  // for closure
  var data = all_data;
  var callback = cb;
  var self = this;

  if (data.length == 0) { return callback(0); }
  if (data.length < 16) {
    // Pad to 16 bytes
    data = NFC.util.concat(data, new Uint8Array(16 - data.length));
  }

  function authenticationCallback (rc, dummy) {
    if (rc) return callback(rc);

    var block_data = data.subarray(0, 16);
    dev.write_block(blk_no, block_data, function(rc) {
      if (rc) return callback(rc);
      self.write_physical(dev, blk_no + 1, key, data.subarray(16), callback);
    }, self.WRITE_COMMAND);
  }
  if (key == null)
    dev.publicAuthentication(blk_no, authenticationCallback);
  else
    dev.privateAuthentication(blk_no, key, authenticationCallback);
}


// Input:
//   ndef: ArrayBuffer. Just ndef is needed. Classic header is handled.
MifareClassic.prototype.write = function(device, ndef, cb) {
  var self = this;
  if (!cb) cb = DevManager.defaultCallback;
  var callback = cb;
  var card = self.compose(new Uint8Array(ndef));
  var dev = device;

  var max_block = Math.ceil(card.length / 16);

  if (max_block > (1024 / 16)) {
    console.log("write Classic() card is too big (max: 1024 bytes): " +
                card.length);
    return callback(0xbbb);
  }

  /* Start from MAD */
  self.write_physical(dev, 1, null, card.subarray(16), callback);
}


// Input:
//   logic_block: logic block number
//   data: Uint8Array of data to write. Reminding data will be write to
//         next block continously.
//   
// Note that the GPB will be written to no-MAD (MA=0) to fully access
// all data blocks.
MifareClassic.prototype.write_logic = function(device, logic_block,
                                               all_data, cb) {
  var self = this;
  var callback = cb;


  function write_next(device, logic_block, all_data) {
    var dev = device;
    var blk_no = logic_block;
    var data = all_data;

    if (data.length == 0) return callback(0);
  
    self.write_physical(dev, self.log2phy(blk_no), null,
                        data.subarray(0, 16),
                        function(rc) {
      if (rc) return callback(rc);

      // update the corresponding GPB to 0x00.
      var gpb_phy = self.log2sec(blk_no) * 4 + 3;
      dev.read_block(gpb_phy, function(rc, gpb_data) {
        if (rc) return callback(rc);
        var gpb_data = new Uint8Array(gpb_data);
        gpb_data = self.copy_auth_keys(gpb_data, dev);

        if (gpb_phy == 3)
          gpb_data[0x9] = 0xc1;  // the first GPB: DA=MA=1, ADV=1
        else
          gpb_data[0x9] = 0x40;  // non-first GPB: MA=1.

        dev.write_block(gpb_phy, gpb_data, function(rc) {
          // move to next block
          blk_no = blk_no + 1;
          data = data.subarray(16);
          return write_next(dev, blk_no, data);
        }, self.WRITE_COMMAND);
      });
    });
  }
  write_next(device, logic_block, all_data);
}


MifareClassic.prototype.emulate = function(device, ndef_obj, timeout, cb) {
  /* TODO: still presents as TT2 */
  var data = this.compose(new Uint8Array(ndef_obj.compose()));
  return device.emulate_tag(data, timeout, cb);
}

/*
 * Copyright 2014 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 *     http://www.apache.org/licenses/LICENSE-2.0
  
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @fileoverview NDEF messgae parser.
 */

'use strict';


/* Input:
 *   raw is either ArrayBuffer.
 */
function NDEF(raw, cb) {
  this.ndef = [];
  this.prepending = [  /* for RTD_URI */
    "",
    "http://www.",
    "https://www.",
    "http://",
    "https://",
    "tel:",
    "mailto:",
    "ftp://anonymous:anonymous@",
    "ftp://ftp.",
    "ftps://",
    "sftp://",
    "smb://",
    "nfs://",
    "ftp://",
    "dav://",
    "news:",
    "telnet://",
    "imap:",
    "rtsp://",
    "urn:",
    "pop:",
    "sip:",
    "sips:",
    "tftp:",
    "btspp://",
    "btl2cpa://",
    "btgoep://",
    "tcpobex://",
    "irdaobex://",
    "file://",
    "urn:epc:id:",
    "urn:epc:tag:",
    "urn:epc:pat:",
    "urn:epc:raw:",
    "urn:epc:",
    "urn:nfc:"
  ];

  if (raw) {
    this.ndef = this.parse(raw, cb);
  }

}

/* Input:
 *   raw is either ArrayBuffer.
 *
 * Output:
 *   The callback function will get a JS structure for NDEF content.
 *
 * For the message format, please refer to Chapter 3 of NDEF spec.
 */
NDEF.prototype.parse = function(raw, cb) {
  var i;  /* index to access raw[] */
  var ret = [];
  raw = new Uint8Array(raw);

  for (i = 0; i < raw.length; i++) {
    var MB = (raw[i] & 0x80) >> 7;   /* Message Begin */
    var ME = (raw[i] & 0x40) >> 6;   /* Message End */
    var CF = (raw[i] & 0x20) >> 5;   /* Chunk Flag */
    var SR = (raw[i] & 0x10) >> 4;   /* Short Record */
    var IL = (raw[i] & 0x08) >> 3;   /* ID_LENGTH field is present */
    var TNF = (raw[i] & 0x07) >> 0;  /* Type Name Format */
    var type_off;
    var type_len = raw[i + 1];
    var id;
    var type;
    var payload_off = 4 + type_len;
    var payload_len;
    var payload;

    if (SR) {
      type_off = 3;
      payload_off = 3 + type_len;
      payload_len = raw[i + 2];
    } else {
      type_off = 6;
      payload_off = 6 + type_len;
      payload_len = ((raw[i + 2] * 256 + raw[i + 3]) * 256 +
                      raw[i + 4]) * 256 + raw[i + 5];
    }
    if (IL) {
      type_off += 1;
      var id_len = raw[i + type_off - 1];
      payload_off += 1 + id_len;
      var id_off = type_off + type_len;
      id = raw.subarray(i + id_off, i + id_off + id_len);
    } else {
      id = null;
    }

    type = new Uint8Array(raw.subarray(i + type_off, i + type_off + type_len));
    payload = new Uint8Array(
                raw.subarray(i + payload_off, i + payload_off + payload_len));

    if (1) {  /* for DEBUG */
      console.log("raw[i]: " + raw[i]);
      console.log("MB: " + MB);
      console.log("ME: " + ME);
      console.log("SR: " + SR);
      console.log("IL: " + IL);
      console.log("TNF: " + TNF);
      console.log("type_off: " + type_off);
      console.log("type_len: " + type_len);
      console.log("payload_off: " + payload_off);
      console.log("payload_len: " + payload_len);
      console.log("type: " + NFC.util.BytesToHex(type));
      console.log("payload: " + NFC.util.BytesToHex(payload));
    }

    switch (TNF) {
    case 0x01:  /* NFC RTD - so called Well-known type */
      ret.push(this.parse_RTD(type[0], payload));
      break;
    case 0x02:  /* MIME - RFC 2046 */
      ret.push(this.parse_MIME(type, payload));
      break;
    case 0x04:  /* NFC RTD - so called External type */
      ret.push(this.parse_ExternalType(type, payload));
      break;
    default:
      console.error("Unsupported TNF: " + TNF);
      break;
    }

    i = payload_off + payload_len - 1;
    if (ME) break;
  }

  if (cb)
    cb(ret);

  return ret;
}


/* Input:
 *   None.
 *
 * Output:
 *   ArrayBuffer.
 *
 */
NDEF.prototype.compose = function() {
  var out = new Uint8Array();
  var arr = [];

  for (var i = 0; i < this.ndef.length; i++) {
    var entry = this.ndef[i];

    switch (entry["type"]) {
    case "TEXT":
    case "Text":
      arr.push({"TNF": 1,
                "TYPE": new Uint8Array([0x54 /* T */]),
                "PAYLOAD": this.compose_RTD_TEXT(entry["lang"],
                                                 entry["text"])});
      break;
    case "URI":
      arr.push({"TNF": 1,
                "TYPE": new Uint8Array([0x55 /* U */]),
                "PAYLOAD": this.compose_RTD_URI(entry["uri"])});
      break;
    case "MIME":
      arr.push({"TNF": 2, 
                "TYPE": new Uint8Array(NFC.util.StringToBytes(entry["mime_type"])),
                "PAYLOAD": this.compose_MIME(entry["payload"])});
      break;
    case "AAR":
      arr.push({"TNF": 4,
                "TYPE": new Uint8Array(NFC.util.StringToBytes('android.com:pkg')),
                "PAYLOAD": this.compose_AAR(entry["aar"])});
      break;
    default:
      console.error("Unsupported RTD type:" + entry["type"]);
      break;
    }
  }

  for (var i = 0; i < arr.length; i++) {
    var flags = 0x10 | arr[i]["TNF"];  /* SR and TNF */
    flags |= (i == 0) ? 0x80 : 0x00;  /* MB */
    flags |= (i == (arr.length - 1)) ? 0x40 : 0x00;  /* ME */

    var type = arr[i]["TYPE"];
    var payload = arr[i]["PAYLOAD"];
    out = NFC.util.concat(out, [flags, type.length, payload.length]);
    out = NFC.util.concat(out, type);
    out = NFC.util.concat(out, payload);
  }

  return out.buffer;
}


/* Input:
 *   A dictionary, with "type":
 *     "Text": RTD Text. Require: "encoding", "lang" and "text".
 *     "URI": RTD URI. Require: "uri".
 *     "MIME": RFC 2046 media types. Require: "mime_type" and "payload".
 *     "AAR": Android Application Record. Require: "aar".
 *
 * Output:
 *   true for success.
 *
 */
NDEF.prototype.add = function(d) {
  // short-cut
  if ("uri" in d) {
    d["type"] = "URI";
  } else if ("text" in d) {
    d["type"] = "TEXT";
  } else if ("aar" in d) {
    d["type"] = "AAR";
  } else if ("payload" in d) {
    d["type"] = "MIME";
  }

  switch (d["type"]) {
  case "TEXT":
  case "Text":
    /* set default values */
    if (!("encoding" in d)) {
      d["encoding"] = "utf8";
    }
    if (!("lang" in d)) {
      d["lang"] = "en";
    }

    if ("text" in d) {
      this.ndef.push(d);
      return true;
    }
    break;

  case "URI":
    if ("uri" in d) {
      this.ndef.push(d);
      return true;
    }
    break;

  case "MIME":
    if (("mime_type" in d) && ("payload" in d)) {
      this.ndef.push(d);
      return true;
    }

  case "AAR":
    if ("aar" in d) {
      this.ndef.push(d);
      return true;
    }
    break;

  default:
    console.log("Unsupported RTD type:" + d["type"]);
    break;
  }
  return false;
}


/*
 * Input:
 *   type -- a byte, see RTD Type Names
 *   rtd  -- Uint8Array.
 *
 * Output:
 *   JS structure
 */
NDEF.prototype.parse_RTD = function(type, rtd) {
  switch (type) {
  case 0x54:  /* 'T' */
    return this.parse_RTD_TEXT(rtd);
  case 0x55:  /* 'U' */
    return this.parse_RTD_URI(rtd);
  default:
    console.log("Unsupported RTD type: " + type);
  }
}


/*
 * Input:
 *   mime_type -- Uint8Array. See RFC 2046.
 *   payload  -- Uint8Array.
 *
 * Output:
 *   JS structure
 */
NDEF.prototype.parse_MIME = function(mime_type, payload) {
  return {"type": "MIME",
          "mime_type": NFC.util.BytesToString(mime_type),
          "payload": NFC.util.BytesToString(payload)};
}


/*
 * Input:
 *   mime_type and payload: string.
 *
 * Output:
 *   rtd_text  -- Uint8Array.
 */
NDEF.prototype.compose_MIME = function(payload) {
  return new Uint8Array(NFC.util.StringToBytes(payload));
}


/*
 * Input:
 *   payload  -- Uint8Array.
 *
 * Output:
 *   JS structure
 */
NDEF.prototype.parse_AAR = function(payload) {
  return {"type": "AAR",
          "payload": NFC.util.BytesToString(payload)};
}

/*
 * Input:
 *   type     -- Uint8Array.
 *   payload  -- Uint8Array.
 *
 * Output:
 *   JS structure
 */
NDEF.prototype.parse_ExternalType = function(type, payload) {
  if (NFC.util.BytesToString(type) == "android.com:pkg")
    return this.parse_AAR(payload);
  else
    return {"type": type,
            "payload": NFC.util.BytesToString(payload)};
}


/*
 * Input:
 *   payload: string.
 *
 * Output:
 *   Uint8Array.
 */
NDEF.prototype.compose_AAR = function(payload) {
  return new Uint8Array(NFC.util.StringToBytes(payload));
}


/*
 * Input:
 *   rtd_text  -- Uint8Array.
 *
 * Output:
 *   JS structure
 */
NDEF.prototype.parse_RTD_TEXT = function(rtd_text) {
  var utf16 = (rtd_text[0] & 0x80) >> 7;
  var lang_len = (rtd_text[0] & 0x3f);
  var lang = rtd_text.subarray(1, 1 + lang_len);
  var text = rtd_text.subarray(1 + lang_len, rtd_text.length);

  return {"type": "Text",
          "encoding": utf16 ? "utf16" : "utf8",
          "lang": NFC.util.BytesToString(lang),
          "text": NFC.util.BytesToString(text)};
}


/*
 * Input:
 *   Language and text (assume UTF-8 encoded).
 *
 * Output:
 *   rtd_text  -- Uint8Array.
 */
NDEF.prototype.compose_RTD_TEXT = function(lang, text) {
  var l = lang.length;
  l = (l > 0x3f) ? 0x3f : l;
  return new Uint8Array([l].concat(
                        NFC.util.StringToBytes(lang.substring(0, l))).concat(
                        NFC.util.StringToBytes(text)));
}


/*
 * Input:
 *   rtd_uri  -- Uint8Array.
 *
 * Output:
 *   JS structure
 */
NDEF.prototype.parse_RTD_URI = function(rtd_uri) {
  return {"type": "URI",
          "uri": this.prepending[rtd_uri[0]] +
                 NFC.util.BytesToString(rtd_uri.subarray(1, rtd_uri.length))};
}

/*
 * Input:
 *   Thr URI to compose (assume UTF-8).
 *
 * Output:
 *   Uint8Array.
 */
NDEF.prototype.compose_RTD_URI = function(uri) {
  var longest = -1;
  var longest_i;
  for (var i = 0; i < this.prepending.length; i++) {
    if (uri.substring(0, this.prepending[i].length) == this.prepending[i]) {
      if (this.prepending[i].length > longest) {
        longest_i = i;
        longest = this.prepending[i].length;
      }
    }
  }
  // assume at least longest_i matches prepending[0], which is "".

  return new Uint8Array([longest_i].concat(
                        NFC.util.StringToBytes(uri.substring(longest))));
}


/*
 * Copyright 2014 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 *     http://www.apache.org/licenses/LICENSE-2.0
  
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @fileoverview chrome.nfc
 */

'use strict';

function NFC() {

  // private functions
  function construct_ndef_obj(ndef_array) {
    var ndef_obj = new NDEF();

    for (var i = 0; i < ndef_array.length; i++) {
      ndef_obj.add(ndef_array[i]);
    }

    return ndef_obj;
  }

  function wait_for_passive_target(device, cb, timeout) {
    if (timeout == undefined) timeout = 9999999999;

    device.wait_for_passive_target(timeout, function(rc, tag_type, tag_id) {
      if (rc) {
        console.log("NFC.wait_for_passive_target() = " + rc);
        cb(rc);
        return rc;
      }
      console.log("[DEBUG] nfc.wait_for_passive_target: " + tag_type + " with ID: " + NFC.util.BytesToHex(new Uint8Array(tag_id)));
      cb(rc, tag_type, tag_id);
    });
  }

  /*
   *  This function is to get use-able NFC device(s).
   *
   *  TODO: Currently, this function returns at most 1 device.
   *
   *  cb(devices) is called after enumeration. 'devices' is an array of all
   *  found devices. It is an empty array if no NFC device is found.
   */
  this.findDevices = function(cb) {
    var device = new usbSCL3711();
    window.setTimeout(function() {
      device.open(0, function(rc) {
        if (rc) {
          console.log("NFC.device.open() = " + rc);
          cb([]);
          return rc;
        }
        // cache device info
        device.vendorId = device.dev.dev.vendorId;
        device.productId = device.dev.dev.productId;

        cb([device]);
      }, function() {
        console.debug("device.onclose() is called.");
      });
    }, 1000);
  };

  /*
   *  Read a tag.
   *
   *  'options' is a dictionary with optional parameters. If a parameter is
   *  missed, a default value is applied. Options include:
   *
   *    'timeout': timeout for this operation. Default: infinite
   *    TODO: 'type': type of tag to listen. Default: "any" for any type.
   *                  However, currently only tag 2 and NDEF is supported.
   *
   *  'cb' lists callback functions for particular tag contents.
   *  When called, 2 parameters are given: 'type' and 'content'.
   *  'type' indicates the tag type detected in the hierarchical form, ex:
   *  "tt2.ndef". Then 'content' is the NDEF object.
   */
  this.read = function(device, options, cb) {
    var timeout = options["timeout"];
    var callback = cb;

    wait_for_passive_target(device, function(rc, tag_type, tag_id) {
      var tag = new Tag(tag_type, tag_id);
      if (!tag) {
          console.log("nfc.read: unknown tag_type: " + tag_type);
          return;
      }

      tag.read(device, function(rc, ndef){
        if (rc) {
          console.log("NFC.read.read() = " + rc);
          callback(null, null);  /* no type reported */
          return rc;
        }
        var ndef_obj = new NDEF(ndef);
        callback(tag_type + ".ndef", ndef_obj);
      });
    }, timeout);
  };

  /*
   * Read logic blocks.
   */
  this.read_logic = function(device, logic_block, cnt, cb) {
    var callback = cb;

    wait_for_passive_target(device, function(rc, tag_type, tag_id) {
      var tag = new Tag(tag_type, tag_id);
      if (!tag) {
        console.log("nfc.read_logic: unknown tag_type: " + tag_type);
        return;
      }
      if (!tag.read_logic) {
        console.log("nfc.read: " + tag_type +
                    " doesn't support reading logic block");
        return;
      }

      tag.read_logic(device, logic_block, cnt, function(data) {
        callback(0, data);
      });
    });
  };

  /*
   * Return tag_id as soon as a tag is detected.
   */
  this.wait_for_tag = function(device, timeout, cb) {
      var callback = cb;

      var loop = function(timeout) {

          wait_for_passive_target(device, function(rc, tag_type, tag_id) {
              if(rc >= 0) {
                  callback(tag_type, tag_id);
              }
              else {
                  if(timeout > 0) {
                      window.setTimeout(function() {
                          loop(timeout-250)
                      }, 250);
                  } else
                      callback(null, null);
              }
          });
      }
      loop(timeout);
  };

  /*
   *  Write content to tag.
   *
   *  'content' is a dictionary containing structures to write. Supports:
   *    ['ndef']: an array of NDEF dictionary. Will be written as a tag
   *              type 2.
   *
   *  cb(0) is called if success.
   *  timeout is optional.
   */
  this.write = function(device, content, cb, timeout) {
    wait_for_passive_target(device, function(rc, tag_type, tag_id) {
      var tag = new Tag(tag_type, tag_id);
      if (!tag) {
          console.log("nfc.write: unknown tag_type: " + tag_type);
          return;
      }

      var ndef_obj = construct_ndef_obj(content["ndef"]);
      tag.write(device, ndef_obj.compose(), function(rc) {
        cb(rc);
      });
    }, timeout);
  };

  /*
   *  Write to logic blocks.
   *
   *  'logic_block': the starting logic block number.
   *  'data': Uint8Array. Can large than 16-byte.
   */
  this.write_logic = function(device, logic_block, data, cb) {
    var callback = cb;

    wait_for_passive_target(device, function(rc, tag_type, tag_id) {
      var tag = new Tag(tag_type, tag_id);
      if (!tag) {
          console.log("nfc.write_logic: unknown tag_type: " + tag_type);
          return;
      }

      if (!tag.write_logic) {
        console.log("nfc.read: " + tag_type +
                    " doesn't support reading logic block");
        return;
      }

      tag.write_logic(device, logic_block, data, function(rc) {
        callback(rc);
      });
    });
  };


  /*
   *  Write to physical blocks.
   *
   *  'physical_block': the starting physical block number.
   *  'data': Uint8Array. Can large than 16-byte.
   */
  this.write_physical = function(device, physical_block, key, data, cb) {
    var callback = cb;

    wait_for_passive_target(device, function(rc, tag_type, tag_id) {
      var tag = new Tag(tag_type, tag_id);
      if (!tag) {
          console.log("nfc.write_physical: unknown tag_type: " + tag_type);
          return;
      }

      if (!tag.write_physical) {
        console.log("nfc.read: " + tag_type +
                    " doesn't support reading physical block");
        return;
      }

      tag.write_physical(device, physical_block, key, data, function(rc) {
        callback(rc);
      });
    });
  };

  /*
   *  Emulate as a tag.
   *
   *  'content' is a dictionary containing structures to write. Supports:
   *    ['ndef']: an array of NDEF dictionary. Will be written as a tag
   *              type 2.
   *
   *  cb(0) is called if success.
   *  timeout is optional.
   */
  this.emulate_tag = function(device, content, cb, timeout) {
    if (timeout == undefined) timeout = 9999999999;
    wait_for_passive_target(device, function(rc, tag_type, tag_id) {
      var tt2 = new TT2();
      var ndef_obj = construct_ndef_obj(content["ndef"]);
      tt2.emulate(device, ndef_obj, timeout, function(rc) {
        cb(rc);
      });
    }, timeout);
  };
}

chrome.nfc = NFC();

/*
 * Copyright 2014 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 *     http://www.apache.org/licenses/LICENSE-2.0
  
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @fileoverview SCL3711 USB driver.
 */

'use strict';

// Global SCL3711 instance counter.
var scl3711_id = 0;

// Worker SCL3711 instances. Tied 1-on-1 to websocket worker.
function usbSCL3711() {
  this.dev = null;
  // Pick unique channel (within process..)
  this.cid = (++scl3711_id) & 0x00ffffff;
  this.rxframes = [];
  this.rxcb = null;
  this.onclose = null;
  this.detected_tag = null;   // TODO: move this to mifare_classic.js
  this.auth_key = null;       // TODO: move this to mifare_classic.js
  this.authed_sector = null;  // TODO: move this to mifare_classic.js
  this.KEYS = [               // TODO: move this to mifare_classic.js
    new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),  // defailt
    new Uint8Array([0xd3, 0xf7, 0xd3, 0xf7, 0xd3, 0xf7]),  // NFC Forum
    new Uint8Array([0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5])   // MAD
  ];

  this.strerror = function(errno) {
    var err = {
      0x01: "time out, the target has not answered",
      0x02: "checksum error during rf communication",
      0x03: "parity error during rf communication",
      0x04: "erroneous bit count in anticollision",
      0x05: "framing error during mifare operation",
      0x06: "abnormal bit collision in 106 kbps anticollision",
      0x07: "insufficient communication buffer size",
      0x09: "rf buffer overflow detected by ciu",
      0x0a: "rf field not activated in time by active mode peer",
      0x0b: "protocol error during rf communication",
      0x0d: "overheated - antenna drivers deactivated",
      0x0e: "internal buffer overflow",
      0x10: "invalid command parameter",
      0x12: "unsupported command from initiator",
      0x13: "format error during rf communication",
      0x14: "mifare authentication error",
      0x18: "not support NFC secure",
      0x19: "i2c bus line is busy",
      0x23: "wrong uid check byte (14443-3)",
      0x25: "command invalid in current dep state",
      0x26: "operation not allowed in this configuration",
      0x27: "not acceptable command due to context",
      0x29: "released by initiator while operating as target",
      0x2a: "card ID does not match",
      0x2b: "the card previously activated has disapperaed",
      0x2c: "Mismatch between NFCID3 initiator and target in DEP 212/424 kbps",
      0x2d: "Over-current event has been detected",
      0x2e: "NAD missing in DEP frame",
      0x2f: "deselected by initiator while operating as target",
      0x31: "initiator rf-off state detected in passive mode",
      0x7F: "pn53x application level error"
    };

    if (errno in err) {
      return "[" + errno + "] " + err[errno];
    } else {
      return "Unknown error: " + errno;
    }
  };

}

// Notify callback for every frame received.
usbSCL3711.prototype.notifyFrame = function(cb) {
  if (this.rxframes.length != 0) {
    // Already have frames; continue.
    if (cb) window.setTimeout(cb, 0);
  } else {
    this.rxcb = cb;
  }
};

// Called by low level driver.
// Return true if still interested.
usbSCL3711.prototype.receivedFrame = function(frame) {
  if (!this.rxframes) return false;  // No longer interested.

  this.rxframes.push(frame);

  // Callback self in case we were waiting.
  var cb = this.rxcb;
  this.rxcb = null;
  if (cb) window.setTimeout(cb, 0);

  return true;
};

// Return oldest frame. Throw if none.
usbSCL3711.prototype.readFrame = function() {
  if (this.rxframes.length == 0) throw 'rxframes empty!' ;

  var frame = this.rxframes.shift();
  return frame;
};

// Poll from rxframes[], reconstruct entire message.
// timeout in seconds.
usbSCL3711.prototype.read = function(timeout, cb) {
  if (!this.dev){ cb(1); return; }

  var tid = null;  // timeout timer id.
  var callback = cb;
  var self = this;

  // Schedule call to cb if not called yet.
  function schedule_cb(a, b, c) {
    if (tid) {
      // Cancel timeout timer.
      window.clearTimeout(tid);
      tid = null;
    }
    var C = callback;
    if (C) {
      callback = null;
      window.setTimeout(function() { C(a, b, c); }, 0);
    }
  };

  function read_timeout() {
    if (!callback || !tid) return;  // Already done.

    console.log(NFC.util.fmt(
        '[' + self.cid.toString(16) + '] timeout!'));

    tid = null;
  };

  function read_frame() {
    if (!callback || !tid) return;  // Already done.

    var f = new Uint8Array(self.readFrame());

    // http://www.nxp.com/documents/user_manual/157830_PN533_um080103.pdf
    // Section 7.1 ACK frame.
    if (f.length == 6 &&
        f[0] == 0x00 &&
        f[1] == 0x00 &&
        f[2] == 0xff &&
        f[3] == 0x00 &&
        f[4] == 0xff &&
        f[5] == 0x00) {
      // Expected positive ack, read more.
      self.notifyFrame(read_frame);
      return;  // wait for more.
    }

    // Change the ACR122 response to SCL3711 format.
    if (f.length > 10) {
      if (f[0] == 0x80 /* RDR_to_PC_Datablock */) {
        f = NFC.util.concat(
              new Uint8Array([0x00, 0x00, 0xff, 0x01, 0xff]),
              new Uint8Array(f.subarray(10)));
      } else if (f[0] == 0x83 /* RDR_to_PC_Escape */) {
        f = NFC.util.concat(
              new Uint8Array([0x00, 0x00, 0xff, 0x01, 0xff]),
              new Uint8Array(f.subarray(10)));
      }
    }

    // TODO: implement NACK frame? Error frame?
    // TODO: preamble and postamble frames?

    // TODO: check data checksum?
    // TODO: short cut. Will leave to callback to handle.
    if (f.length == 7) {
      if (f[5] == 0x90 &&
          f[6] == 0x00) {
        /* ACR122U - operation is success. */
        schedule_cb(0, f.buffer);
        return;
      } else if (f[5] == 0x63 &&
                 f[6] == 0x00) {
        /* ACR122U - operation is failed. */
        schedule_cb(0xaaa, f.buffer);
        return;
      }
    } else if (f.length > 6 &&
        f[0] == 0x00 &&
        f[1] == 0x00 &&
        f[2] == 0xff &&
        f[3] + f[4] == 0x100 /* header checksum */) {
      if (f[5] == 0xd5 &&
          f[6] == 0x41 /* InDataExchange reply */) {
        if (f[7] == 0x00 /* status */) {
          schedule_cb(0, new Uint8Array(f.subarray(8, f.length - 2)).buffer);
        } else {
          console.log("ERROR: InDataExchange reply status = " +
                      self.strerror(f[7]));
        }
        return;
      } else if (f[5] == 0xd5 &&
                 f[6] == 0x8d /* TgInitAsTarget reply */) {
        /* TODO: f[7] Mode is ignored. */
        schedule_cb(0, new Uint8Array(f.subarray(8, f.length - 2)).buffer);
        return;
      } else if (f[5] == 0xd5 &&
                 f[6] == 0x89 /* TgGetInitiatorCommand reply */) {
        if (f[7] == 0x00 /* Status */) {
          schedule_cb(0, new Uint8Array(f.subarray(8, f.length - 2)).buffer);
        } else {
          console.log("ERROR: TgGetInitiatorCommand reply status = " +
                      self.strerror(f[7]));
        }
        return;
      } else if (f[5] == 0xd5 &&
                 f[6] == 0x91 /* TgResponseToInitiator reply */) {
        if (f[7] == 0x00 /* Status */) {
          schedule_cb(0, new Uint8Array(f.subarray(8, f.length - 2)).buffer);
        } else {
          console.log("ERROR: TgResponseToInitiator reply status = " +
                      self.strerror(f[7]));
        }
        return;
      } else if (f[5] == 0xd5 &&
                 f[6] == 0x33 /* RFConfiguration reply */) {
        schedule_cb(0, new Uint8Array(f.subarray(7, f.length - 2)).buffer);
        return;
      } else if (f[5] == 0xd5 &&
                 f[6] == 0x4b /* InListPassiveTarget reply */) {
        if (f[7] == 0x01 /* tag number */ &&
            f[8] == 0x01 /* Tg */) {

          /* TODO:
           * Take [SENS_REQ(ATQA), SEL_RES(SAK), tag_id] to ask database.
           * The database would return the corresponding TAG object.
           */

          console.log("DEBUG: InListPassiveTarget SENS_REQ(ATQA)=0x" +
                      (f[9] * 256 + f[10]).toString(16) +
                      ", SEL_RES(SAK)=0x" + f[11].toString(16));
          var NFCIDLength = f[12];
          var tag_id = new Uint8Array(f.subarray(13, 13 + NFCIDLength)).buffer;
          console.log("DEBUG: tag_id: " +
              NFC.util.BytesToHex(new Uint8Array(tag_id)));

          if (f[9] == 0x00 && f[10] == 0x44 /* SENS_RES */) {
            /* FIXME: not actually Ultralight. Only when tag_id[0]==0x04 */
            console.log("DEBUG: found Mifare Ultralight (106k type A)");
            self.detected_tag = "Mifare Ultralight";
            self.authed_sector = null;
            self.auth_key = null;
            schedule_cb(0, "tt2", tag_id);
            return;
          } else if (f[9] == 0x00 && f[10] == 0x04 /* SENS_RES */) {
            /* FIXME: not actually Classic. Only when tag_id[0]==0x04 */
            console.log("DEBUG: found Mifare Classic 1K (106k type A)");
            self.detected_tag = "Mifare Classic 1K";
            self.authed_sector = null;
            self.auth_key = null;
            schedule_cb(0, "mifare_classic", tag_id);
            return;
          }
        } else {
          console.log("DEBUG: found " + f[7] + " target, tg=" + f[8]);
          return;
        }
      }
    }

    // Not sure what kind of reply this is. Report w/ error.
    schedule_cb(0x888, f.buffer);
  };

  // Start timeout timer.
  tid = window.setTimeout(read_timeout, 1000.0 * timeout);

  // Schedule read of first frame.
  self.notifyFrame(read_frame);
};

// Wrap data into frame, queue for sending.
usbSCL3711.prototype.write = function(data) {
  this.dev.writeFrame(data);
};

usbSCL3711.prototype.exchange = function(data, timeout, cb) {
  this.write(data);
  this.read(timeout, cb);
};


// TODO: move to ACR122-specific file
usbSCL3711.prototype.acr122_reset_to_good_state = function(cb) {
  var self = this;
  var callback = cb;

  self.exchange(new Uint8Array([
    0x00, 0x00, 0xff, 0x00, 0xff, 0x00]).buffer, 1, function(rc, data) {
      if (rc) {
        console.warn("[FIXME] acr122_reset_to_good_state: rc = " + rc);
      }
      // icc_power_on
      self.exchange(new Uint8Array([
        0x62, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00]).buffer,
        10, function(rc, data) {
          if (rc) {
            console.warn("[FIXME] icc_power_on: rc = " + rc);
          }
          console.log("[DEBUG] icc_power_on: turn on the device power");
          if (callback) window.setTimeout(function() { callback(0); }, 100);
      });
  });
}

// set the beep on/off
usbSCL3711.prototype.acr122_set_buzzer = function(enable, cb) {
  var self = this;
  var callback = cb;
  var buzz = (enable) ? 0xff : 0x00;

  self.exchange(new Uint8Array([
    0x6b, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0xff, 0x00, 0x52, buzz, 0x00]).buffer, 1.0, function(rc, data) {
      if (callback) callback(rc, data);
  });
}

usbSCL3711.prototype.acr122_load_authentication_keys = function(key, loc, cb) {
  var self = this;
  var callback = cb;

  if (key == null) key = self.KEYS[0];
  else if (typeof key != "object") key = self.KEYS[key];

  var u8 = new Uint8Array([
    0x6b, 0x0b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0xff, 0x82,  /* INS: Load Authentication Keys */
          0x00,  /* P1: Key Structure: volatile memory */
          loc,   /* P2: Key Number (key location): 0 or 1 */
          0x06]);/* Lc: 6 bytes */
  u8 = NFC.util.concat(u8, key);

  self.exchange(u8.buffer, 1.0, function(rc, data) {
      console.log("[DEBUG] acr122_load_authentication_keys(loc: " + loc +
                  ", key: " + NFC.util.BytesToHex(key) + ") = " + rc);
      if (callback) callback(rc, data);
  });
}

/* the 'block' is in 16-bytes unit. */
usbSCL3711.prototype.acr122_authentication = function(block, loc, type, cb) {
  var self = this;
  var callback = cb;

  self.exchange(new Uint8Array([
    0x6b, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0xff, 0x86,  /* INS: Authentication */
          0x00,  /* P1: */
          0x00,  /* P2: */
          0x05,  /* Lc: 5 bytes (Authentication Data Bytes) */
          0x01,  /* Version */
          0x00,  /* 0x00 */
          block, /* Block number */
          type,  /* Key type: TYPE A (0x60) or TYPE B (0x61) */ 
          loc    /* Key number (key location): 0 or 1 */
          ]).buffer, 1.0, function(rc, data) {
    console.log("[DEBUG] acr122_authentication(loc: " + loc +
                ", type: " + type + ", block: " + block + ") = " + rc);
    if (callback) callback(rc, data);
  });
};

/* For Mifare Classic only. The 'block' is in 16-bytes unit. */
usbSCL3711.prototype.publicAuthentication = function(block, cb) {
  var self = this;
  var callback = cb;
  var sector = Math.floor(block / 4);

  function try_keyA(k) {
    var ki = k;  // for closure
    if (ki >= 3) {  // failed authentication
      if (callback) callback(0xfff);
      return;
    }
    self.acr122_load_authentication_keys(ki, 0, function(rc, data) {
      if (rc) return;
      self.acr122_authentication(block, 0, 0x60/*KEY A*/, function(rc, data) {
        if (rc) return try_keyA(ki + 1);
        self.authed_sector = sector;
        self.auth_key = self.KEYS[ki];

        // try_keyB(): always the default key
        self.acr122_load_authentication_keys(self.KEYS[0], 1,
          function(rc, data) {
          self.acr122_authentication(block, 1, 0x61/*KEY B*/,
            function(rc, data) {
            if (callback) callback(rc, data);
          });
        });
      });
    });
  }

  if (self.detected_tag == "Mifare Classic 1K") {
    if (self.dev && self.dev.acr122) {
      if (self.authed_sector != sector) {
        console.log("[DEBUG] Public Authenticate sector " + sector);
        try_keyA(0);
      } else {
        if (callback) callback(0, null);
      }
    } else {
      if (callback) callback(0, null);
    }
  } else {
    if (callback) callback(0, null);
  }
};

/* For Mifare Classic only. The 'block' is in 16-bytes unit. */
usbSCL3711.prototype.privateAuthentication = function(block, key, cb) {
  var self = this;
  var callback = cb;
  var sector = Math.floor(block / 4);

  if (self.detected_tag == "Mifare Classic 1K") {
    if (self.dev && self.dev.acr122) {
      if (self.authed_sector != sector) {
        console.log("[DEBUG] Private Authenticate sector " + sector);
        self.acr122_load_authentication_keys(key, 1,
            function(rc, data) {
          self.acr122_authentication(block, 1, 0x61/*KEY B*/,
              function(rc, data) {
            if (rc) { console.log("KEY B AUTH ERROR"); return rc; }
            if (callback) callback(rc, data);
          });
        });
      } else {
        if (callback) callback(0, null);
      }
    } else {
      if (callback) callback(0, null);
    }
  } else {
    if (callback) callback(0, null);
  }
};

usbSCL3711.prototype.acr122_set_timeout = function(timeout /* secs */, cb) {
  var self = this;
  var callback = cb;

  var unit = Math.ceil(timeout / 5);
  if (unit >= 0xff) unit = 0xff;
  console.log("[DEBUG] acr122_set_timeout(round up to " + unit * 5 + " secs)");

  self.exchange(new Uint8Array([
    0x6b, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0xff, 0x00, 0x41, unit, 0x00]).buffer, 1.0, function(rc, data) {
      if (callback) callback(rc, data);
  });
}

// onclose callback gets called when device disappears.
usbSCL3711.prototype.open = function(which, cb, onclose) {
  this.rxframes = [];
  this.onclose = onclose;

  this.cid &= 0x00ffffff;
  this.cid |= ((which + 1) << 24);  // For debugging.

  var self = this;
  var callback = cb;
  devManager.open(which, this, function(device) {
    self.dev = device;
    var result = (self.dev != null) ? 0 : 1;

    /* extra configuration for ACR122 */
    if (self.dev && self.dev.acr122) {
      self.acr122_reset_to_good_state(function(rc) {
        if (rc) {
          console.error("[ERROR] acr122_reset_to_good_state() returns " + rc);
          return callback ? callback(rc) : null;
        }
        self.acr122_set_buzzer(false, function(rc) {
          if (rc) {
            console.error("[ERROR] acr122_reset_to_good_state() returns " + rc);
            return callback ? callback(rc) : null;
          }
          if (callback) callback(result);
        });
      });
    } else {
      if (callback) callback(result);
    }
  });
};

usbSCL3711.prototype.close = function() {
  var self = this;

  /* deselect and release target if any tag is associated. */
  function deselect_release(cb) {
    self.exchange(self.makeFrame(0x44/* InDeselect */,
                  new Uint8Array([0x01/*Tg*/])), 1.0 /* timeout */,
      function(rc, data) {
        self.exchange(self.makeFrame(0x52/* InRelease */,
                      new Uint8Array([0x01/*Tg*/])), 1.0 /* timeout */,
          function(rc, data) {
          });
      });
  }

  function dev_manager_close() {
    self.rxframes = null;  // So receivedFrame() will return false.
    if (self.dev) {
      devManager.close(self.dev, self);
      self.dev = null;
    }
  }

  deselect_release(dev_manager_close);
};


/*
 *  Help to build the USB packet:
 *
 *  ACR122:
 *
 *  CCID header (10bytes)
 *
 *
 *  SCL3711:
 *    00  00  ff  ff  ff  len  len  ~len
 *    d4  cmd data ...
 *    dsc ~dsc
 */
usbSCL3711.prototype.makeFrame = function(cmd, data) {
  var r8 = new Uint8Array(data ? data : []);
  // payload: 2 bytes cmd
  var p8 = new Uint8Array(r8.length + 2);

  var dcslen = r8.length + 2;  // [0xd4, cmd]

  // header
  if (this.dev.acr122) {
    // acr122
    var apdu_len = 5 /* header */ + 2 /* cmd */ + r8.length;
    var c8 = new Uint8Array(10);             // CCID header
    c8[0] = 0x6b;                            //   PC_to_RDR_Escape
    c8[1] = (apdu_len >> 0) & 0xff;          //   LEN (little-endian)
    c8[2] = (apdu_len >> 8) & 0xff;          //
    c8[3] = (apdu_len >> 16) & 0xff;         //
    c8[4] = (apdu_len >> 24) & 0xff;         //
    c8[5] = 0x00;                            //   bSlot
    c8[6] = 0x00;                            //   bSeq
    c8[7] = 0x00;                            //   abRFU
    c8[8] = 0x00;                            //   abRFU
    c8[9] = 0x00;                            //   abRFU

    var a8 = new Uint8Array(5);              // Pseudo-APDU
    a8[0] = 0xFF;                            //   Class
    a8[1] = 0x00;                            //   INS (fixed 0)
    a8[2] = 0x00;                            //   P1 (fixed 0)
    a8[3] = 0x00;                            //   P2 (fixed 0)
    a8[4] = r8.length + 2;                   //   Lc (Number of Bytes to send)

    h8 = NFC.util.concat(c8, a8);
  } else {
    // scl3711
    var h8 = new Uint8Array(8);  // header
    h8[0] = 0x00;
    h8[1] = 0x00;
    h8[2] = 0xff;
    h8[3] = 0xff;
    h8[4] = 0xff;
    h8[5] = dcslen >>> 8;
    h8[6] = dcslen & 255;
    h8[7] = 0x100 - ((h8[5] + h8[6]) & 255);  // length checksum
  }

  // cmd
  p8[0] = 0xd4;
  p8[1] = cmd;

  // payload
  var dcs = p8[0] + p8[1];
  for (var i = 0; i < r8.length; ++i) {
    p8[2 + i] = r8[i];
    dcs += r8[i];
  }

  var chksum = null;
  if (this.dev.acr122) {
    chksum = new Uint8Array([]);
  } else {
    chksum = new Uint8Array(2);  // checksum: 2 bytes checksum at the end.
    chksum[0] = 0x100 - (dcs & 255);  // data checksum
    chksum[1] = 0x00;
  }

  return NFC.util.concat(NFC.util.concat(h8, p8), chksum).buffer;
};


// Wait for a passive target.
usbSCL3711.prototype.wait_for_passive_target = function(timeout, cb) {
  var self = this;

  if (!cb) cb = DevManager.defaultCallback;

  function InListPassiveTarget(timeout, cb) {
    self.detected_tag = null;
    // Command 0x4a InListPassiveTarget, 0x01/*MaxTg*/, 0x00 (106 kpbs type).
    self.exchange(self.makeFrame(0x4a, new Uint8Array([0x01, 0x00])),
                  timeout, cb);
  }

  if (self.dev.acr122) {
    self.acr122_set_timeout(timeout, function(rc, data) {
      InListPassiveTarget(timeout, cb);
    });
  } else {
    InListPassiveTarget(timeout, cb);
  }
};


// read a block (16-byte) from tag.
// cb(rc, data: ArrayBuffer)
usbSCL3711.prototype.read_block = function(block, cb) {
  var self = this;
  var callback = cb;
  if (!cb) cb = DevManager.defaultCallback;

  /* function-wise variable */
  var u8 = new Uint8Array(2);  // Type 2 tag command
  u8[0] = 0x30;                // READ command
  u8[1] = block;               // block number

  self.apdu(u8, function (rc, data) {
      callback(rc, data);
  });
}


// Input:
//  data: ArrayBuffer, the type 2 tag content.
usbSCL3711.prototype.emulate_tag = function(data, timeout, cb) {
  if (!cb) cb = DevManager.defaultCallback;
  var callback = cb;
  var self = this;
  var TIMEOUT = timeout;

  /*
   * Input:
   *   cmd: the TT2 command from initiator.
   */
  var HANDLE_TT2 = function(cmd) {
    switch (cmd[0]) {
    case 0x30:  /* READ */
      var blk_no = cmd[1];
      console.log("recv TT2.READ(blk_no=" + blk_no + ")");
      var ret = data.subarray(blk_no * 4, blk_no * 4 + 16);
      if (ret.length < 16) {
        ret = NFC.util.concat(ret, new Uint8Array(16 - ret.length));
      }
      /* TgResponseToInitiator */
      var u8 = self.makeFrame(0x90, ret);
      self.exchange(u8, TIMEOUT, function(rc, data) {
        if (rc) { console.log("exchange(): " + rc); return rc; }
        /* TgGetInitiatorCommand */
        var u8 = self.makeFrame(0x88, []);
        self.exchange(u8, TIMEOUT, function(rc, data) {
          if (rc) { console.log("exchange(): " + rc); return rc; }
          HANDLE_TT2(new Uint8Array(data));
        });
      });
      break;
    case 0x50:  /* HALT */
      console.log("recv TT2.HALT received.");
      callback(0);
      break;
    default:
      console.log("Unsupported TT2 tag: " + cmd[0]);
      callback(0x999);
    }
  }

  function TgInitAsTarget() {
    var req = new Uint8Array([
        0x01, // Mode: passive only
        0x04, 0x00, 0x00, 0xb0, 0x0b, 0x00, // Mifare parameter
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // Felica
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // ID3
        0x00, 0x00]);
    var u8 = self.makeFrame(0x8c, req);
    self.exchange(u8, TIMEOUT, function(rc, data) {
      if (rc != 0) { callback(rc); return; }
      console.log("Emulated as a tag, reply is following:");

      HANDLE_TT2(new Uint8Array(data));
    });
  }

  if (self.dev.acr122) {
    // Set the PICC Operating Parameter
    self.exchange(new Uint8Array([
      0x6b, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0xff, 0x00, 0x51, 0x00, 0x00]).buffer, 1, function(rc, data) {
        // RFCA:off and RF:off
        self.exchange(new Uint8Array([
          0x6b, 0x09, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0xff, 0x00, 0x00, 0x00, 0x04, 0xd4, 0x32, 0x01, 0x00]).buffer, 1,
          function(rc, data) {
            if (rc != 0) { callback(rc); return; }
            self.acr122_set_timeout(timeout, function(rc, data) {
              if (rc != 0) { callback(rc); return; }
              TgInitAsTarget();
            });
        });
    });
  } else {
    TgInitAsTarget();
  }
}


// Input:
//   blk_no: block number (TT2: 4-byte; Classic: 16-byte)
//   data: Uint8Array.
usbSCL3711.prototype.write_block = function(blk_no, data, cb, write_inst) {
  var callback = cb;

  if (write_inst == null) {
    write_inst = 0xA2;  // TT2 WRITE command
  }

  var u8 = new Uint8Array(2 + data.length);  // Type 2 tag command
  u8[0] = write_inst;               // WRITE command
  u8[1] = blk_no;                   // block number
  for (var i = 0; i < data.length; i++) {
    u8[2 + i] = data[i];
  }

  this.apdu(u8, function(rc, dummy) {
    callback(rc);
  });
}

// Send apdu (0x40 -- InDataExchange), receive response.
usbSCL3711.prototype.apdu = function(req, cb, write_only) {
  if (!cb) cb = DevManager.defaultCallback;

  // Command 0x40 InDataExchange, our apdu as payload.
  var u8 = new Uint8Array(this.makeFrame(0x40,
                                         NFC.util.concat([0x01/*Tg*/], req)));

  // Write out in 64 bytes frames.
  for (var i = 0; i < u8.length; i += 64) {
    this.dev.writeFrame(new Uint8Array(u8.subarray(i, i + 64)).buffer);
  }

  if (write_only) {
    cb(0, null);  // tell caller the packet has been sent.
  } else {
    // Read response, interpret sw12.
    this.read(3.0, function(rc, data, expect_sw12) {
      if (rc != 0) { cb(rc); return; }
      var u8 = new Uint8Array(data);

      if (expect_sw12) {
        if (u8.length < 2) { cb(0x0666); return; }
        var sw12 = u8[u8.length - 2] * 256 + u8[u8.length - 1];
        // Pass all non 9000 responses.
        // 9000 is expected and passed as 0.
        cb(sw12 == 0x9000 ? 0 : sw12,
          new Uint8Array(u8.subarray(0, u8.length - 2)).buffer);
      } else {
        cb(0, u8.buffer);
      }
    });
  }
};

/*
 * Copyright 2014 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 *     http://www.apache.org/licenses/LICENSE-2.0
  
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// SHA256 {
//  SHA256();
//  void reset();
//  void update(byte[] data, opt_length);
//  byte[32] digest();
// }

function SHA256() {
  this._buf = new Array(64);
  this._W = new Array(64);
  this._pad = new Array(64);
  this._k = [
   0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
   0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
   0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
   0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
   0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
   0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
   0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
   0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 ];

  this._pad[0] = 0x80;
  for (var i = 1; i < 64; ++i) this._pad[i] = 0;

  this.reset();
};

SHA256.prototype.reset = function() {
  this._chain = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f,0x9b05688c, 0x1f83d9ab, 0x5be0cd19 ];

  this._inbuf = 0;
  this._total = 0;
};

SHA256.prototype._compress = function(buf) {
  var W = this._W;
  var k = this._k;

  function _rotr(w, r) { return ((w << (32 -r)) | (w >>> r)); };

  // get 16 big endian words
  for (var i = 0; i < 64; i += 4) {
    var w = (buf[i] << 24) | (buf[i+1] << 16) | (buf[i+2] << 8) | (buf[i+3]);
    W[i / 4] = w;
  }

  // expand to 64 words
  for ( var i = 16; i < 64; ++i ) {
    var s0 = _rotr(W[i - 15], 7) ^ _rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
    var s1 = _rotr(W[i - 2], 17) ^ _rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) & 0xffffffff;
  }

  var A = this._chain[0];
  var B = this._chain[1];
  var C = this._chain[2];
  var D = this._chain[3];
  var E = this._chain[4];
  var F = this._chain[5];
  var G = this._chain[6];
  var H = this._chain[7];

  for (var i = 0; i < 64; ++i) {
    var S0 = _rotr(A, 2) ^ _rotr(A, 13) ^  _rotr(A, 22);
    var maj = (A & B) ^ (A & C) ^ (B & C);
    var t2 = (S0 + maj) & 0xffffffff;
    var S1 = _rotr(E, 6) ^ _rotr(E, 11) ^ _rotr(E, 25);
    var ch = (E & F) ^ ((~E) & G);
    var t1 = (H + S1 + ch + k[i] + W[i]) & 0xffffffff;

    H = G;
    G = F;
    F = E;
    E = (D + t1) & 0xffffffff;
    D = C;
    C = B;
    B = A;
    A = (t1 + t2) & 0xffffffff;
  }

  this._chain[0] += A;
  this._chain[1] += B;
  this._chain[2] += C;
  this._chain[3] += D;
  this._chain[4] += E;
  this._chain[5] += F;
  this._chain[6] += G;
  this._chain[7] += H;
};

SHA256.prototype.update = function(bytes, opt_length) {
  if ( !opt_length ) opt_length = bytes.length;

  this._total += opt_length;
  for ( var n = 0; n < opt_length; ++n ) {
    this._buf[this._inbuf++] = bytes[n];
    if ( this._inbuf == 64 ) {
      this._compress(this._buf);
      this._inbuf = 0;
    }
  }
};

SHA256.prototype.updateRange = function(bytes, start, end) {
  this._total += (end - start);
  for ( var n = start; n < end; ++n ) {
    this._buf[this._inbuf++] = bytes[n];
    if ( this._inbuf == 64 ) {
      this._compress(this._buf);
      this._inbuf = 0;
    }
  }
};

SHA256.prototype.digest = function() {
  for (var i = 0; i < arguments.length; ++i)
    this.update(arguments[i]);

  var digest = new Array(32);
  var totalBits = this._total * 8;

  // add pad 0x80 0x00*
  if (this._inbuf < 56)
    this.update(this._pad, 56 - this._inbuf );
  else
    this.update(this._pad, 64 - ( this._inbuf - 56 ) );

  // add # bits, big endian
  for (var i = 63; i >= 56; --i) {
    this._buf[i] = totalBits & 255;
    totalBits >>>= 8;
  }

  this._compress(this._buf);

  var n = 0;
  for (var i = 0; i < 8; ++i)
    for (var j = 24; j >= 0; j -= 8)
      digest[n++] = (this._chain[i] >> j) & 255;

  return digest;
};

/*
 * Copyright 2014 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 *     http://www.apache.org/licenses/LICENSE-2.0
  
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @fileoverview Tag() class
 */


/*
 * Unfortunately, some tags, such as Ultralight-*, require async read
 * to distiguish the tag type. The 'cb' will be called if the order matters.
 */
function Tag(tag_name, tag_id) {
  switch (tag_name) {
  case "tt2":
    return new TT2(tag_id);

  case "mifare_classic":
    return new MifareClassic(tag_id);
  }

  return null;
}


/*
 * Copyright 2014 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 *     http://www.apache.org/licenses/LICENSE-2.0
  
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @fileoverview 
 */

'use strict';


function TT2(tag_id) {
  this.tag_id = new Uint8Array(tag_id);
  this.type_name = null;  // vendor and its card name

  /*
   * TODO: detect at beginning -- if we have a reliable way to detect.
   *   this.detect_type_name(cb);
  */

  this.lock_contorl = [];
}

TT2.prototype.detect_type_name = function(cb) {
  var self = this;
  var callback = cb;

  if (this.tag_id[0] == 0x04) {
    // NxP, Try to read page 0x10. If success, it is Ultralight C.
    this.device.read_block(0x10, function(rc, bn) {
      if (rc) {
        self.type_name = "Mifare Ultralight";
      } else {
        self.type_name = "Mifare Ultralight C";
      }

      console.debug("[DEBUG] TT2.type_name = " + self.type_name);
      if (callback) callback();
    });
  }
}


// read NFC Type 2 tag spec 1.0 for memory structure.
// The callback is called with cb(NDEF Uint8Array).
TT2.prototype.read = function(device, cb) {
  var self = this;
  if (!cb) cb = DevManager.defaultCallback;
  var callback = cb;

  function poll_block0(rc, b0_b3) {
    if (rc) return callback(rc);

    var card = new Uint8Array(b0_b3);
    var data = new Uint8Array(b0_b3);
    var data_size = data[14] * 8;  // CC2: unit is 8 bytes.
    var CC0 = data[12];            // CC0: 0xE1 = NDEF
    var CC1 = data[13];            // CC1: version of this Type 2 tag spec.
    var CC3 = data[15];            // CC3: b7-b4: read permission.

    function check_ver(cc1) {
      var major = (cc1 & 0xf0 ) >> 4;
      var minor = cc1 & 0x0f;
      if (major == 0x1) return true;
      return false;
    }
    function readable(cc3) {
      return (cc3 & 0xf0) == 0x00 ? true : false;
    }

    /* TODO: support protocol other than NDEF */
    if (CC0 != 0xE1 || !check_ver(CC1) || !readable(CC3)) {
      console.log("UNsupported type 2 tag: CC0=" + CC0 +
                                        ", CC1=" + CC1 +
                                        ", CC3=" + CC3);
      return callback(0x0777, data.buffer);
    }

    // poll data out
    var poll_n = Math.floor((data_size + 15) / 16);
    var block = 4;  // data starts from block 4

    function poll_block(card, block, poll_n) {
      console.log("[DEBUG] poll_n: " + poll_n);
      if (--poll_n < 0) {
        DevManager.defaultCallback("[DEBUG] got a type 2 tag:", card.buffer);

        /* TODO: call tlv.js instead */
        /* TODO: now pass NDEF only. Support non-NDEF in the future. */
        for (var i = 0x10; i < card.length;) {
          switch (card[i]) {
          case 0x00:  /* NULL */
            console.debug("NULL TLV");
            i++;
            break;

          case 0x01:  /* Lock Control TLV */
            console.debug("Found Lock Control TLV");

            /* TODO: refactor and share code with Memory Control TLV */
            var PageAddr = card[i + 2] >> 4;
            var ByteOffset = card[i + 2] & 0xf;
            var Size = card[i + 3];
            if (Size == 0) Size = 256;  /* 256 bits */
            var BytesPerPage = Math.pow(2, card[i + 4] & 0xf);
            var BytesLockedPerLockBit = card[i + 4] >> 4;

            console.debug("Lock control: " +
                "BytesLockedPerLockBit=" + BytesLockedPerLockBit +
                ", Size=" + Size);

            var ByteAddr = PageAddr * BytesPerPage + ByteOffset;

            console.info("Lock control: ByteAddr=" + ByteAddr);
            console.info("  Locked bytes:");
            var lock_offset = 64;
            for (var j = 0; j < (Size + 7) / 8; j++) {
              var k = ByteAddr + j;

              if (k >= card.length) {
                console.warn("  card[" + k + "] haven't read out yet.");
                /* TODO: read out and continue the following parse */
                break;
              }

              var mask = card[k];
              console.debug("  [" + k + "]: " + mask.toString(16));

              if (mask & 1) console.debug("* block-locking");
              for (var l = 1; l < 8; l++) {
                if (j * 8 + l >= Size) continue;

                for (var s = "", m = 0;
                     m < BytesLockedPerLockBit;
                     lock_offset++) {
                  s += "0x" + lock_offset.toString(16) + ", ";
                }
                if (mask & (1 << l)) console.info("    " + s);
              }
            }

            i += (1/*T*/ + 1/*L*/ + card[i + 1]/*len: 3*/);
            break;

          /* TODO: 0x02 -- Memory Control TLV */

          case 0xFE:  /* Terminator */
            console.debug("Terminator TLV.");
            return;

          case 0x03: /* NDEF */
            var len = card[i + 1];
            if ((i + 2 + len) > card.length) {
              console.warn("TLV len " + len + " > card len " + card.length);
            }
            return callback(0,
                new Uint8Array(card.subarray(i + 2, i + 2 + len)).buffer);

          default:
            console.error("Unknown Type [" + card[i] + "]");
            return;
          }
        }  /* end of for */
      }

      device.read_block(block, function(rc, bn) {
        if (rc) return callback(rc);
        card = NFC.util.concat(card, new Uint8Array(bn));
        return poll_block(card, block + 4, poll_n);
      });
    }
    poll_block(card, block, poll_n);
  }

  device.read_block(0, poll_block0);
}


/* Input:
 *   ndef - Uint8Array
 */
TT2.prototype.compose = function(ndef) {

  var blen;  // CC2
  var need_lock_control_tlv = 0;

  if ((ndef.length + 16 /* tt2_header */
                   + 2  /* ndef_tlv */
                   + 1  /* terminator_tlv */) > 64) {
    /*
     * CC bytes of MF0ICU2 (MIFARE Ultralight-C) is OTP (One Time Program).
     * Set to maximum available size (144 bytes).
     */
    blen = 144 / 8;
    need_lock_control_tlv = 1;

    /* TODO: check if the ndef.length + overhead are larger than card */
  } else {
    /*
     * CC bytes of MF0ICU1 (MIFARE Ultralight) is OTP (One Time Program).
     * Set to maximum available size (48 bytes).
     */
    blen = 48 / 8;
  }

  var tt2_header = new Uint8Array([
    0x00, 0x00, 0x00, 0x00,  /* UID0, UID1, UID2, Internal0 */
    0x00, 0x00, 0x00, 0x00,  /* UID3, UID4, UID5, UID6 */
    0x00, 0x00, 0x00, 0x00,  /* Internal1, Internal2, Lock0, Lock1 */
    0xe1, 0x10, blen, 0x00   /* CC0, CC1, CC2(len), CC3 */
  ]);

  var lock_control_tlv = (need_lock_control_tlv) ?
    new Uint8Array([
      /*T*/ 0x01,
      /*L*/ 0x03,
      /*V*/ 0xA0, 0x10, 0x44  /* BytesLockedPerLockBit=4, Size=16
                               * ByteAddr=160
                               */
    ]) :
    new Uint8Array([]);

  var ndef_tlv = new Uint8Array([
    0x03, ndef.length        /* NDEF Message TLV */
  ]);
  var terminator_tlv = new Uint8Array([
    0xfe
  ]);
  var ret = NFC.util.concat(tt2_header, 
            NFC.util.concat(lock_control_tlv,
            NFC.util.concat(ndef_tlv,
            NFC.util.concat(new Uint8Array(ndef),
                        terminator_tlv))));
  return ret;
}


// Input:
//   ndef: ArrayBuffer. Just ndef is needed. TT2 header is handled.
TT2.prototype.write = function(device, ndef, cb) {
  if (!cb) cb = DevManager.defaultCallback;

  var self = this;
  var callback = cb;
  var card = self.compose(new Uint8Array(ndef));
  var card_blknum = Math.floor((card.length + 3) / 4);

  /* TODO: check memory size according to CC value */
  if (card_blknum > (64 / 4)) {
    console.warn("write_tt2() card length: " + card.length +
                 " is larger than 64 bytes. Try to write as Ultralight-C.");
    if (card_blknum > (192 / 4)) {
      console.error("write_tt2() card length: " + card.length +
                    " is larger than 192 bytes (more than Ultralight-C" +
                    " can provide).");
      return callback(0xbbb);
    }
  }

  function write_block(card, block_no) {
    if (block_no >= card_blknum) { return callback(0); }

		var data = card.subarray(block_no * 4, block_no * 4 + 4);
    if (data.length < 4) data = NFC.util.concat(data,
                                            new Uint8Array(4 - data.length));

    device.write_block(block_no, data, function(rc) {
      if (rc) return callback(rc);
      write_block(card, block_no + 1);
    });
  }

  /* Start from CC* fields */
  write_block(card, 3);
}


TT2.prototype.emulate = function(device, ndef_obj, timeout, cb) {
  var data = this.compose(new Uint8Array(ndef_obj.compose()));
  return device.emulate_tag(data, timeout, cb);
}

/*
 * Copyright 2014 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 *     http://www.apache.org/licenses/LICENSE-2.0
  
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @fileoverview Low level usb cruft to SCL3711 NFC token.
 */

'use strict';

// Low level 'driver'. One per physical USB device.
function llSCL3711(dev, acr122) {
  this.dev = dev;
  this.txqueue = [];
  this.clients = [];
  this.acr122 = acr122;
  if (acr122) {
    this.endpoint = 2;
  } else {
    // scl3711
    this.endpoint = 4;
  }

  this.readLoop();
}

llSCL3711.prototype.notifyClientOfClosure = function(client) {
  var cb = client.onclose;
  if (cb) window.setTimeout(cb, 0);
};

llSCL3711.prototype.close = function() {
  // Tell clients.
  while (this.clients.length != 0) {
    this.notifyClientOfClosure(this.clients.shift());
  }

  // Tell global list to drop this device.
  devManager.dropDevice(this);
};

llSCL3711.prototype.publishFrame = function(f) {
  // Push frame to all clients.
  var old = this.clients;

  var remaining = [];
  var changes = false;
  for (var i = 0; i < old.length; ++i) {
    var client = old[i];
    if (client.receivedFrame(f)) {
      // Client still alive; keep on list.
      remaining.push(client);
    } else {
      changes = true;
      console.log(NFC.util.fmt(
          '[' + client.cid.toString(16) + '] left?'));
    }
  }
  if (changes) this.clients = remaining;
};

llSCL3711.prototype.readLoop = function() {
  if (!this.dev) return;

  // console.log(NFC.util.fmt('entering readLoop ' + this.dev.handle));

  var self = this;
  chrome.usb.bulkTransfer(
    this.dev,
    { direction:'in', endpoint:this.endpoint, length:2048 },
    function(x) {
      if (x.data) {
        if (x.data.byteLength >= 5) {

          var u8 = new Uint8Array(x.data);
          console.log(NFC.util.fmt('<' + NFC.util.BytesToHex(u8)));

          self.publishFrame(x.data);

          // Read more.
          window.setTimeout(function() { self.readLoop(); } , 0);
        } else {
          console.error(NFC.util.fmt('tiny reply!'));
          console.error(x);
          // TODO(yjlou): I don't think a tiny reply requires close.
          //              Maybe call devManager.close(null, clients[0])?
          // window.setTimeout(function() { self.close(); }, 0);
        }

      } else {
        console.log('no x.data!');
        console.log(x);
        throw 'no x.data!';
      }
    }
  );
};

// Register an opener.
llSCL3711.prototype.registerClient = function(who) {
  this.clients.push(who);
};

// De-register an opener.
// Returns number of remaining listeners for this device.
llSCL3711.prototype.deregisterClient = function(who) {
  var current = this.clients;
  this.clients = [];
  for (var i = 0; i < current.length; ++i) {
    var client = current[i];
    if (client != who) this.clients.push(client);
  }
  return this.clients.length;
};

// Stuffs all queued frames from txqueue[] to device.
llSCL3711.prototype.writePump = function() {
  if (!this.dev) return;  // Ignore.

  if (this.txqueue.length == 0) return;  // Done with current queue.

  var frame = this.txqueue[0];

  var self = this;
  function transferComplete(x) {
    self.txqueue.shift();  // drop sent frame from queue.
    if (self.txqueue.length != 0) {
      window.setTimeout(function() { self.writePump(); }, 0);
    }
  };

  var u8 = new Uint8Array(frame);
  console.log(NFC.util.fmt('>' + NFC.util.BytesToHex(u8)));

  chrome.usb.bulkTransfer(
      this.dev,
      {direction:'out', endpoint:this.endpoint, data:frame},
      transferComplete
  );
};

// Queue frame to be sent.
// If queue was empty, start the write pump.
// Returns false if device is MIA.
llSCL3711.prototype.writeFrame = function(frame) {
  if (!this.dev) return false;

  var wasEmpty = (this.txqueue.length == 0);
  this.txqueue.push(frame);
  if (wasEmpty) this.writePump();

  return true;
};

/*
 * Copyright 2014 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 *     http://www.apache.org/licenses/LICENSE-2.0
  
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

NFC.util = {
  StringToBytes: function (s, bytes) {
    bytes = bytes || new Array(s.length);
    for (var i = 0; i < s.length; ++i)
      bytes[i] = s.charCodeAt(i);
    return bytes;
  },

  BytesToString: function (b) {
    var tmp = new String();
    for (var i = 0; i < b.length; ++i)
      tmp += String.fromCharCode(b[i]);
    return tmp;
  },

  BytesToHex: function (b) {
    if (!b) return '(null)';
    var hexchars = '0123456789ABCDEF';
    var hexrep = new Array(b.length * 2);

    for (var i = 0; i < b.length; ++i) {
      hexrep[i * 2 + 0] = hexchars.charAt((b[i] >> 4) & 15);
      hexrep[i * 2 + 1] = hexchars.charAt(b[i] & 15);
    }
    return hexrep.join('');
  },

  BytesToHexWithSeparator: function (b, sep) {
    var hexchars = '0123456789ABCDEF';
    var stride = 2 + (sep?1:0);
    var hexrep = new Array(b.length * stride);

    for (var i = 0; i < b.length; ++i) {
      if (sep) hexrep[i * stride + 0] = sep;
      hexrep[i * stride + stride - 2] = hexchars.charAt((b[i] >> 4) & 15);
      hexrep[i * stride + stride - 1] = hexchars.charAt(b[i] & 15);
    }
    return (sep?hexrep.slice(1):hexrep).join('');
  },

  HexToBytes: function (h) {
    var hexchars = '0123456789ABCDEFabcdef';
    var res = new Uint8Array(h.length / 2);
    for (var i = 0; i < h.length; i += 2) {
      if (hexchars.indexOf(h.substring(i, i + 1)) == -1) break;
      res[i / 2] = parseInt(h.substring(i, i + 2), 16);
    }
    return res;
  },

  equalArrays: function (a, b) {
    if (!a || !b) return false;
    if (a.length != b.length) return false;
    var accu = 0;
    for (var i = 0; i < a.length; ++i)
      accu |= a[i] ^ b[i];
    return accu === 0;
  },

  ltArrays: function (a, b) {
    if (a.length < b.length) return true;
    if (a.length > b.length) return false;
    for (var i = 0; i < a.length; ++i) {
      if (a[i] < b[i]) return true;
      if (a[i] > b[i]) return false;
    }
    return false;
  },

  geArrays: function (a, b) {
    return !NFC.util.ltArrays(a, b);
  },

  getRandom: function (a) {
    var tmp = new Array(a);
    var rnd = new Uint8Array(a);
    window.crypto.getRandomValues(rnd);  // Yay!
    for (var i = 0; i < a; ++i) tmp[i] = rnd[i] & 255;
    return tmp;
  },

  equalArrays: function (a, b) {
    if (!a || !b) return false;
    if (a.length != b.length) return false;
    var accu = 0;
    for (var i = 0; i < a.length; ++i)
      accu |= a[i] ^ b[i];
    return accu === 0;
  },

  setFavicon: function (icon) {
    // Construct a new favion link tag
    var faviconLink = document.createElement("link");
    faviconLink.rel = "Shortcut Icon";
    faviconLink.type = 'image/x-icon';
    faviconLink.href = icon;

    // Remove the old favion, if it exists
    var head = document.getElementsByTagName("head")[0];
    var links = head.getElementsByTagName("link");
    for (var i=0; i < links.length; i++) {
      var link = links[i];
      if (link.type == faviconLink.type && link.rel == faviconLink.rel) {
        head.removeChild(link);
      }
    }

    // Add in the new one
    head.appendChild(faviconLink);
  },

  // Erase all entries in array
  clear: function (a) {
    if (a instanceof Array) {
      for (var i = 0; i < a.length; ++i)
        a[i] = 0;
    }
  },

  // hr:min:sec.milli string
  time: function () {
    var d = new Date();
    var m = '000' + d.getMilliseconds();
    var s = d.toTimeString().substring(0, 8) + '.' + m.substring(m.length - 3);
    return s;
  },

  fmt: function (s) {
    return NFC.util.time() + ' ' + s;
  },

  // a and b are Uint8Array. Returns Uint8Array.
  concat: function (a, b) {
    var c = new Uint8Array(a.length + b.length);
    var i, n = 0;
    for (i = 0; i < a.length; i++, n++) c[n] = a[i];
    for (i = 0; i < b.length; i++, n++) c[n] = b[i];
    return c;
  }
};

