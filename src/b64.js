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
